/**
 * Main-thread client for the JavaScript interpreter worker.
 *
 * JavaScript runs in a dedicated module worker (`javascript.worker.ts`) so
 * CPU-bound code can't freeze the UI and runs isolated from the app's DOM and
 * origin globals. The shared worker lifecycle (stall watchdog, abort, crash
 * recovery, RPC plumbing) lives in `workerHost.ts`, and the main-thread bridge
 * dispatch (`llm`/`ocr`/`vision`/`render`/`synthesize`/`transcribe`/`translate`)
 * is shared with the Pyodide client in `bridgeDispatch.ts`; this file supplies
 * only the worker factory.
 */

import { dispatchBridgeRpc } from "./bridgeDispatch";
import type { CodeExecutionRequest, CodeExecutionResult } from "./interpreterProtocol";
import { createWorkerHost, type ExecuteCodeOptions } from "./workerHost";

const host = createWorkerHost({
  createWorker: () => new Worker(new URL("./javascript.worker.ts", import.meta.url), { type: "module" }),
  handleMessage: dispatchBridgeRpc,
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
