/** One request owns both ends of its channel until transfer/reply/cancellation. */
export function requestPortReply<T>(
  send: (port: MessagePort) => void,
  options: { signal?: AbortSignal; timeoutMs?: number; timeoutMessage?: string } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const { signal } = options;
    signal?.throwIfAborted();
    const channel = new MessageChannel();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      channel.port1.onmessage = null;
      channel.port1.onmessageerror = null;
      channel.port1.close();
      channel.port2.close();
      complete();
    };
    const abort = () => finish(() => reject(signal?.reason));
    signal?.addEventListener("abort", abort, { once: true });
    channel.port1.onmessage = (event: MessageEvent<T>) => finish(() => resolve(event.data));
    channel.port1.onmessageerror = () => finish(() => reject(new Error("Worker reply could not be read.")));
    if (options.timeoutMs !== undefined) {
      timer = setTimeout(
        () => finish(() => reject(new Error(options.timeoutMessage ?? "Worker request timed out."))),
        options.timeoutMs,
      );
    }
    try {
      send(channel.port2);
    } catch (error) {
      finish(() => reject(error));
    }
  });
}
