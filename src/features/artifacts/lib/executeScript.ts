import { executeBash } from "@/features/tools/lib/bash";
import { withExecutionHints } from "@/features/tools/lib/executionHints";
import { recordExecutionFailure } from "@/features/tools/lib/executionTelemetry";
import { executeCode } from "@/features/tools/lib/interpreter";
import { executeJavaScript } from "@/features/tools/lib/javascript";
import { resolveScriptLanguage } from "@/features/tools/lib/scriptLanguage";
import { executeArtifactCode } from "./executeArtifactCode";

const executors = { python: executeCode, javascript: executeJavaScript, bash: executeBash };

/** Select the runtime after the workspace transaction has resolved a file script. */
export function executeScript(options: Omit<Parameters<typeof executeArtifactCode>[0], "executor" | "extension">) {
  return executeArtifactCode({
    ...options,
    executor: async (request, executionOptions) => {
      const language = resolveScriptLanguage(options.args.language, request.path, request.code);
      const result = await executors[language](request, executionOptions);
      if (result.success) return result;
      // Failures feed straight back to the model: count them by class and
      // attach the deterministic fixes for sandbox limits and known pitfalls.
      const error = result.error || "Unknown error";
      recordExecutionFailure(language, error);
      return { ...result, error: withExecutionHints(error, { language, files: Object.keys(request.files ?? {}) }) };
    },
  });
}
