import type { RpcReply, WorkerToMainMessage } from "./interpreterProtocol";

/**
 * RPC from an interpreter worker to the main thread. Each call ships its own
 * reply port, so responses need no correlation or routing. Shared by both the
 * Pyodide and JavaScript workers — `post` is the worker's `postMessage`.
 */
/** Error text with the message first; WebKit and Firefox stacks do not repeat it. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const message = error.message || error.name;
  const stack = error.stack ?? "";
  return stack.includes(message) ? stack : `${message}\n${stack}`.trim();
}

export function callMainThread<T>(
  post: (message: WorkerToMainMessage, transfer: Transferable[]) => void,
  build: (port: MessagePort) => WorkerToMainMessage,
): Promise<T> {
  const { port1, port2 } = new MessageChannel();
  return new Promise<T>((resolve, reject) => {
    port1.onmessage = (event: MessageEvent<RpcReply>) => {
      port1.close();
      const reply = event.data;
      if (reply.ok) resolve(reply.value as T);
      else reject(new Error(reply.error || "The main thread could not answer this call."));
    };
    post(build(port2), [port2]);
  });
}
