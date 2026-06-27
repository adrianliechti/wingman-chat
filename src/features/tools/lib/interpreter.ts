/**
 * Main-thread client for the Pyodide interpreter worker.
 *
 * Python runs in a dedicated module worker (`interpreter.worker.ts`) so
 * CPU-bound code cannot freeze the UI — module workers are supported by all
 * recent Edge and Safari (incl. iOS) versions. The shared worker lifecycle
 * (stall watchdog, abort, crash recovery, RPC plumbing) lives in
 * `workerHost.ts`, and the main-thread bridge dispatch (the `llm`/`ocr`/`vision`/
 * `render`/`synthesize`/`transcribe`/`translate` helpers) is shared with the
 * JavaScript client in `bridgeDispatch.ts`; this file supplies only the worker
 * factory.
 *
 * Each request carries its own MessagePort for the reply (see
 * interpreterProtocol.ts), so there is no id correlation in either direction.
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
