import { Shapes } from "lucide-react";
import { useCallback, useMemo } from "react";
import { ARTIFACT_VALIDATORS } from "@/features/artifacts/lib/artifactValidators";
import { SCRIPT_EXECUTION_PARAMETERS } from "@/features/artifacts/lib/executionToolSchemas";
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
import { AGENT_CODE_OUTPUT_MAX_BYTES } from "@/features/tools/lib/executionLimits";
import { getConfig } from "@/shared/config";
import { executeScript } from "../lib/executeScript";
import { SCRIPT_EXECUTION_DISPLAY } from "../lib/executionToolDisplay";
import type { Tool, ToolContext, ToolProvider } from "@/shared/types/chat";
import { useArtifacts } from "./useArtifacts";

function executionFailure(context: ToolContext | undefined, text: string) {
  context?.setError?.({ code: "EXECUTION_ERROR", message: text });
  return [{ type: "text" as const, text }];
}

export function useArtifactsProvider(): ToolProvider | null {
  const { fs, activeFile, isAvailable, readWriteManager } = useArtifacts();
  const entries = useArtifactEntries(fs);
  const duckdbEnabled = getConfig().artifacts?.bridge !== false && getConfig().artifacts?.duckdb !== false;
  // Keyed by content so the provider only changes when the queryable set does.
  const queryableKey = JSON.stringify(duckdbEnabled ? queryableMountNames(entries.map((entry) => entry.path)) : []);
  const queryable = useMemo(() => JSON.parse(queryableKey) as string[], [queryableKey]);

  // Direct/UI calls use the active fs. Model calls carry their originating
  // chatId so neither a draft-chat render nor navigation can redirect a write.
  const artifactsTools = useCallback((): Tool[] => {
    const fileTools = readWriteManager.createTools((context) => resolveArtifactFileSystem(fs, context?.chatId), {
      namespace: "artifacts",
      spaceName: "artifact workspace",
      validators: ARTIFACT_VALIDATORS,
    });
    const runCode = async (options: Omit<Parameters<typeof executeScript>[0], "fs">) => {
      const workspace = resolveArtifactFileSystem(fs, options.context?.chatId);
      const result = await executeScript({
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
        name: "execute_script",
        display: SCRIPT_EXECUTION_DISPLAY,
        description:
          "Execute Python, JavaScript, or Bash in a sandboxed Web Worker over the shared artifact workspace. " +
          "Pass inline `code` with `language` (python, javascript, bash), or `path` to an artifact script or selected " +
          "skill resource. File scripts select their interpreter from a shebang or extension (.py, .js/.mjs/.cjs, " +
          ".sh/.bash); `language` overrides detection. For long or bundled scripts prefer `path`. " +
          'Pass literal script arguments in `args`: Python sys.argv[1:], JavaScript process.argv.slice(2), Bash $1/$2/"$@". ' +
          "Use Python for computation, data analysis and document libraries; JavaScript for browser media APIs, " +
          "OffscreenCanvas and bundled browser libraries; Bash for shell scripts, pipelines and file/text processing. " +
          "Do not execute code merely to inspect or OCR an image already included in the user's message. " +
          "Python and Bash mount artifacts under /home/user/ (the working directory). JavaScript uses " +
          "vfs.read/readBytes/readJSON, vfs.write/writeBytes/writeJSON, vfs.list/exists/remove with artifact paths " +
          "like /data.csv. Local fetch reads VFS; direct remote networking is disabled. All runtimes sync created, modified " +
          "and deleted artifacts on success; failures do not commit. Selected skill resources are under " +
          "/home/user/skills/<name>/ (JavaScript VFS: /skills/<name>/); treat them as read-only and save outputs elsewhere. " +
          "Python file scripts have __file__ and sibling imports; JavaScript has __filename/__dirname; Bash has " +
          "$0, and can invoke bash/sh scripts. Bash provides virtual Unix commands, not a host shell: " +
          "no installed system binaries, Python/Node commands or package installation. It offers `llm` and configured " +
          "`ocr`/`extract` service commands through the same app bridges as Python; see their helper instructions. Invoke this tool " +
          "again with the appropriate language for Python or JavaScript. JavaScript has no DOM or Node runtime; " +
          "use top-level await and console.log or return, and vfs for files. Python imports load bundled offline packages. " +
          "Use an HTML artifact for interactive interfaces; browser libraries are available under /.lib/.",
        parameters: SCRIPT_EXECUTION_PARAMETERS,
        function: (args: Record<string, unknown>, context?: ToolContext) => runCode({ args, context }),
      },
    ];

    return [...fileTools, ...executionTools];
  }, [readWriteManager, fs]);

  const provider = useMemo<ToolProvider | null>(() => {
    if (!isAvailable) {
      return null;
    }

    return {
      id: "artifacts",
      name: "Artifacts",
      description: "Create and edit files, run Python, JavaScript and Bash scripts",
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
              "These workspace files are queryable by name with DuckDB (wingman.duckdb in HTML, sql() in Python/JavaScript).",
            ]
          : []),
      ].join("\n"),
      tools: artifactsTools(),
    };
  }, [isAvailable, activeFile, artifactsTools, duckdbEnabled, queryable]);

  return provider;
}
