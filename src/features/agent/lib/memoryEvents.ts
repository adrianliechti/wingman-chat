const listeners = new Map<string, Set<() => void>>();
let channel: BroadcastChannel | undefined;

function localNotify(id: string) {
  listeners.get(id)?.forEach((listener) => listener());
}

function getChannel() {
  if (!channel && typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("wingman-memory");
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (typeof event.data === "string") localNotify(event.data);
    };
  }
  return channel;
}

export function publishMemoryChange(id: string) {
  localNotify(id);
  getChannel()?.postMessage(id);
}

export function subscribeMemory(id: string, listener: () => void): () => void {
  getChannel();
  const group = listeners.get(id) ?? new Set();
  group.add(listener);
  listeners.set(id, group);
  return () => {
    group.delete(listener);
    if (!group.size) listeners.delete(id);
  };
}
