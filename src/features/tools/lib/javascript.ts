/**
 * Main-thread client for the JavaScript interpreter worker. The shared lifecycle
 * and bridge dispatch live in `workerHost.ts` / `bridgeDispatch.ts`; this file
 * supplies only the worker factory.
 */

import { dispatchBridgeRpc } from "./bridgeDispatch";
import type { CodeExecutionRequest, CodeExecutionResult } from "./interpreterProtocol";
import { createWorkerHost, type ExecuteCodeOptions } from "./workerHost";

const host = createWorkerHost({
  createWorker: () => new Worker(new URL("./javascript.worker.ts", import.meta.url), { type: "module" }),
  handleMessage: dispatchBridgeRpc,
  crashMessage: "JavaScript interpreter worker crashed",
  // No heavy runtime to bootstrap (unlike Pyodide) — a short startup budget is
  // plenty.
  startupStallMs: 30_000,
});

export function executeJavaScript(
  request: CodeExecutionRequest,
  options?: ExecuteCodeOptions,
): Promise<CodeExecutionResult> {
  return host.execute(request, options);
}
