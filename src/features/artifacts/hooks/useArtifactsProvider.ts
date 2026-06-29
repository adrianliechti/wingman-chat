import { Braces, Shapes, SquareCode, SquareTerminal } from "lucide-react";
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
import { executeJavaScript } from "@/features/tools/lib/javascript";
import { withSandboxLock } from "@/features/tools/lib/sandboxLock";
import { mountSkillFiles } from "@/features/tools/lib/skillResourceMount";
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

// A rotating, playful verb for the "running code" indicator. Seeded off the
// snippet so it's stable across re-renders of the same call but varies between
// calls — keeps a tool-heavy turn from reading as a wall of "Executing code…".
const RUNNING_CODE_WORDS = [
  "Coding",
  "Programming",
  "Computing",
  "Crunching",
  "Calculating",
  "Compiling",
  "Executing",
  "Processing",
  "Churning",
  "Crafting",
  "Tinkering",
  "Cooking",
  "Synthesizing",
  "Wrangling",
  "Reticulating",
];

function runningCodeLabel(code: unknown): string {
  const text = typeof code === "string" ? code : "";
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return `${RUNNING_CODE_WORDS[Math.abs(hash) % RUNNING_CODE_WORDS.length]}…`;
}

/** Coerce a tool arg into a string[] (models sometimes send a bare string). */
function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return typeof value === "string" ? [value] : [];
}

type SandboxFiles = Record<string, { content: string; contentType?: string }>;

/**
 * Merge a skill's mounted resources into the sandbox file map, returning the
 * keys actually injected (skipping any that would shadow a real artifact). The
 * caller strips these from the post-run snapshot so read-only skill resources
 * never persist as artifacts.
 */
function mergeSkillFiles(base: SandboxFiles, skillFiles: SandboxFiles): Set<string> {
  const injected = new Set<string>();
  for (const [path, file] of Object.entries(skillFiles)) {
    if (path in base) continue;
    base[path] = file;
    injected.add(path);
  }
  return injected;
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
          header: (args, state) => ({
            icon: SquareCode,
            label: state.error ? "Code failed" : state.running ? runningCodeLabel(args?.code) : "Ran code",
          }),
          input: (args) => {
            const code = typeof args?.code === "string" ? args.code : "";
            return code ? [{ code, language: "python" }] : [];
          },
        },
        description:
          "Execute Python code with optional package dependencies. Pass the full script body in `code` (use `path` instead to run an existing .py artifact). For long scripts heavy with quotes or backslashes (regex, nested strings), prefer writing the script to a .py artifact first and running it via `path` — this avoids JSON-escaping mistakes in the `code` string. All artifact files are available under /home/user/, and files created, modified, or deleted there are synced back. To run a skill's bundled scripts, pass its name(s) in `skills`: its resources mount read-only under /home/user/skills/<name>/ for that run (e.g. `import runpy; runpy.run_path('skills/<name>/scripts/extract.py')`).",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            code: {
              type: ["string", "null"],
              description: "Inline Python code to execute. This is the standard way to run code.",
            },
            path: {
              type: ["string", "null"],
              description:
                "Optional: path to an existing Python script in the artifacts filesystem to execute (e.g., `/analysis.py`). Ignored when `code` is also provided.",
            },
            packages: {
              type: ["array", "null"],
              items: { type: "string" },
              description:
                "Optional list of Python packages required (e.g., ['numpy', 'pandas']). These will be available for import.",
            },
            skills: {
              type: ["array", "null"],
              items: { type: "string" },
              description:
                "Optional skill names whose bundled resources to mount under /home/user/skills/<name>/ for this run (use the resource paths from read_skill). Mounted read-only; not saved as artifacts.",
            },
          },
          required: ["code", "path", "packages", "skills"],
          additionalProperties: false,
        },
        // The whole snapshot → execute → sync-back section runs under the
        // sandbox lock: parallel tool calls would otherwise commit stale
        // full snapshots over each other's outputs (deleteMissing!).
        function: (args: Record<string, unknown>, context?: ToolContext) =>
          withSandboxLock(async () => {
            const fs = fsRef.current;
            const { code } = args;
            const path = normalizeArtifactPath(typeof args.path === "string" ? args.path : undefined);
            // Imports are auto-detected, so `packages` is just a hint; coerce
            // defensively since models occasionally send a bare string.
            const packages = asStringArray(args.packages);

            try {
              // Load artifact files into Pyodide's VFS, then mount any requested
              // skills' bundled resources read-only for this run.
              const artifactFiles: SandboxFiles = {};
              if (fs) {
                const snapshot = await fs.getOverlaySnapshot();
                for (const [path, file] of Object.entries(snapshot)) {
                  artifactFiles[path] = { content: file.content, contentType: file.contentType };
                }
              }
              const skillKeys = mergeSkillFiles(artifactFiles, await mountSkillFiles(asStringArray(args.skills)));

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
                  packages: packages.length ? packages : undefined,
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
                // Drop the read-only skill resources we mounted so they don't
                // persist as artifacts (they were never part of the overlay).
                for (const key of skillKeys) delete result.files[key];
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
        name: "execute_javascript_code",
        display: {
          header: (args, state) => ({
            icon: Braces,
            label: state.error ? "Code failed" : state.running ? runningCodeLabel(args?.code) : "Ran code",
          }),
          input: (args) => {
            const code = typeof args?.code === "string" ? args.code : "";
            return code ? [{ code, language: "javascript" }] : [];
          },
        },
        description:
          "Execute JavaScript in a sandboxed Web Worker (off the UI thread, isolated from the page, no network). " +
          "Use it for browser-native work: WebCodecs, OffscreenCanvas, createImageBitmap, crypto.subtle, WebAssembly, " +
          "TextEncoder/Decoder, and bundled libraries available as globals when referenced: `mediabunny` (media " +
          "transcoding), `echarts` (headless SSR charts → SVG), and `jsPDF` (PDF generation). Files are NOT mounted " +
          "as a real filesystem — read and write artifacts through the injected " +
          "`vfs` helper: `vfs.read(path)` / `vfs.readBytes(path)` / `vfs.readJSON(path)` and `vfs.write(path, data, " +
          "contentType?)` / `vfs.writeBytes` / `vfs.writeJSON`, plus `vfs.list()`, `vfs.exists(path)`, `vfs.remove(path)`. " +
          "Paths are artifact paths like `/data.csv`. `fetch('/data.csv')` also reads the VFS (remote URLs are blocked). " +
          "Anything you write or delete via `vfs` is synced back as artifacts. Use top-level `await` directly, and " +
          "`return` a value or `console.log(...)` to produce output. Pass the full script in `code`, or `path` to run an " +
          "existing .js artifact. For heavy data/number crunching or document libraries, Python (`execute_python_code`) " +
          "is usually the stronger fit — they share the filesystem, so you can do that step there and read the result back here.",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            code: {
              type: ["string", "null"],
              description: "Inline JavaScript to execute. This is the standard way to run code.",
            },
            path: {
              type: ["string", "null"],
              description:
                "Optional: path to an existing JavaScript artifact to execute (e.g., `/transform.js`). Ignored when `code` is also provided.",
            },
          },
          required: ["code", "path"],
          additionalProperties: false,
        },
        // Same snapshot → execute → sync-back section under the sandbox lock as
        // the Python/Bash tools: parallel tool calls would otherwise commit
        // stale full snapshots over each other's outputs.
        function: (args: Record<string, unknown>, context?: ToolContext) =>
          withSandboxLock(async () => {
            const fs = fsRef.current;
            const { code } = args;
            const path = normalizeArtifactPath(typeof args.path === "string" ? args.path : undefined);

            try {
              const artifactFiles: SandboxFiles = {};
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
                    "quotes, or write the script to a `.js` artifact and run it with `path`.",
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

              const result = await executeJavaScript(
                { code: script, files: artifactFiles },
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
            const command = typeof args?.command === "string" ? args.command.trim() : "";
            // Frame the command with a verb (and show the command as the mono
            // preview) so it reads like the other tools across every state.
            const label = state.error ? "Command failed" : state.running ? "Running" : "Ran";
            return command
              ? { icon: SquareTerminal, label, preview: command }
              : { icon: SquareTerminal, label: state.running ? "Running…" : label };
          },
          input: (args) => {
            const command = typeof args?.command === "string" ? args.command.trim() : "";
            return command ? [{ code: command, language: "bash" }] : [];
          },
        },
        description:
          "Execute bash commands or scripts in a sandboxed shell. All artifact files are preloaded and any files created, modified, or deleted are synced back. Prefer explicit paths rather than relying on prior shell state. Supports pipes, redirections, loops, variables, jq, yq, xan, sqlite3, grep, sed, awk, and more. To use a skill's bundled resources (data files, references, shell scripts), pass its name(s) in `skills`: they mount read-only under /home/user/skills/<name>/ for that run.",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description:
                "The bash command or script to execute. Supports full shell syntax: pipes (|), redirections (>, >>), chaining (&&, ||, ;), variables, loops, functions, and glob patterns.",
            },
            skills: {
              type: ["array", "null"],
              items: { type: "string" },
              description:
                "Optional skill names whose bundled resources to mount under /home/user/skills/<name>/ for this run (use the resource paths from read_skill). Mounted read-only; not saved as artifacts.",
            },
          },
          required: ["command", "skills"],
          additionalProperties: false,
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
              // Load artifact files into bash's InMemoryFs before execution, then
              // mount any requested skills' resources read-only for this run.
              // Reconcile even without an artifacts fs — the singleton persists
              // across chats, so skipping this would leave a previous chat's
              // files readable here.
              const { memFs } = getSingleton();
              const fileMap: SandboxFiles = {};
              if (fs) {
                const snapshot = await fs.getOverlaySnapshot();
                for (const [path, file] of Object.entries(snapshot)) {
                  fileMap[path] = { content: file.content, contentType: file.contentType };
                }
              }
              const skillKeys = mergeSkillFiles(fileMap, await mountSkillFiles(asStringArray(args.skills)));
              const artifactFiles = Object.entries(fileMap).map(([path, file]) => ({
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
              // assistant's response. Strip mounted skill resources so they don't
              // persist as artifacts.
              if (fs) {
                const currentFiles = await readFilesFromFs(memFs);
                for (const key of skillKeys) delete currentFiles[key];

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
