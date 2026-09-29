import type { CodeExecutionRequest, CodeExecutionResult } from "./interpreterProtocol";
import { createWorkerHost, type ExecuteCodeOptions } from "./workerHost";
import { dispatchBridgeRpc } from "./bridgeDispatch";

const host = createWorkerHost({
  createWorker: () => new Worker(new URL("./bash.worker.ts", import.meta.url), { type: "module" }),
  handleMessage: dispatchBridgeRpc,
  crashMessage: "Bash interpreter worker crashed",
  startupStallMs: 30_000,
  reuseWorker: false,
});

export function executeBash(request: CodeExecutionRequest, options?: ExecuteCodeOptions): Promise<CodeExecutionResult> {
  return host.execute(request, options);
}
