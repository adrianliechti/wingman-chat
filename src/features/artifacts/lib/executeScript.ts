import { executeBash } from "@/features/tools/lib/bash";
import { executeCode } from "@/features/tools/lib/interpreter";
import { executeJavaScript } from "@/features/tools/lib/javascript";
import { resolveScriptLanguage } from "@/features/tools/lib/scriptLanguage";
import { executeArtifactCode } from "./executeArtifactCode";

const executors = { python: executeCode, javascript: executeJavaScript, bash: executeBash };

/** Select the runtime after the workspace transaction has resolved a file script. */
export function executeScript(options: Omit<Parameters<typeof executeArtifactCode>[0], "executor" | "extension">) {
  return executeArtifactCode({
    ...options,
    executor: (request, executionOptions) => {
      const language = resolveScriptLanguage(options.args.language, request.path, request.code);
      return executors[language](request, executionOptions);
    },
  });
}
