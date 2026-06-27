/**
 * Main-thread client for the JavaScript interpreter worker.
 *
 * JavaScript runs in a dedicated module worker (`javascript.worker.ts`) so
 * CPU-bound code can't freeze the UI and runs isolated from the app's DOM and
 * origin globals. The shared worker lifecycle (stall watchdog, abort, crash
 * recovery, RPC plumbing) lives in `workerHost.ts`; this file supplies only the
 * worker factory and the dispatcher for the one capability that needs the main
 * thread — the `llm(...)` helper, which needs the chat client/config.
 */

import type { CodeExecutionRequest, CodeExecutionResult, WorkerToMainMessage } from "./interpreterProtocol";
import { runLlm } from "./llmCommand";
import { createWorkerHost, type ExecuteCodeOptions } from "./workerHost";

// The JS worker only ever bridges `llm`; anything else is a protocol mismatch.
function handleMessage(message: WorkerToMainMessage): Promise<unknown> {
  if (message.type === "llm-request") {
    return runLlm(message.prompt, message.options);
  }
  return Promise.reject(new Error(`Unsupported JavaScript bridge request: ${message.type}`));
}

const host = createWorkerHost({
  createWorker: () => new Worker(new URL("./javascript.worker.ts", import.meta.url), { type: "module" }),
  handleMessage,
  crashMessage: "JavaScript interpreter worker crashed",
  // No heavy runtime to bootstrap (unlike Pyodide) — a short startup budget is
  // plenty, after which the compute-stall ceiling governs.
  startupStallMs: 30_000,
});

export function executeJavaScript(
  request: CodeExecutionRequest,
  options?: ExecuteCodeOptions,
): Promise<CodeExecutionResult> {
  return host.execute(request, options);
}
