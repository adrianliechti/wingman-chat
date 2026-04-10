import { useState, useCallback, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { SANDBOX_HOME } from "@/shared/lib/artifactFiles";
import {
  createBashInstance,
  getBashCwd,
  getBashEnv,
  readFilesFromFs,
  resolveBashCwd,
} from "@/features/tools/lib/bash";
import type { BashInstance } from "@/features/tools/lib/bash";
import type { OverlayFile } from "@/features/artifacts/lib/fs";

/**
 * Use `compgen -A command` and `compgen -A file` for tab-completions.
 * Note: the short flags `-c` / `-b` are broken in just-bash, but `-A <action>` works.
 */
async function getCompletions(
  bashInstance: BashInstance,
  input: string,
  cursorPos: number,
  cwd: string,
  env: Record<string, string>,
): Promise<{ completions: string[]; replaceFrom: number }> {
  const beforeCursor = input.slice(0, cursorPos);
  const tokenMatch = beforeCursor.match(/(\S+)$/);
  const token = tokenMatch ? tokenMatch[1] : "";
  const replaceFrom = cursorPos - token.length;
  const isFirstToken = beforeCursor.trimStart() === token;

  const results = new Set<string>();
  const escaped = escapeShellArg(token);
  const execOpts = { cwd, env, replaceEnv: true };

  try {
    // File completions (always)
    const fileResult = await bashInstance.bash.exec(`compgen -A file -- ${escaped}`, execOpts);
    if (fileResult.stdout) {
      for (const line of fileResult.stdout.split("\n")) {
        if (line) results.add(line);
      }
    }

    // Command completions (only for first token)
    if (isFirstToken) {
      const cmdResult = await bashInstance.bash.exec(`compgen -A command -- ${escaped}`, execOpts);
      if (cmdResult.stdout) {
        for (const line of cmdResult.stdout.split("\n")) {
          if (line) results.add(line);
        }
      }
    }
  } catch {
    // Ignore completion errors
  }

  return { completions: [...results].sort(), replaceFrom };
}

function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function longestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return "";
  let prefix = strings[0];
  for (let i = 1; i < strings.length; i++) {
    while (!strings[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return "";
    }
  }
  return prefix;
}

interface BashEditorProps {
  /** If provided, this script content is shown as the initial command (for .sh files) */
  initialScript?: string;
  /** When true, the terminal is visible and the input should be focused */
  visible?: boolean;
  onRunReady?: (handler: (() => Promise<void>) | null) => void;
  onRunningChange?: (isRunning: boolean) => void;
}

interface OutputEntry {
  type: "command" | "stdout" | "stderr" | "info";
  text: string;
  cwd?: string;
}

function formatPromptCwd(cwd: string): string {
  if (cwd === SANDBOX_HOME) {
    return "~";
  }

  if (cwd.startsWith(`${SANDBOX_HOME}/`)) {
    return `~/${cwd.slice(SANDBOX_HOME.length + 1)}`;
  }

  return cwd;
}

export function BashEditor({ initialScript, visible, onRunReady, onRunningChange }: BashEditorProps) {
  const { fs } = useArtifacts();
  const instanceRef = useRef<BashInstance | null>(null);
  const [entries, setEntries] = useState<OutputEntry[]>([]);
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [cwd, setCwd] = useState(SANDBOX_HOME);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const previousFilesRef = useRef<Record<string, OverlayFile>>({});
  const hasRunInitialScript = useRef(false);
  const isApplyingLocalSyncRef = useRef(false);
  const cwdRef = useRef(SANDBOX_HOME);
  const shellEnvRef = useRef<Record<string, string>>({
    HOME: SANDBOX_HOME,
    PWD: SANDBOX_HOME,
    OLDPWD: SANDBOX_HOME,
    PATH: "/usr/bin:/bin",
  });
  // Tab completion state
  const tabCompletionsRef = useRef<string[]>([]);
  const tabIndexRef = useRef(-1);
  const tabReplaceFromRef = useRef(0);
  const tabOriginalInputRef = useRef("");
  const tabOriginalCursorRef = useRef(0);

  useEffect(() => {
    cwdRef.current = cwd;
  }, [cwd]);

  useEffect(() => {
    onRunningChange?.(isRunning);
  }, [isRunning, onRunningChange]);

  // Initialize bash instance with artifact files
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      if (!fs) {
        return;
      }

      // Load artifact files
      const artifactFiles = await fs.listFiles();

      if (cancelled) return;

      // Create bash instance with artifact files preloaded
      const fileMap: Record<string, { content: string; contentType?: string }> = {};
      for (const file of artifactFiles) {
        fileMap[file.path] = { content: file.content, contentType: file.contentType };
      }

      const instance = createBashInstance(fileMap);

      instanceRef.current = instance;
      shellEnvRef.current = getBashEnv(instance);

      // Take initial snapshot using InMemoryFs.getAllPaths()
      const snapshot = await readFilesFromFs(instance.memFs);
      previousFilesRef.current = snapshot;

      if (!cancelled) {
        setCwd(getBashCwd(instance));
        setHistory([]);
        setIsReady(true);
        setEntries([{ type: "info", text: "Bash shell ready. Type commands below." }]);
      }
    };

    init();

    return () => {
      cancelled = true;
    };
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

  // Virtualizer for terminal output entries
  const outputVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => outputRef.current,
    estimateSize: () => 20,
    overscan: 40,
  });

  const virtualOutputItems = outputVirtualizer.getVirtualItems();

  // Sync bash FS changes back to artifacts
  const syncToArtifacts = useCallback(async () => {
    if (!instanceRef.current || !fs) return;

    try {
      isApplyingLocalSyncRef.current = true;
      const currentFiles = await readFilesFromFs(instanceRef.current.memFs);
      const prevFiles = previousFilesRef.current;

      // Find new or modified files
      for (const [path, file] of Object.entries(currentFiles)) {
        const previous = prevFiles[path];
        if (!previous || previous.content !== file.content || previous.contentType !== file.contentType) {
          await fs.createFile(path, file.content, file.contentType);
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
      console.error("Error syncing bash FS to artifacts:", error);
    } finally {
      isApplyingLocalSyncRef.current = false;
    }
  }, [fs]);

  // Sync new artifact files into bash (when created externally, e.g. by the LLM)
  useEffect(() => {
    if (!instanceRef.current || !isReady || !fs) return;

    const syncFromArtifacts = async () => {
      if (isApplyingLocalSyncRef.current || !fs) return;

      try {
        const fileList = await fs.listFiles();
        const fileMap: Record<string, { content: string; contentType?: string }> = {};
        for (const file of fileList) {
          fileMap[file.path] = { content: file.content, contentType: file.contentType };
        }

        const nextInstance = createBashInstance(fileMap);
        const resolvedCwd = await resolveBashCwd(nextInstance.memFs, cwdRef.current);

        instanceRef.current = nextInstance;
        shellEnvRef.current = {
          ...getBashEnv(nextInstance),
          ...shellEnvRef.current,
          PWD: resolvedCwd,
        };
        setCwd(resolvedCwd);

        // Update snapshot
        const snapshot = await readFilesFromFs(nextInstance.memFs);
        previousFilesRef.current = snapshot;
      } catch {
        // Ignore sync errors
      }
    };

    const unsubCreate = fs.subscribe("fileCreated", syncFromArtifacts);
    const unsubUpdate = fs.subscribe("fileUpdated", syncFromArtifacts);
    const unsubDelete = fs.subscribe("fileDeleted", syncFromArtifacts);
    const unsubRename = fs.subscribe("fileRenamed", syncFromArtifacts);

    return () => {
      unsubCreate();
      unsubUpdate();
      unsubDelete();
      unsubRename();
    };
  }, [fs, isReady]);

  const executeCommand = useCallback(
    async (command: string) => {
      if (!instanceRef.current || !command.trim()) return;

      const trimmed = command.trim();

      // Handle clear command locally
      if (trimmed === "clear") {
        setEntries([]);
        return;
      }

      setIsRunning(true);
      setEntries((prev) => [...prev, { type: "command", text: trimmed, cwd }]);

      // Add to history
      setHistory((prev) => {
        const newHistory = prev.filter((h) => h !== trimmed);
        newHistory.push(trimmed);
        return newHistory.slice(-100); // Keep last 100 commands
      });
      setHistoryIndex(-1);

      try {
        const result = await instanceRef.current.bash.exec(trimmed, {
          cwd,
          env: shellEnvRef.current,
          replaceEnv: true,
        });

        const nextEnv = (result as { env?: Record<string, string> }).env ?? shellEnvRef.current;
        shellEnvRef.current = nextEnv;
        setCwd(nextEnv.PWD ?? cwd);

        setEntries((prev) => {
          const newEntries = [...prev];
          if (result.stdout) {
            newEntries.push({ type: "stdout", text: result.stdout });
          }
          if (result.stderr) {
            newEntries.push({ type: "stderr", text: result.stderr });
          }
          if (result.exitCode !== 0 && !result.stderr) {
            newEntries.push({ type: "info", text: `exit code: ${result.exitCode}` });
          }
          return newEntries;
        });

        // Sync filesystem changes back to artifacts
        await syncToArtifacts();
      } catch (error) {
        setEntries((prev) => [
          ...prev,
          {
            type: "stderr",
            text: error instanceof Error ? error.message : String(error),
          },
        ]);
      } finally {
        setIsRunning(false);
      }
    },
    [cwd, syncToArtifacts],
  );

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const el = e.currentTarget;

      if (e.key === "Tab") {
        e.preventDefault();
        if (!instanceRef.current || isRunning) return;

        const cursorPos = el.selectionStart ?? input.length;

        // If we already have completions, cycle through them
        if (tabCompletionsRef.current.length > 0) {
          const dir = e.shiftKey ? -1 : 1;
          tabIndexRef.current =
            (tabIndexRef.current + dir + tabCompletionsRef.current.length) %
            tabCompletionsRef.current.length;
          const match = tabCompletionsRef.current[tabIndexRef.current];
          const before = tabOriginalInputRef.current.slice(0, tabReplaceFromRef.current);
          const after = tabOriginalInputRef.current.slice(tabOriginalCursorRef.current);
          const suffix = match.endsWith("/") ? "" : " ";
          setInput(`${before}${match}${suffix}${after}`);
          return;
        }

        // First tab press — fetch completions
        tabOriginalInputRef.current = input;
        tabOriginalCursorRef.current = cursorPos;

        void getCompletions(
          instanceRef.current,
          input,
          cursorPos,
          cwd,
          shellEnvRef.current,
        ).then(({ completions, replaceFrom }) => {
          if (completions.length === 0) return;

          tabCompletionsRef.current = completions;
          tabReplaceFromRef.current = replaceFrom;

          const before = input.slice(0, replaceFrom);
          const after = input.slice(cursorPos);

          if (completions.length === 1) {
            const match = completions[0];
            const suffix = match.endsWith("/") ? "" : " ";
            setInput(`${before}${match}${suffix}${after}`);
            tabCompletionsRef.current = [];
          } else {
            const common = longestCommonPrefix(completions);
            setInput(`${before}${common}${after}`);
            tabIndexRef.current = -1;
            setEntries((prev) => [
              ...prev,
              { type: "command", text: input, cwd },
              { type: "stdout", text: completions.join("  ") },
            ]);
          }
        });
        return;
      }

      // Any non-tab key resets tab state
      if (e.key !== "Shift") {
        tabCompletionsRef.current = [];
        tabIndexRef.current = -1;
      }

      if (e.key === "Enter" && !isRunning) {
        e.preventDefault();
        const cmd = input;
        setInput("");
        executeCommand(cmd);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (history.length === 0) return;
        const newIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setInput(history[newIndex]);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (historyIndex === -1) return;
        const newIndex = historyIndex + 1;
        if (newIndex >= history.length) {
          setHistoryIndex(-1);
          setInput("");
        } else {
          setHistoryIndex(newIndex);
          setInput(history[newIndex]);
        }
      } else if (e.ctrlKey) {
        if (e.key === "l") {
          e.preventDefault();
          setEntries([]);
        } else if (e.key === "a") {
          e.preventDefault();
          el.setSelectionRange(0, 0);
        } else if (e.key === "e") {
          e.preventDefault();
          el.setSelectionRange(input.length, input.length);
        } else if (e.key === "u") {
          e.preventDefault();
          const pos = el.selectionStart ?? 0;
          setInput(input.slice(pos));
          requestAnimationFrame(() => el.setSelectionRange(0, 0));
        } else if (e.key === "k") {
          e.preventDefault();
          const pos = el.selectionStart ?? input.length;
          setInput(input.slice(0, pos));
        } else if (e.key === "w") {
          e.preventDefault();
          const pos = el.selectionStart ?? 0;
          const beforeW = input.slice(0, pos);
          const match = beforeW.match(/(\s*\S+\s*)$/);
          const deleteLen = match ? match[1].length : 0;
          const newPos = pos - deleteLen;
          setInput(input.slice(0, newPos) + input.slice(pos));
          requestAnimationFrame(() => el.setSelectionRange(newPos, newPos));
        } else if (e.key === "c") {
          e.preventDefault();
          if (isRunning) return;
          setInput("");
          setEntries((prev) => [...prev, { type: "command", text: `${input}^C`, cwd }]);
        }
      }
    },
    [input, isRunning, history, historyIndex, cwd, executeCommand],
  );

  // Focus input when terminal becomes visible or command finishes
  useEffect(() => {
    if (isReady && visible !== false && !isRunning) {
      inputRef.current?.focus();
    }
  }, [visible, isReady, isRunning]);

  return (
    <div
      className="h-full flex flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-200 font-mono text-xs cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {/* Output area */}
      <div ref={outputRef} className="flex-1 overflow-auto p-3" style={{ overflowAnchor: "none" }}>
        <div style={{ height: outputVirtualizer.getTotalSize(), width: "100%", position: "relative" }}>
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualOutputItems[0]?.start ?? 0}px)`,
            }}
          >
            {virtualOutputItems.map((virtualRow) => {
              const entry = entries[virtualRow.index];
              return (
                <div key={virtualRow.key} data-index={virtualRow.index} ref={outputVirtualizer.measureElement}>
                  {entry.type === "command" ? (
                    <div className="flex">
                      <span className="text-emerald-600 dark:text-green-400 shrink-0 select-none mr-1">
                        {formatPromptCwd(entry.cwd ?? cwd)} $
                      </span>
                      <span className="text-neutral-900 dark:text-neutral-100 whitespace-pre-wrap break-all">
                        {entry.text}
                      </span>
                    </div>
                  ) : entry.type === "stdout" ? (
                    <pre className="text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap break-all leading-relaxed">
                      {entry.text}
                    </pre>
                  ) : entry.type === "stderr" ? (
                    <pre className="text-red-700 dark:text-red-400/80 whitespace-pre-wrap break-all leading-relaxed">
                      {entry.text}
                    </pre>
                  ) : (
                    <div className="text-neutral-500 dark:text-neutral-500 italic">{entry.text}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {isRunning && (
          <div className="flex items-center gap-1.5 text-neutral-500 dark:text-neutral-500">
            <span className="inline-block w-1.5 h-3 bg-neutral-500 dark:bg-neutral-500 animate-pulse" />
            <span>running...</span>
          </div>
        )}
      </div>

      {/* Input line — inline with output, no separator */}
      <div className="shrink-0 flex items-center px-3 pb-3 pt-1">
        <span className="text-emerald-600 dark:text-green-400 shrink-0 select-none mr-1">
          {formatPromptCwd(cwd)} $
        </span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!isReady}
          readOnly={isRunning}
          aria-busy={isRunning}
          className="flex-1 bg-transparent text-neutral-900 dark:text-neutral-100 outline-none placeholder-neutral-400 dark:placeholder-neutral-600 caret-emerald-600 dark:caret-green-400 disabled:opacity-50 read-only:opacity-75"
          placeholder={isReady ? "" : "Initializing..."}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
        />
      </div>
    </div>
  );
}
