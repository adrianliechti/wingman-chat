import type { RpcReply, ScriptToolRequest, WorkerToMainMessage } from "./interpreterProtocol";
import { requestPortReply } from "@/shared/lib/messagePortRpc";

/** Error text with the message first; WebKit and Firefox stacks do not repeat it. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const message = error.message || error.name;
  const stack = error.stack ?? "";
  return stack.includes(message) ? stack : `${message}\n${stack}`.trim();
}

/** Each call transfers its own reply port to the main thread. */
async function rpc<T>(send: (port: MessagePort) => void, signal?: AbortSignal): Promise<T> {
  const reply = await requestPortReply<RpcReply>(send, { signal });
  if (!reply?.ok) throw new Error(reply?.error || "The main thread could not answer this call.");
  return reply.value as T;
}

export function callMainThread<T>(
  post: (message: WorkerToMainMessage, transfer: Transferable[]) => void,
  build: (port: MessagePort) => WorkerToMainMessage,
  signal?: AbortSignal,
): Promise<T> {
  return rpc<T>((port) => post(build(port), [port]), signal);
}

export function scriptToolClient(execution: MessagePort, signal?: AbortSignal) {
  return {
    list: () =>
      rpc<unknown[]>(
        (port) => execution.postMessage({ type: "tools-list", port } satisfies ScriptToolRequest, [port]),
        signal,
      ),
    call: (name: string, args: unknown = {}) =>
      rpc<unknown>(
        (port) => execution.postMessage({ type: "tools-call", name, args, port } satisfies ScriptToolRequest, [port]),
        signal,
      ),
  };
}
