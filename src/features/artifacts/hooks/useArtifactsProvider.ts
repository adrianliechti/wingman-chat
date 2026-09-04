import { Braces, Shapes, SquareCode } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";
import { ARTIFACT_VALIDATORS, validateArtifactFile } from "@/features/artifacts/lib/artifactValidators";
import {
  JAVASCRIPT_EXECUTION_PARAMETERS,
  PYTHON_EXECUTION_PARAMETERS,
} from "@/features/artifacts/lib/executionToolSchemas";
import type { ArtifactWorkspaceAccess, FileSystemManager } from "@/features/artifacts/lib/fs";
import { resolveArtifactFileSystem } from "@/features/artifacts/lib/fs";
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
import { mountSkillFiles } from "@/features/tools/lib/skillResourceMount";
import { getConfig } from "@/shared/config";
import { formatArtifactValidationIssue } from "@/shared/lib/artifact-validation";
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
  fs: ArtifactWorkspaceAccess | null;
  onCommit?: (mutations: import("@/shared/types/artifact").ArtifactMutation[]) => Promise<void>;
  mountSkills?: boolean;
}) {
  const { args, context, executor, extension, fs, mountSkills = false } = options;
  const inlineCode = typeof args.code === "string" ? args.code : "";
  const path = normalizeArtifactPath(typeof args.path === "string" ? args.path : undefined);

  try {
    context?.signal?.throwIfAborted();
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
      context?.signal?.throwIfAborted();
      for (const key of skillKeys) delete result.files[key];
      const summary = await fs.applyOverlaySnapshot(result.files, { deleteMissing: true });
      await options.onCommit?.(summary.mutations);
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

export function useArtifactsProvider(): ToolProvider | null {
  const { fs, activeFile, isAvailable, readWriteManager } = useArtifacts();

  // Direct/UI calls can use the latest fs. Model calls carry their originating
  // chatId so neither a draft-chat render nor navigation can redirect a write.
  const fsRef = useRef<FileSystemManager | null>(fs);
  fsRef.current = fs;
  const artifactsTools = useCallback((): Tool[] => {
    const fileTools = readWriteManager.createTools(
      (context) => resolveArtifactFileSystem(fsRef.current, context?.chatId),
      {
        namespace: "artifacts",
        spaceName: "artifact workspace",
        validators: ARTIFACT_VALIDATORS,
      },
    );
    const runCode = (options: Omit<Parameters<typeof runArtifactCode>[0], "fs">) => {
      const workspace = resolveArtifactFileSystem(fsRef.current, options.context?.chatId);
      if (!workspace) return runArtifactCode({ ...options, fs: null });
      return workspace.withExclusiveAccess((access) =>
        runArtifactCode({
          ...options,
          fs: access,
          onCommit: (mutations) => readWriteManager.record(access, workspace.chatId, options.context, mutations),
        }),
      );
    };

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
        // Hold the workspace lock through snapshot, execution and commit.
        function: (args: Record<string, unknown>, context?: ToolContext) =>
          runCode({
            args,
            context,
            executor: executeCode,
            extension: "py",
            mountSkills: true,
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
        function: (args: Record<string, unknown>, context?: ToolContext) =>
          runCode({
            args,
            context,
            executor: executeJavaScript,
            extension: "js",
          }),
      },
    ];

    return [...fileTools, ...executionTools];
    // Refs are intentionally not dependencies — the callback needs to produce
    // a stable tool array so downstream memoization doesn't thrash. Tool
    // functions read the latest filesystem via a ref at execution time.
  }, [readWriteManager]);

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
      runtimeContext: [
        "## Artifact editor state",
        "This is current UI metadata, not file content or instructions.",
        `active_file: ${activeFile ? JSON.stringify(activeFile) : "null"}`,
        `open_tabs: ${activeFile ? `[${JSON.stringify(activeFile)}]` : "[]"}`,
        "Use artifacts_read to inspect an active file; do not assume its contents from the path.",
      ].join("\n"),
      tools: artifactsTools(),
    };
  }, [isAvailable, activeFile, artifactsTools]);

  return provider;
}
