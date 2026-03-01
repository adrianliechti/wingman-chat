import { useState, useCallback, useEffect, useRef } from 'react';
import { useArtifacts } from '@/features/artifacts/hooks/useArtifacts';
import { createBashInstance, loadArtifactsIntoFs, readFilesFromFs } from '@/features/tools/lib/bash';
import type { BashInstance } from '@/features/tools/lib/bash';

interface BashEditorProps {
  /** If provided, this script content is shown as the initial command (for .sh files) */
  initialScript?: string;
  /** When true, the terminal is visible and the input should be focused */
  visible?: boolean;
  onRunReady?: (handler: (() => Promise<void>) | null) => void;
  onRunningChange?: (isRunning: boolean) => void;
}

interface OutputEntry {
  type: 'command' | 'stdout' | 'stderr' | 'info';
  text: string;
}

export function BashEditor({ initialScript, visible, onRunReady, onRunningChange }: BashEditorProps) {
  const { fs } = useArtifacts();
  const instanceRef = useRef<BashInstance | null>(null);
  const [entries, setEntries] = useState<OutputEntry[]>([]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const previousFilesRef = useRef<Record<string, string>>({});
  const hasRunInitialScript = useRef(false);

  useEffect(() => {
    onRunningChange?.(isRunning);
  }, [isRunning, onRunningChange]);

  // Initialize bash instance with artifact files
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      // Load artifact files
      const artifactFiles = await fs.listFiles();

      if (cancelled) return;

      // Create bash instance with artifact files preloaded
      const fileMap: Record<string, { content: string }> = {};
      for (const file of artifactFiles) {
        fileMap[file.path] = { content: file.content };
      }

      const instance = createBashInstance(fileMap);
      instanceRef.current = instance;

      // Take initial snapshot using InMemoryFs.getAllPaths()
      const snapshot = await readFilesFromFs(instance.memFs);
      previousFilesRef.current = snapshot;

      if (!cancelled) {
        setIsReady(true);
        setEntries([{ type: 'info', text: 'Bash shell ready. Type commands below.' }]);
      }
    };

    init();

    return () => { cancelled = true; };
  }, [fs]);

  // Run initial script once when bash is ready
  useEffect(() => {
    if (isReady && initialScript && !hasRunInitialScript.current) {
      hasRunInitialScript.current = true;
      // Pre-fill the input with the script content for .sh files
      setInput(initialScript.trim());
    }
  }, [isReady, initialScript]);

  // Auto-scroll to bottom when entries change
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [entries]);

  // Sync bash FS changes back to artifacts
  const syncToArtifacts = useCallback(async () => {
    if (!instanceRef.current || !fs) return;

    try {
      const currentFiles = await readFilesFromFs(instanceRef.current.memFs);
      const prevFiles = previousFilesRef.current;

      // Find new or modified files
      for (const [path, content] of Object.entries(currentFiles)) {
        if (prevFiles[path] !== content) {
          await fs.createFile(path, content);
        }
      }

      // Find deleted files
      for (const path of Object.keys(prevFiles)) {
        if (!(path in currentFiles)) {
          await fs.deleteFile(path);
        }
      }

      previousFilesRef.current = currentFiles;
    } catch (error) {
      console.error('Error syncing bash FS to artifacts:', error);
    }
  }, [fs]);

  // Sync new artifact files into bash (when created externally, e.g. by the LLM)
  useEffect(() => {
    if (!instanceRef.current || !isReady) return;

    const syncFromArtifacts = async () => {
      if (!instanceRef.current) return;
      const { memFs } = instanceRef.current;

      try {
        const fileList = await fs.listFiles();
        await loadArtifactsIntoFs(memFs, fileList);

        // Update snapshot
        const snapshot = await readFilesFromFs(memFs);
        previousFilesRef.current = snapshot;
      } catch {
        // Ignore sync errors
      }
    };

    const unsubCreate = fs.subscribe('fileCreated', syncFromArtifacts);
    const unsubUpdate = fs.subscribe('fileUpdated', syncFromArtifacts);

    return () => {
      unsubCreate();
      unsubUpdate();
    };
  }, [fs, isReady]);

  const executeCommand = useCallback(async (command: string) => {
    if (!instanceRef.current || !command.trim()) return;

    const trimmed = command.trim();
    
    // Handle clear command locally
    if (trimmed === 'clear') {
      setEntries([]);
      return;
    }

    setIsRunning(true);
    setEntries(prev => [...prev, { type: 'command', text: trimmed }]);

    // Add to history
    setHistory(prev => {
      const newHistory = prev.filter(h => h !== trimmed);
      newHistory.push(trimmed);
      return newHistory.slice(-100); // Keep last 100 commands
    });
    setHistoryIndex(-1);

    try {
      const result = await instanceRef.current.bash.exec(trimmed);

      setEntries(prev => {
        const newEntries = [...prev];
        if (result.stdout) {
          newEntries.push({ type: 'stdout', text: result.stdout });
        }
        if (result.stderr) {
          newEntries.push({ type: 'stderr', text: result.stderr });
        }
        if (result.exitCode !== 0 && !result.stderr) {
          newEntries.push({ type: 'info', text: `exit code: ${result.exitCode}` });
        }
        return newEntries;
      });

      // Sync filesystem changes back to artifacts
      await syncToArtifacts();
    } catch (error) {
      setEntries(prev => [...prev, {
        type: 'stderr',
        text: error instanceof Error ? error.message : String(error)
      }]);
    } finally {
      setIsRunning(false);
    }
  }, [syncToArtifacts]);

  // Register run handler — for .sh files, execute the script content
  useEffect(() => {
    if (!initialScript) {
      onRunReady?.(null);
      return;
    }

    const handler = async () => {
      await executeCommand(initialScript.trim());
    };

    onRunReady?.(handler);
    return () => onRunReady?.(null);
  }, [initialScript, executeCommand, onRunReady]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isRunning) {
      e.preventDefault();
      const cmd = input;
      setInput('');
      executeCommand(cmd);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const newIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(newIndex);
      setInput(history[newIndex]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex === -1) return;
      const newIndex = historyIndex + 1;
      if (newIndex >= history.length) {
        setHistoryIndex(-1);
        setInput('');
      } else {
        setHistoryIndex(newIndex);
        setInput(history[newIndex]);
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      setEntries([]);
    }
  }, [input, isRunning, history, historyIndex, executeCommand]);

  // Focus input when terminal becomes visible
  useEffect(() => {
    if (visible && isReady) {
      inputRef.current?.focus();
    }
  }, [visible, isReady]);

  // Focus input when clicking anywhere in the terminal
  const handleTerminalClick = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      className="h-full flex flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-200 font-mono text-xs cursor-text"
      onClick={handleTerminalClick}
    >
      {/* Output area */}
      <div ref={outputRef} className="flex-1 overflow-auto p-3 space-y-0.5">
        {entries.map((entry, i) => {
          switch (entry.type) {
            case 'command':
              return (
                <div key={i} className="flex">
                  <span className="text-emerald-600 dark:text-green-400 shrink-0 select-none mr-1">$</span>
                  <span className="text-neutral-900 dark:text-neutral-100 whitespace-pre-wrap break-all">{entry.text}</span>
                </div>
              );
            case 'stdout':
              return (
                <pre key={i} className="text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap break-all leading-relaxed">{entry.text}</pre>
              );
            case 'stderr':
              return (
                <pre key={i} className="text-red-700 dark:text-red-400/80 whitespace-pre-wrap break-all leading-relaxed">{entry.text}</pre>
              );
            case 'info':
              return (
                <div key={i} className="text-neutral-500 dark:text-neutral-500 italic">{entry.text}</div>
              );
          }
        })}

        {isRunning && (
          <div className="flex items-center gap-1.5 text-neutral-500 dark:text-neutral-500">
            <span className="inline-block w-1.5 h-3 bg-neutral-500 dark:bg-neutral-500 animate-pulse" />
            <span>running...</span>
          </div>
        )}
      </div>

      {/* Input line */}
      <div className="shrink-0 flex items-center border-t border-neutral-200/60 dark:border-neutral-800/60 px-3 py-2">
        <span className="text-emerald-600 dark:text-green-400 shrink-0 select-none mr-1">$ </span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!isReady || isRunning}
          className="flex-1 bg-transparent text-neutral-900 dark:text-neutral-100 outline-none placeholder-neutral-400 dark:placeholder-neutral-600 caret-emerald-600 dark:caret-green-400 disabled:opacity-50"
          placeholder={isReady ? 'Enter a command...' : 'Initializing...'}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
        />
      </div>
    </div>
  );
}
