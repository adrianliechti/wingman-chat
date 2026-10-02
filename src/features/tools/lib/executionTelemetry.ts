import { type Counter, metrics } from "@opentelemetry/api";
import type { ScriptLanguage } from "./scriptLanguage";

/**
 * Counts failed execute_script runs by language and error class so the error
 * mix is visible in metrics (which pitfalls dominate, whether hints and prompt
 * changes move them). Classes are bounded: an exception type, a JavaScript
 * error constructor, or a Bash exit category.
 */

let counter: Counter | undefined;

const PYTHON_EXCEPTION_LINE = /^([A-Za-z_][\w.]*(?:Error|Exception|Exit|Interrupt|Warning|Iteration))(?::|$)/m;
const JAVASCRIPT_ERROR = /\b([A-Z][A-Za-z]*Error)\b/;

export function executionErrorClass(error: string, language: ScriptLanguage): string {
  if (language === "python") {
    const matches = [...error.matchAll(new RegExp(PYTHON_EXCEPTION_LINE.source, "gm"))];
    const last = matches.at(-1)?.[1];
    if (last) return last.includes(".") ? last.slice(last.lastIndexOf(".") + 1) : last;
    return "unknown";
  }
  if (language === "javascript") {
    return JAVASCRIPT_ERROR.exec(error)?.[1] ?? "unknown";
  }
  if (/command not (?:found|available)/.test(error)) return "command-not-found";
  if (/No such file or directory|not found/.test(error)) return "missing-file";
  const status = /exit(?:ed with)? status (\d+)/.exec(error)?.[1];
  return status ? `exit-${status}` : "unknown";
}

export function recordExecutionFailure(language: ScriptLanguage, error: string): void {
  try {
    counter ??= metrics.getMeter("wingman").createCounter("wingman.execution.failures", {
      description: "Failed execute_script runs by language and error class",
    });
    counter.add(1, {
      "wingman.execution.language": language,
      "wingman.execution.error": executionErrorClass(error, language),
    });
  } catch {
    // Metrics are best effort; a missing provider never affects the run.
  }
}
