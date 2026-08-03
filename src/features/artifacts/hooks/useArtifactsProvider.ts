import { Braces, Shapes, SquareCode } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";
import { ARTIFACT_VALIDATORS, validateArtifactFile } from "@/features/artifacts/lib/artifactValidators";
import {
  JAVASCRIPT_EXECUTION_PARAMETERS,
  PYTHON_EXECUTION_PARAMETERS,
} from "@/features/artifacts/lib/executionToolSchemas";
import type { FileSystemManager } from "@/features/artifacts/lib/fs";
import artifactsInstructionsText from "@/features/artifacts/prompts/artifacts.txt?raw";
import interpreterInstructionsText from "@/features/artifacts/prompts/interpreter.txt?raw";
import llmInstructionsText from "@/features/artifacts/prompts/llm.txt?raw";
import ocrInstructionsText from "@/features/artifacts/prompts/ocr.txt?raw";
import officeInstructionsText from "@/features/artifacts/prompts/office.txt?raw";
import rasterizeInstructionsText from "@/features/artifacts/prompts/rasterize.txt?raw";
import renderInstructionsText from "@/features/artifacts/prompts/render.txt?raw";
import synthesizeInstructionsText from "@/features/artifacts/prompts/synthesize.txt?raw";
import transcribeInstructionsText from "@/features/artifacts/prompts/transcribe.txt?raw";
import translateInstructionsText from "@/features/artifacts/prompts/translate.txt?raw";
import visionInstructionsText from "@/features/artifacts/prompts/vision.txt?raw";
import { executeCode } from "@/features/tools/lib/interpreter";
import { executeJavaScript } from "@/features/tools/lib/javascript";
import { AGENT_CODE_OUTPUT_MAX_BYTES } from "@/features/tools/lib/executionLimits";
import { withSandboxLock } from "@/features/tools/lib/sandboxLock";
import { mountSkillFiles } from "@/features/tools/lib/skillResourceMount";
import { getConfig } from "@/shared/config";
import { formatArtifactValidationIssue } from "@/shared/lib/artifact-validation";
import { createFileTools, type FileData, type FileEntry, type WritableFileSource } from "@/shared/lib/file-tools";
import { isDataUrl } from "@/shared/lib/fileContent";
import { normalizeArtifactPath } from "@/shared/lib/sandbox";
import { artifactDelta } from "@/shared/types/artifact";
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

interface SnapshotValidation {
  errors: string[];
  warnings: string[];
}

/** Validate changed artifacts after an executor snapshot is committed. */
async function validateChangedArtifactFiles(before: SandboxFiles, after: SandboxFiles): Promise<SnapshotValidation> {
  const report: SnapshotValidation = { errors: [], warnings: [] };
  for (const [path, file] of Object.entries(after)) {
    const previous = before[path];
    if (previous?.content === file.content && previous.contentType === file.contentType) continue;
    const validation = await validateArtifactFile({ path, content: file.content, contentType: file.contentType });
    report.errors.push(...validation.errors.map((issue) => `${path}: ${formatArtifactValidationIssue(issue)}`));
    report.warnings.push(...validation.warnings.map((issue) => `${path}: ${formatArtifactValidationIssue(issue)}`));
  }
  return report;
}

function formatSnapshotValidation(report: SnapshotValidation): string {
  const sections: string[] = [];
  if (report.errors.length) {
    sections.push(
      `Validation errors (files were saved; continue editing and fix before finishing):\n${report.errors
        .map((error) => `- ${error}`)
        .join("\n")}`,
    );
  }
  if (report.warnings.length) {
    sections.push(`Validation warnings:\n${report.warnings.map((warning) => `- ${warning}`).join("\n")}`);
  }
  return sections.length ? `\n${sections.join("\n")}` : "";
}

type SandboxExecutor = (
  request: Parameters<typeof executeCode>[0],
  options?: Parameters<typeof executeCode>[1],
) => ReturnType<typeof executeCode>;

/** Shared snapshot → execute → commit pipeline for both interpreter tools. */
async function runArtifactCode(options: {
  args: Record<string, unknown>;
  context?: ToolContext;
  executor: SandboxExecutor;
  extension: "py" | "js";
  fs: FileSystemManager | null;
  mountSkills?: boolean;
}) {
  const { args, context, executor, extension, fs, mountSkills = false } = options;
  const inlineCode = typeof args.code === "string" ? args.code : "";
  const path = normalizeArtifactPath(typeof args.path === "string" ? args.path : undefined);

  try {
    const artifactFiles: SandboxFiles = fs ? await fs.getOverlaySnapshot() : {};
    const skillKeys = mountSkills ? mergeSkillFiles(artifactFiles, await mountSkillFiles()) : new Set<string>();
    const hasCode = inlineCode.trim().length > 0;
    const hasPath = Boolean(path);

    if (!hasCode && !hasPath) {
      return executionFailure(
        context,
        "Error executing code: no `code` was received. If inline code failed to parse, escape quotes and " +
          `backslashes or write it to a \`.${extension}\` artifact and run it with \`path\`.`,
      );
    }

    // Prefer inline code: providers sometimes append `path` as if it were a
    // working-directory hint even though the schema describes a selector.
    let script = inlineCode;
    if (!hasCode && path) {
      if (!fs) return executionFailure(context, "Error executing code: file system not available.");
      const file = await fs.getFile(path);
      if (!file) return executionFailure(context, `Error executing code: file not found: ${path}`);
      script = file.content;
    }

    const result = await executor(
      { code: script, files: artifactFiles, limits: { maxOutputBytes: AGENT_CODE_OUTPUT_MAX_BYTES } },
      { signal: context?.signal },
    );
    if (!result.success) {
      return executionFailure(context, `Error executing code: ${result.error || "Unknown error"}`);
    }

    let artifactValidation: SnapshotValidation = { errors: [], warnings: [] };
    if (fs && result.files) {
      for (const key of skillKeys) delete result.files[key];
      const summary = await fs.applyOverlaySnapshot(result.files, { deleteMissing: true });
      if (summary.mutations.length > 0) {
        context?.setMeta?.({
          artifactFiles: [...summary.createdPaths, ...summary.updatedPaths],
          artifactDelta: artifactDelta(summary.mutations),
        });
      }
      artifactValidation = await validateChangedArtifactFiles(artifactFiles, result.files);
    }

    return [{ type: "text" as const, text: result.output + formatSnapshotValidation(artifactValidation) }];
  } catch (error) {
    return executionFailure(
      context,
      `Code execution failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
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
      return {
        path: file.path,
        content: file.content,
        contentType: file.contentType,
      };
    },

    async write(path: string, content: string, contentType?: string) {
      const fs = requireFs();
      const mutation = await fs.createFile(path, content, contentType);
      return mutation ? [mutation] : [];
    },

    async remove(path: string) {
      const fs = requireFs();
      return fs.deleteFileWithDelta(path);
    },

    async move(from: string, to: string) {
      const fs = requireFs();
      return fs.renameFileWithDelta(from, to);
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
    const fileTools = createFileTools(fsAdapter, { validators: ARTIFACT_VALIDATORS });

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
                  note: file.contentType?.startsWith("image/")
                    ? "Binary image. If it is visible in the conversation, inspect it directly with built-in vision. Otherwise use the vision/OCR helper only as needed."
                    : "Binary file. Use the appropriate Python or JavaScript library only when programmatic processing is needed.",
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
          "Execute Python code when the task requires computation, programmatic file processing, transformation, batch work, or file generation. Do not use it merely to inspect or OCR an image already included in the user's message; use built-in vision for that. Pass the full script body in `code` (use `path` instead to run an existing .py artifact). For long scripts heavy with quotes or backslashes (regex, nested strings), prefer writing the script to a .py artifact first and running it via `path` — this avoids JSON-escaping mistakes in the `code` string. All artifact files are available under /home/user/, and files created, modified, or deleted there are synced back. The user's selected skills have bundled resources mounted read-only under /home/user/skills/<name>/ (e.g. `import runpy; runpy.run_path('skills/<name>/scripts/extract.py')`).",
        // Keep this schema-guided rather than provider-compiled: the combined
        // artifact toolbox otherwise exceeds Anthropic's strict-schema budget.
        strict: false,
        parameters: PYTHON_EXECUTION_PARAMETERS,
        // The whole snapshot → execute → sync-back section runs under the
        // sandbox lock: parallel tool calls would otherwise commit stale
        // full snapshots over each other's outputs (deleteMissing!).
        function: (args: Record<string, unknown>, context?: ToolContext) =>
          withSandboxLock(() =>
            runArtifactCode({
              args,
              context,
              executor: executeCode,
              extension: "py",
              fs: fsRef.current,
              mountSkills: true,
            }),
          ),
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
          "Use it only when the task requires actual execution; do not use it merely to inspect or OCR an image " +
          "already included in the user's message, which the chat model can inspect with built-in vision. " +
          "Use it for browser-native work: WebCodecs, OffscreenCanvas, createImageBitmap, crypto.subtle, WebAssembly, " +
          "TextEncoder/Decoder, and bundled libraries available as globals when referenced: `mediabunny` (media " +
          "transcoding), `echarts` (headless SSR charts → SVG), `echartsSource` (browser bundle string for " +
          "self-contained interactive chart HTML), and `jsPDF` (PDF generation). Files are NOT mounted " +
          "as a real filesystem — read and write artifacts through the injected " +
          "`vfs` helper: `vfs.read(path)` / `vfs.readBytes(path)` / `vfs.readJSON(path)` and `vfs.write(path, data, " +
          "contentType?)` / `vfs.writeBytes` / `vfs.writeJSON`, plus `vfs.list()`, `vfs.exists(path)`, `vfs.remove(path)`. " +
          "Paths are artifact paths like `/data.csv`. `fetch('/data.csv')` also reads the VFS (remote URLs are blocked). " +
          "Anything you write or delete via `vfs` is synced back as artifacts. Use top-level `await` directly, and " +
          "`return` a value or `console.log(...)` to produce output. Pass the full script in `code`, or `path` to run an " +
          "existing .js artifact. For heavy data/number crunching or document libraries, Python (`execute_python_code`) " +
          "is usually the stronger fit — they share the filesystem, so you can do that step there and read the result back here.",
        strict: false,
        parameters: JAVASCRIPT_EXECUTION_PARAMETERS,
        // Same snapshot → execute → sync-back section under the sandbox lock as
        // the Python tool: parallel tool calls would otherwise commit
        // stale full snapshots over each other's outputs.
        function: (args: Record<string, unknown>, context?: ToolContext) =>
          withSandboxLock(() =>
            runArtifactCode({
              args,
              context,
              executor: executeJavaScript,
              extension: "js",
              fs: fsRef.current,
            }),
          ),
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
      description: "Create and edit files, run Python and JavaScript code",
      icon: Shapes,
      instructions: [
        artifactsInstructionsText,
        interpreterInstructionsText,
        officeInstructionsText,
        // Always available — pdf.js rasterization needs no backing service.
        rasterizeInstructionsText,
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
