export type FileEventType = "fileCreated" | "fileDeleted" | "fileRenamed" | "fileUpdated";
export type FileEventHandler<T extends FileEventType> = T extends "fileRenamed"
  ? (oldPath: string, newPath: string) => void
  : (path: string) => void;

interface FileEvent {
  chatId: string;
  type: FileEventType;
  paths: string[];
}

// Subscribers belong to a chat, not a particular FileSystemManager instance.
// Empty sets are removed so visiting chats doesn't keep their UI alive.
const listeners = new Map<string, Map<FileEventType, Set<(...paths: string[]) => void>>>();
let channel: BroadcastChannel | undefined;

function dispatch({ chatId, type, paths }: FileEvent) {
  listeners
    .get(chatId)
    ?.get(type)
    ?.forEach((handler) => {
      try {
        handler(...paths);
      } catch (error) {
        console.error(`Error in ${type} handler:`, error);
      }
    });
}

function getChannel() {
  // Node also exposes BroadcastChannel; only browser workspaces need it.
  if (!channel && typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel("wingman:artifacts");
    } catch {
      return undefined;
    }
    channel.onmessage = ({ data }: MessageEvent<FileEvent>) => {
      if (
        typeof data?.chatId === "string" &&
        ["fileCreated", "fileDeleted", "fileRenamed", "fileUpdated"].includes(data.type) &&
        Array.isArray(data.paths) &&
        data.paths.length === (data.type === "fileRenamed" ? 2 : 1) &&
        data.paths.every((path) => typeof path === "string")
      )
        dispatch(data);
    };
  }
  return channel;
}

export function publishArtifactEvent(chatId: string, type: FileEventType, ...paths: string[]) {
  const event = { chatId, type, paths };
  dispatch(event);
  try {
    getChannel()?.postMessage(event);
  } catch (error) {
    // Notification failure must never roll back a successful storage write.
    console.warn("Could not notify other artifact tabs:", error);
  }
}

export function subscribeArtifactEvent<T extends FileEventType>(chatId: string, type: T, handler: FileEventHandler<T>) {
  getChannel();
  let events = listeners.get(chatId);
  if (!events) listeners.set(chatId, (events = new Map()));
  let handlers = events.get(type);
  if (!handlers) events.set(type, (handlers = new Set()));
  handlers.add(handler);
  return () => unsubscribeArtifactEvent(chatId, type, handler);
}

export function unsubscribeArtifactEvent<T extends FileEventType>(
  chatId: string,
  type: T,
  handler: FileEventHandler<T>,
) {
  const events = listeners.get(chatId);
  const handlers = events?.get(type);
  handlers?.delete(handler);
  if (handlers?.size === 0) events?.delete(type);
  if (events?.size === 0) listeners.delete(chatId);
}
