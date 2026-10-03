import type { ModelMessage, UIMessage } from "@tanstack/ai";
import { hasStoredMedia, rehydrateContentParts } from "@/shared/lib/opfs";

type Loadable = UIMessage | ModelMessage;

/** Whether a message still refers to chat blobs instead of carrying their bytes. */
export function hasStoredAttachments(message: Loadable): boolean {
  return "parts" in message
    ? hasStoredMedia(message.parts)
    : Array.isArray(message.content) && hasStoredMedia(message.content);
}

/** Request/display copies get bytes; stored history keeps its compact references. */
export function createAttachmentLoader(chatId: string) {
  const cache = new WeakMap<Loadable, Promise<Loadable>>();
  const load = async (message: Loadable): Promise<Loadable> => {
    const loaded: Loadable =
      "parts" in message
        ? { ...message, parts: await rehydrateContentParts(chatId, message.parts) }
        : Array.isArray(message.content)
          ? { ...message, content: await rehydrateContentParts(chatId, message.content) }
          : message;
    if (hasStoredAttachments(loaded)) throw new Error("An attachment could not be loaded from this chat.");
    return loaded;
  };
  return async <T extends Loadable>(messages: T[], signal?: AbortSignal): Promise<T[]> => {
    signal?.throwIfAborted();
    const loaded = await Promise.all(
      messages.map((message): Promise<T> => {
        if (!hasStoredAttachments(message)) return Promise.resolve(message);
        let pending = cache.get(message);
        if (!pending) {
          pending = load(message).catch((error) => {
            cache.delete(message);
            throw error;
          });
          cache.set(message, pending);
        }
        return pending as Promise<T>;
      }),
    );
    signal?.throwIfAborted();
    return loaded;
  };
}
