/**
 * Main-thread client for the Pyodide interpreter worker. Python runs off-thread
 * so CPU-bound code can't freeze the UI; this file only supplies the worker
 * factory (lifecycle lives in workerHost.ts, RPC dispatch in bridgeDispatch.ts).
 */

import { dispatchBridgeRpc } from "./bridgeDispatch";
import type { CodeExecutionRequest, CodeExecutionResult } from "./interpreterProtocol";
import { createWorkerHost, type ExecuteCodeOptions } from "./workerHost";

export type { CodeExecutionRequest, CodeExecutionResult } from "./interpreterProtocol";

const host = createWorkerHost({
  createWorker: () => new Worker(new URL("./interpreter.worker.ts", import.meta.url), { type: "module" }),
  handleMessage: dispatchBridgeRpc,
  crashMessage: "Python interpreter worker crashed",
});

export function executeCode(request: CodeExecutionRequest, options?: ExecuteCodeOptions): Promise<CodeExecutionResult> {
  return host.execute(request, options);
}
