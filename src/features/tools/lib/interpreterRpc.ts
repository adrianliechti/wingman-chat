import type { RpcReply, WorkerToMainMessage } from "./interpreterProtocol";

/**
 * RPC from an interpreter worker to the main thread. Each call ships its own
 * reply port, so responses need no correlation or routing. Shared by both the
 * Pyodide and JavaScript workers — `post` is the worker's `postMessage`.
 */
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
      else reject(new Error(reply.error));
    };
    post(build(port2), [port2]);
  });
}
