import { Buffer } from "buffer";
import { runBash } from "./bashRuntime";
import { createBashCommands } from "./bashCommands";
import type { ExecuteMessage, ExecuteReply, WorkerToMainMessage } from "./interpreterProtocol";
import { callMainThread } from "./interpreterRpc";

// just-bash's gzip commands encode binary stdout through the Node Buffer API.
Object.assign(globalThis, { Buffer });

const post = (message: WorkerToMainMessage, transfer: Transferable[]) => {
  self.postMessage(message, { transfer });
};
const commands = createBashCommands({
  ocr: (data, path, signal) =>
    callMainThread<string>(post, (port) => ({ type: "ocr-request", data, path, port }), signal),
  llm: (prompt, options, signal) =>
    callMainThread<string>(post, (port) => ({ type: "llm-request", prompt, options, port }), signal),
});

self.addEventListener("message", async (event: MessageEvent<ExecuteMessage>) => {
  const { request, port } = event.data;
  try {
    const result = await runBash(request, () => port.postMessage({ type: "started" } satisfies ExecuteReply), commands);
    port.postMessage({ type: "result", result } satisfies ExecuteReply);
  } finally {
    port.close();
  }
});
