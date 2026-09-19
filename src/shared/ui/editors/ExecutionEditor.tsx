import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { executeArtifactCode } from "@/features/artifacts/lib/executeArtifactCode";
import { executeCode, type CodeExecutionResult } from "@/features/tools/lib/interpreter";
import { executeJavaScript } from "@/features/tools/lib/javascript";
import { ResizablePanel, ResizablePanelGroup } from "@/shared/ui/Resizable";
import { CodeEditor } from "./CodeEditor";

export interface ExecutionEditorProps {
  content: string;
  onRunReady?: (handler: (() => Promise<void>) | null) => void;
  onRunningChange?: (isRunning: boolean) => void;
  /** Receives the code view whose text selection the host watches. */
  onSelectionRoot?: (element: HTMLElement | null) => void;
}

export function ExecutionEditor({
  content,
  language,
  onRunReady,
  onRunningChange,
  onSelectionRoot,
}: ExecutionEditorProps & { language: "python" | "javascript" }) {
  const { fs } = useArtifacts();
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<CodeExecutionResult | null>(null);
  const running = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      running.current?.abort();
      running.current = null;
    },
    [fs],
  );

  const handleRun = useCallback(async () => {
    if (!fs || running.current) return;
    const controller = new AbortController();
    running.current = controller;
    setIsRunning(true);
    setResult(null);
    const result = await executeArtifactCode({
      fs,
      args: { code: content },
      executor: language === "python" ? executeCode : executeJavaScript,
      extension: language === "python" ? "py" : "js",
      mountSkills: language === "python",
      context: { signal: controller.signal },
    });
    // Unmount/navigation cancels both execution and committing its snapshot.
    if (running.current !== controller) return;
    running.current = null;
    setResult(result);
    setIsRunning(false);
  }, [content, fs, language]);

  useEffect(() => {
    onRunReady?.(handleRun);
    return () => onRunReady?.(null);
  }, [handleRun, onRunReady]);

  useEffect(() => {
    onRunningChange?.(isRunning);
    return () => onRunningChange?.(false);
  }, [isRunning, onRunningChange]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {!result ? (
        <div className="flex-1 overflow-hidden">
          <CodeEditor content={content} language={language} onSelectionRoot={onSelectionRoot} />
        </div>
      ) : (
        <ResizablePanelGroup orientation="vertical" className="flex-1 min-h-0">
          <ResizablePanel defaultSize={75} minSize={20} className="overflow-hidden">
            <CodeEditor content={content} language={language} onSelectionRoot={onSelectionRoot} />
          </ResizablePanel>
          <ResizablePanel
            defaultSize={25}
            minSize={10}
            className="flex flex-col border-t border-black/5 dark:border-white/5"
          >
            <div className="flex items-center justify-between px-3 py-1 shrink-0">
              <span className="text-xs uppercase tracking-wider text-neutral-400 dark:text-neutral-500">Output</span>
              <button
                type="button"
                onClick={() => setResult(null)}
                className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/5 text-neutral-400 dark:text-neutral-500"
                title="Clear output"
              >
                <X size={12} />
              </button>
            </div>
            <div className="flex-1 overflow-auto px-3 py-2 font-mono text-xs text-neutral-600 dark:text-neutral-400">
              <pre
                className={
                  result.success ? "whitespace-pre-wrap" : "whitespace-pre-wrap text-red-500/80 dark:text-red-400/70"
                }
              >
                {result.success ? result.output : result.error}
              </pre>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}
