import { parseBlobRef, rehydrateMessageBlobsForChat } from "@/shared/lib/opfs";
import type { Content, Message } from "@/shared/types/chat";

export function hasStoredAttachments(content: Content[]): boolean {
  return content.some((part) =>
    part.type === "tool_result"
      ? hasStoredAttachments(part.result)
      : (part.type === "image" || part.type === "audio" || part.type === "file") && !!parseBlobRef(part.data),
  );
}

/** Request/display copies get bytes; stored history keeps its compact references. */
export function createAttachmentLoader(chatId: string) {
  const cache = new WeakMap<Message, Promise<Message>>();
  return async (messages: Message[], signal?: AbortSignal): Promise<Message[]> => {
    signal?.throwIfAborted();
    const loaded = await Promise.all(
      messages.map(async (message) => {
        if (!hasStoredAttachments(message.content)) return message;
        let pending = cache.get(message);
        if (!pending) {
          pending = rehydrateMessageBlobsForChat(chatId, message)
            .then((result) => {
              if (hasStoredAttachments(result.content))
                throw new Error("An attachment could not be loaded from this chat.");
              return result;
            })
            .catch((error) => {
              cache.delete(message);
              throw error;
            });
          cache.set(message, pending);
        }
        return pending;
      }),
    );
    signal?.throwIfAborted();
    return loaded;
  };
}
