import { useState, useCallback } from 'react';
import { Play, Loader2, X } from 'lucide-react';
import { CodeEditor } from './CodeEditor';
import { executeCode } from '../lib/interpreter';

interface PythonEditorProps {
  content: string;
}

export function PythonEditor({ content }: PythonEditorProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = useCallback(async () => {
    setIsRunning(true);
    setOutput(null);
    setError(null);

    try {
      const result = await executeCode({ code: content });
      
      if (result.success) {
        setOutput(result.output);
      } else {
        setError(result.error || 'Unknown error occurred');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute code');
    } finally {
      setIsRunning(false);
    }
  }, [content]);

  const handleClear = useCallback(() => {
    setOutput(null);
    setError(null);
  }, []);

  const hasOutput = output !== null || error !== null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Code Editor */}
      <div className={hasOutput ? 'h-1/2 overflow-hidden' : 'flex-1 overflow-hidden'}>
        <CodeEditor content={content} language="python" />
      </div>

      {/* Output Panel */}
      {hasOutput && (
        <div className="h-1/2 flex flex-col border-t border-neutral-200 dark:border-neutral-700">
          <div className="flex items-center justify-between px-3 py-1.5 bg-neutral-100 dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700">
            <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
              Output
            </span>
            <button
              onClick={handleClear}
              className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400"
              title="Clear output"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-3 font-mono text-sm bg-neutral-50 dark:bg-neutral-900">
            {error ? (
              <pre className="text-red-600 dark:text-red-400 whitespace-pre-wrap">{error}</pre>
            ) : (
              <pre className="text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap">{output}</pre>
            )}
          </div>
        </div>
      )}

      {/* Run Button - Fixed at bottom */}
      <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
        <button
          onClick={handleRun}
          disabled={isRunning}
          className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 text-white text-sm font-medium transition-colors"
        >
          {isRunning ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Running...
            </>
          ) : (
            <>
              <Play size={16} />
              Run
            </>
          )}
        </button>
      </div>
    </div>
  );
}
