import { Shapes, SquareCode, SquareTerminal } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";
import type { FileSystemManager } from "@/features/artifacts/lib/fs";
import artifactsInstructionsText from "@/features/artifacts/prompts/artifacts.txt?raw";
import interpreterInstructionsText from "@/features/artifacts/prompts/interpreter.txt?raw";
import llmInstructionsText from "@/features/artifacts/prompts/llm.txt?raw";
import ocrInstructionsText from "@/features/artifacts/prompts/ocr.txt?raw";
import officeInstructionsText from "@/features/artifacts/prompts/office.txt?raw";
import renderInstructionsText from "@/features/artifacts/prompts/render.txt?raw";
import synthesizeInstructionsText from "@/features/artifacts/prompts/synthesize.txt?raw";
import transcribeInstructionsText from "@/features/artifacts/prompts/transcribe.txt?raw";
import translateInstructionsText from "@/features/artifacts/prompts/translate.txt?raw";
import visionInstructionsText from "@/features/artifacts/prompts/vision.txt?raw";
import { executeBash, getSingleton, loadArtifactsIntoFs, readFilesFromFs } from "@/features/tools/lib/bash";
import { executeCode } from "@/features/tools/lib/interpreter";
import { withSandboxLock } from "@/features/tools/lib/sandboxLock";
import { getConfig } from "@/shared/config";
import { createFileTools, type FileData, type FileEntry, type WritableFileSource } from "@/shared/lib/file-tools";
import { isDataUrl } from "@/shared/lib/fileContent";
import { normalizeArtifactPath } from "@/shared/lib/sandbox";
import type { Tool, ToolContext, ToolProvider } from "@/shared/types/chat";
import { useArtifacts } from "./useArtifacts";

function executionFailure(context: ToolContext | undefined, text: string) {
  context?.setError?.({ code: "EXECUTION_ERROR", message: text });
  return [{ type: "text" as const, text }];
}

/**
 * Adapt FileSystemManager into a WritableFileSource for the shared file tools.
 */
function createFsAdapter(fsRef: React.RefObject<FileSystemManager | null>): WritableFileSource {
  const requireFs = () => {
    const fs = fsRef.current;
    if (!fs) throw new Error("File system not available");
    return fs;
  };

  return {
    async list(): Promise<FileEntry[]> {
      const fs = requireFs();
      const entries = await fs.listEntries();
      return entries.map((e) => ({
        path: e.path,
        size: e.size,
        contentType: e.contentType,
      }));
    },

    async read(path: string): Promise<FileData | undefined> {
      const fs = requireFs();
      const file = await fs.getFile(path);
      if (!file) return undefined;
      return { path: file.path, content: file.content, contentType: file.contentType };
    },

    async write(path: string, content: string, contentType?: string): Promise<void> {
      const fs = requireFs();
      await fs.createFile(path, content, contentType);
    },

    async remove(path: string): Promise<boolean> {
      const fs = requireFs();
      return fs.deleteFile(path);
    },

    async move(from: string, to: string): Promise<boolean> {
      const fs = requireFs();
      return fs.renameFile(from, to);
    },
  };
}

export function useArtifactsProvider(): ToolProvider | null {
  const { fs, activeFile, isAvailable } = useArtifacts();

  // Tool functions are compiled once per render and execute later (after a
  // network round trip). We route `fs`/`activeFile` through refs so the tools
  // always see the latest values at execution time — otherwise, if the chat
  // (and thus the filesystem) is created mid-send, tools would run with a
  // stale `fs = null` captured by closure.
  const fsRef = useRef<FileSystemManager | null>(fs);
  fsRef.current = fs;
  const activeFileRef = useRef<string | null>(activeFile);
  activeFileRef.current = activeFile;

  const artifactsTools = useCallback((): Tool[] => {
    const fsAdapter = createFsAdapter(fsRef);
    const fileTools = createFileTools(fsAdapter);

    const contextTools: Tool[] = [
      {
        name: "current_path",
        description: "Get the file path of the currently opened file in the artifacts editor.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
        function: async () => {
          const fs = fsRef.current;
          const activeFile = activeFileRef.current;
          if (!fs) {
            return [{ type: "text" as const, text: JSON.stringify({ error: "File system not available" }) }];
          }

          if (!activeFile) {
            return [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: true,
                  message: "No file is currently active",
                  currentPath: null,
                }),
              },
            ];
          }

          return [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                currentPath: activeFile,
              }),
            },
          ];
        },
      },
      {
        name: "current_file",
        description: "Get the file path and content of the currently opened file in the artifacts editor.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
        function: async () => {
          const fs = fsRef.current;
          const activeFile = activeFileRef.current;
          if (!fs) {
            return [{ type: "text" as const, text: JSON.stringify({ error: "File system not available" }) }];
          }

          try {
            if (!activeFile) {
              return [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    success: true,
                    message: "No file is currently active",
                    currentFile: null,
                  }),
                },
              ];
            }
            const file = await fs.getFile(activeFile);

            if (!file) {
              return [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    error: `Active file not found: ${activeFile}`,
                  }),
                },
              ];
            }

            // Don't emit the base64 payload for binary files — it blows up
            // context and corrupts subsequent tool-call JSON.
            const isBinary = isDataUrl(file.content);
            const fileInfo = isBinary
              ? {
                  path: file.path,
                  contentType: file.contentType,
                  binary: true,
                  note: "Binary file. Use Python/bash tools to process it at /home/user/.",
                }
              : {
                  path: file.path,
                  size: file.content.length,
                  content: file.content,
                  contentType: file.contentType,
                };

            return [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: true,
                  currentFile: fileInfo,
                }),
              },
            ];
          } catch {
            return [{ type: "text" as const, text: JSON.stringify({ error: "Failed to get current file info" }) }];
          }
        },
      },
    ];

    const executionTools: Tool[] = [
      {
        name: "execute_python_code",
        display: {
          header: (_args, state) => ({
            icon: SquareCode,
            label: state.error ? "Code failed" : state.running ? "Executing code…" : "Ran code",
          }),
          input: (args) => {
            const code = typeof args?.code === "string" ? args.code : "";
            return code ? [{ code, language: "python" }] : [];
          },
        },
        description:
          "Execute Python code with optional package dependencies. Pass the full script body in `code` (use `path` instead to run an existing .py artifact). For long scripts heavy with quotes or backslashes (regex, nested strings), prefer writing the script to a .py artifact first and running it via `path` — this avoids JSON-escaping mistakes in the `code` string. All artifact files are available under /home/user/, and files created, modified, or deleted there are synced back.",
        parameters: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "Inline Python code to execute. This is the standard way to run code.",
            },
            path: {
              type: "string",
              description:
                "Optional: path to an existing Python script in the artifacts filesystem to execute (e.g., `/analysis.py`). Ignored when `code` is also provided.",
            },
            packages: {
              type: "array",
              items: { type: "string" },
              description:
                "Optional list of Python packages required (e.g., ['numpy', 'pandas']). These will be available for import.",
            },
          },
          required: [],
        },
        // The whole snapshot → execute → sync-back section runs under the
        // sandbox lock: parallel tool calls would otherwise commit stale
        // full snapshots over each other's outputs (deleteMissing!).
        function: (args: Record<string, unknown>, context?: ToolContext) =>
          withSandboxLock(async () => {
            const fs = fsRef.current;
            const { code } = args;
            const path = normalizeArtifactPath(typeof args.path === "string" ? args.path : undefined);
            // Models occasionally send `packages` as a bare string ("numpy") rather
            // than an array; coerce defensively so `executeCode` never hits a
            // non-array `.map`. (Imports are auto-detected anyway, so this is a hint.)
            const packages = Array.isArray(args.packages)
              ? args.packages.filter((p): p is string => typeof p === "string")
              : typeof args.packages === "string"
                ? [args.packages]
                : undefined;

            try {
              // Load artifact files into Pyodide's VFS
              const artifactFiles: Record<string, { content: string; contentType?: string }> = {};
              if (fs) {
                const snapshot = await fs.getOverlaySnapshot();
                for (const [path, file] of Object.entries(snapshot)) {
                  artifactFiles[path] = { content: file.content, contentType: file.contentType };
                }
              }

              const hasCode = typeof code === "string" && code.trim().length > 0;
              const hasPath = typeof path === "string" && path.length > 0;

              if (!hasCode && !hasPath) {
                return executionFailure(
                  context,
                  "Error executing code: no `code` was received. If you passed inline code, it likely " +
                    "failed to parse from unescaped quotes or backslashes — rewrite it preferring single " +
                    "quotes, or write the script to a `.py` artifact and run it with `path`.",
                );
              }

              // Prefer `code` when both are provided — some models tack on `path`
              // thinking it's a working-directory hint.
              let script = code as string;

              if (!hasCode && hasPath) {
                if (!fs) {
                  return executionFailure(context, "Error executing code: file system not available.");
                }

                const file = await fs.getFile(path);
                if (!file) {
                  return executionFailure(context, `Error executing code: file not found: ${path}`);
                }

                script = file.content;
              }

              const result = await executeCode(
                {
                  code: script,
                  packages,
                  files: artifactFiles,
                },
                { signal: context?.signal },
              );

              if (!result.success) {
                return executionFailure(context, `Error executing code: ${result.error || "Unknown error"}`);
              }

              // Sync changed files back to artifacts and surface the ones written
              // so the chat can show them as chips on the assistant's response.
              if (fs && result.files) {
                const summary = await fs.applyOverlaySnapshot(result.files, { deleteMissing: true });
                const written = [...summary.createdPaths, ...summary.updatedPaths];
                if (written.length > 0) context?.setMeta?.({ artifactFiles: written });
              }

              return [{ type: "text" as const, text: result.output }];
            } catch (error) {
              return executionFailure(
                context,
                `Code execution failed: ${error instanceof Error ? error.message : "Unknown error"}`,
              );
            }
          }),
      },
      {
        name: "execute_bash_code",
        display: {
          header: (args, state) => {
            const command = String(args?.command ?? "").trim();
            return command
              ? { icon: SquareTerminal, label: command, mono: true, suppressPreview: true }
              : { icon: SquareTerminal, label: state.error ? "Command failed" : "Running command…" };
          },
          input: (args) => {
            const command = String(args?.command ?? "").trim();
            return command ? [{ code: command, language: "bash" }] : [];
          },
        },
        description:
          "Execute bash commands or scripts in a sandboxed shell. All artifact files are preloaded and any files created, modified, or deleted are synced back. Prefer explicit paths rather than relying on prior shell state. Supports pipes, redirections, loops, variables, jq, yq, xan, sqlite3, grep, sed, awk, and more.",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description:
                "The bash command or script to execute. Supports full shell syntax: pipes (|), redirections (>, >>), chaining (&&, ||, ;), variables, loops, functions, and glob patterns.",
            },
          },
          required: ["command"],
        },
        // Runs under the sandbox lock for the same reason as the Python tool —
        // and because the bash runtime itself is a singleton working tree.
        function: (args: Record<string, unknown>, context?: ToolContext) =>
          withSandboxLock(async () => {
            const fs = fsRef.current;
            const { command } = args;

            if (typeof command !== "string" || !command.trim()) {
              return executionFailure(context, "Error: `command` is required (a non-empty bash command or script).");
            }

            try {
              // Load artifact files into bash's InMemoryFs before execution.
              // Reconcile even without an artifacts fs — the singleton persists
              // across chats, so skipping this would leave a previous chat's
              // files readable here.
              const { memFs } = getSingleton();
              const snapshot = fs ? await fs.getOverlaySnapshot() : {};
              const artifactFiles = Object.entries(snapshot).map(([path, file]) => ({
                path,
                content: file.content,
                contentType: file.contentType,
              }));
              await loadArtifactsIntoFs(memFs, artifactFiles);

              const result = await executeBash({
                command,
              });

              // Save changed files back to artifacts after execution and surface
              // the ones written so the chat can show them as chips on the
              // assistant's response.
              if (fs) {
                const currentFiles = await readFilesFromFs(memFs);

                const summary = await fs.applyOverlaySnapshot(currentFiles, { deleteMissing: true });
                const written = [...summary.createdPaths, ...summary.updatedPaths];
                if (written.length > 0) context?.setMeta?.({ artifactFiles: written });
              }

              const parts: string[] = [];
              if (result.stdout) parts.push(result.stdout);
              if (result.stderr) parts.push(`stderr: ${result.stderr}`);
              if (result.exitCode !== 0) parts.push(`exit code: ${result.exitCode}`);

              const output = parts.join("\n") || "Command executed successfully (no output)";

              if (!result.success) {
                return executionFailure(context, `Error: ${output}`);
              }

              return [{ type: "text" as const, text: output }];
            } catch (error) {
              return executionFailure(
                context,
                `Bash execution failed: ${error instanceof Error ? error.message : "Unknown error"}`,
              );
            }
          }),
      },
    ];

    return [...fileTools, ...contextTools, ...executionTools];
    // Refs are intentionally not dependencies — the callback needs to produce
    // a stable tool array so downstream memoization doesn't thrash. Tool
    // functions read the latest `fs`/`activeFile` via refs at execution time.
  }, []);

  const provider = useMemo<ToolProvider | null>(() => {
    if (!isAvailable) {
      return null;
    }

    return {
      id: "artifacts",
      name: "Artifacts",
      description: "Create and edit files, run Python and Bash code",
      icon: Shapes,
      instructions: [
        artifactsInstructionsText,
        interpreterInstructionsText,
        officeInstructionsText,
        llmInstructionsText,
        // Only advertise the `ocr`, `vision`, `render`, `synthesize`,
        // `transcribe`, and `translate` helpers when their backing services
        // are configured.
        ...(getConfig().extractor ? [ocrInstructionsText] : []),
        ...(getConfig().vision ? [visionInstructionsText] : []),
        ...(getConfig().renderer ? [renderInstructionsText] : []),
        ...(getConfig().tts ? [synthesizeInstructionsText] : []),
        ...(getConfig().stt ? [transcribeInstructionsText] : []),
        ...(getConfig().translator ? [translateInstructionsText] : []),
      ].join("\n\n"),
      tools: artifactsTools(),
    };
  }, [isAvailable, artifactsTools]);

  return provider;
}
