import { Shapes } from "lucide-react";
import { useCallback, useMemo } from "react";
import { ARTIFACT_VALIDATORS } from "@/features/artifacts/lib/artifactValidators";
import { SCRIPT_EXECUTION_PARAMETERS } from "@/features/artifacts/lib/executionToolSchemas";
import { resolveArtifactFileSystem } from "@/features/artifacts/lib/fs";
import { queryableMountNames } from "@/features/artifacts/lib/duckdbWorkspace";
import { useArtifactEntries } from "./useArtifactFiles";
import artifactsInstructionsText from "@/features/artifacts/prompts/artifacts.txt?raw";
import bridgeInstructionsText from "@/features/artifacts/prompts/bridge.txt?raw";
import documentsInstructionsText from "@/features/artifacts/prompts/documents.txt?raw";
import duckdbInstructionsText from "@/features/artifacts/prompts/duckdb.txt?raw";
import interpreterInstructionsText from "@/features/artifacts/prompts/interpreter.txt?raw";
import llmInstructionsText from "@/features/artifacts/prompts/llm.txt?raw";
import ocrInstructionsText from "@/features/artifacts/prompts/ocr.txt?raw";
import renderInstructionsText from "@/features/artifacts/prompts/render.txt?raw";
import synthesizeInstructionsText from "@/features/artifacts/prompts/synthesize.txt?raw";
import transcribeInstructionsText from "@/features/artifacts/prompts/transcribe.txt?raw";
import translateInstructionsText from "@/features/artifacts/prompts/translate.txt?raw";
import visionInstructionsText from "@/features/artifacts/prompts/vision.txt?raw";
import { AGENT_CODE_OUTPUT_MAX_BYTES } from "@/features/tools/lib/executionLimits";
import { getConfig } from "@/shared/config";
import { executeScript } from "../lib/executeScript";
import { formatExecutionFailure } from "../lib/executeArtifactCode";
import { SCRIPT_EXECUTION_DISPLAY } from "../lib/executionToolDisplay";
import type { Tool, ToolContext, ToolProvider } from "@/shared/types/chat";
import { useArtifacts } from "./useArtifacts";

function executionFailure(context: ToolContext | undefined, text: string) {
  context?.setError?.({ code: "EXECUTION_ERROR", message: text });
  return [{ type: "text" as const, content: text }];
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
        ? [{ type: "text" as const, content: result.output }]
        : executionFailure(options.context, formatExecutionFailure(result));
    };

    const executionTools: Tool[] = [
      {
        name: "execute_script",
        display: SCRIPT_EXECUTION_DISPLAY,
        description:
          "Run Python, JavaScript or Bash over the shared artifact workspace in a sandboxed Web Worker. " +
          "Use Python for data, computation and documents; JavaScript for browser media/rendering; Bash for virtual " +
          "shell pipelines and file processing. Use file tools for simple text edits and HTML artifacts for interactive UI. " +
          "Pass inline code with language, or a path to an artifact/selected-skill script. Paths detect the runtime " +
          "from shebang or extension; language overrides detection. Prefer path for long or bundled scripts. " +
          "args contains literal arguments, excluding the script path. " +
          "Python/Bash work under /home/user/; JavaScript uses vfs with artifact paths such as /data.csv. " +
          "There is no host shell, Node, DOM, package installation or direct remote networking. " +
          "File changes commit on success and are discarded on failure. Treat mounted skill resources as read-only. " +
          "See the runtime instructions for bundled libraries, helpers, output and file limits.",
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
        // Document libraries and local PDF rasterization need no backing service.
        documentsInstructionsText,
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
