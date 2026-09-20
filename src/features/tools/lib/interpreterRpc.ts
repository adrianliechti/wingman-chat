import type { RpcReply, WorkerToMainMessage } from "./interpreterProtocol";
import { requestPortReply } from "@/shared/lib/messagePortRpc";

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

export async function callMainThread<T>(
  post: (message: WorkerToMainMessage, transfer: Transferable[]) => void,
  build: (port: MessagePort) => WorkerToMainMessage,
  signal?: AbortSignal,
): Promise<T> {
  const reply = await requestPortReply<RpcReply>((port) => post(build(port), [port]), { signal });
  if (!reply?.ok) throw new Error(reply?.error || "The main thread could not answer this call.");
  return reply.value as T;
}
