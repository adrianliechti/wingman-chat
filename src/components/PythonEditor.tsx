import { useState, useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import { CodeEditor } from './CodeEditor';
import { executeCode } from '../lib/interpreter';
import { useArtifacts } from '../hooks/useArtifacts';

interface PythonEditorProps {
  content: string;
  onRunReady?: (handler: (() => Promise<void>) | null) => void;
  onRunningChange?: (isRunning: boolean) => void;
}

export function PythonEditor({ content, onRunReady, onRunningChange }: PythonEditorProps) {
  const { fs } = useArtifacts();
  const [isRunning, setIsRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Notify parent of running state changes
  useEffect(() => {
    onRunningChange?.(isRunning);
  }, [isRunning, onRunningChange]);

  const handleRun = useCallback(async () => {
    setIsRunning(true);
    setOutput(null);
    setError(null);

    try {
      // Read files fresh from filesystem at execution time
      const files: Record<string, { content: string; contentType?: string }> = {};
      const fileList = await fs.listFiles();
      for (const file of fileList) {
        files[file.path] = { content: file.content, contentType: file.contentType };
      }

      const result = await executeCode({ code: content, files });

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
  }, [content, fs]);

  // Register run handler with parent on mount, unregister on unmount
  useEffect(() => {
    onRunReady?.(handleRun);
    return () => onRunReady?.(null);
  }, [handleRun, onRunReady]);

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
        <div className="h-1/2 flex flex-col border-t border-black/5 dark:border-white/5">
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              Output
            </span>
            <button
              onClick={handleClear}
              className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/5 text-neutral-400 dark:text-neutral-500"
              title="Clear output"
            >
              <X size={12} />
            </button>
          </div>
          <div className="flex-1 overflow-auto px-3 py-2 font-mono text-xs text-neutral-600 dark:text-neutral-400">
            {error ? (
              <pre className="text-red-500/80 dark:text-red-400/70 whitespace-pre-wrap">{error}</pre>
            ) : (
              <pre className="whitespace-pre-wrap">{output}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}