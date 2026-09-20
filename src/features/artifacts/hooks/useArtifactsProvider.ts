import { Braces, Shapes, SquareCode } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";
import { ARTIFACT_VALIDATORS } from "@/features/artifacts/lib/artifactValidators";
import {
  JAVASCRIPT_EXECUTION_PARAMETERS,
  PYTHON_EXECUTION_PARAMETERS,
} from "@/features/artifacts/lib/executionToolSchemas";
import type { FileSystemManager } from "@/features/artifacts/lib/fs";
import { resolveArtifactFileSystem } from "@/features/artifacts/lib/fs";
import { queryableMountNames } from "@/features/artifacts/lib/duckdbWorkspace";
import { useArtifactEntries } from "./useArtifactFiles";
import artifactsInstructionsText from "@/features/artifacts/prompts/artifacts.txt?raw";
import bridgeInstructionsText from "@/features/artifacts/prompts/bridge.txt?raw";
import duckdbInstructionsText from "@/features/artifacts/prompts/duckdb.txt?raw";
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
import { getConfig } from "@/shared/config";
import { executeArtifactCode } from "../lib/executeArtifactCode";
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

export function useArtifactsProvider(): ToolProvider | null {
  const { fs, activeFile, isAvailable, readWriteManager } = useArtifacts();
  const entries = useArtifactEntries(fs);
  const duckdbEnabled = getConfig().artifacts?.bridge !== false && getConfig().artifacts?.duckdb !== false;
  const queryable = duckdbEnabled ? queryableMountNames(entries.map((entry) => entry.path)) : [];
  const queryableKey = queryable.join("\n");

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
    const runCode = async (options: Omit<Parameters<typeof executeArtifactCode>[0], "fs">) => {
      const workspace = resolveArtifactFileSystem(fsRef.current, options.context?.chatId);
      const result = await executeArtifactCode({
        ...options,
        fs: workspace,
        limits: { maxOutputBytes: AGENT_CODE_OUTPUT_MAX_BYTES },
        onCommit: (access, mutations) => readWriteManager.record(access, workspace!.chatId, options.context, mutations),
      });
      return result.success
        ? [{ type: "text" as const, text: result.output }]
        : executionFailure(options.context, result.error || "Unknown execution error");
    };

    const executionTools: Tool[] = [
      {
        name: "execute_python_code",
        display: {
          header: (args, state) => ({
            icon: SquareCode,
            label: state.error ? "Code hit a snag" : state.running ? runningCodeLabel(args?.code) : "Ran code",
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
            label: state.error ? "Code hit a snag" : state.running ? runningCodeLabel(args?.code) : "Ran code",
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
          "transcoding), `echarts` (SVG SSR charts), `jsPDF` (PDF). HTML pages load browser libraries from the " +
          "virtual `/.lib/` folder (`/.lib/echarts.js`, `/.lib/three.js`, `/.lib/lucide.js`); never write library " +
          "source into the workspace or into a page. " +
          "Files are NOT mounted " +
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
        // HTML pages can call back into the app; SQL needs the DuckDB host too.
        ...(getConfig().artifacts?.bridge !== false ? [bridgeInstructionsText] : []),
        ...(getConfig().artifacts?.bridge !== false && getConfig().artifacts?.duckdb !== false
          ? [duckdbInstructionsText]
          : []),
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
        ...(duckdbEnabled
          ? [
              `duckdb_files: ${JSON.stringify(queryable)}`,
              "These workspace files are queryable by name with DuckDB (wingman.duckdb in HTML, sql() in the interpreters).",
            ]
          : []),
      ].join("\n"),
      tools: artifactsTools(),
    };
    // queryableKey stands in for the derived array so the memo only changes with its content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAvailable, activeFile, artifactsTools, duckdbEnabled, queryableKey]);

  return provider;
}
