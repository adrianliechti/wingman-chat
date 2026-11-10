/** Invalidate mounted storage readers only after a remote batch is committed. */
const listeners = new Set<(paths: readonly string[]) => void>();
let channel: BroadcastChannel | undefined;

function dispatch(paths: readonly string[]) {
  for (const listener of listeners) {
    try {
      listener(paths);
    } catch (error) {
      console.error("Couldn't refresh restored files", error);
    }
  }
}

function getChannel() {
  if (!channel && typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel("wingman:storage-restored");
    } catch {
      return undefined;
    }
    channel.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (Array.isArray(data) && data.every((path) => typeof path === "string")) dispatch(data);
    };
  }
  return channel;
}

export function subscribeStorageChanges(listener: (paths: readonly string[]) => void): () => void {
  getChannel();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishStorageChanges(paths: readonly string[]): void {
  dispatch(paths);
  try {
    getChannel()?.postMessage(paths);
  } catch (error) {
    console.warn("Couldn't notify other tabs about restored files", error);
  }
}
