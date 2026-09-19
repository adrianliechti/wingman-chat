import { loadChat } from "@/features/chat/lib/chatStorage";
import type { Message } from "@/shared/types/chat";
import { flushPersistence } from "@/shared/lib/persistence";
import { memoryRevision, parseMemoryDocument, serializeMemoryDocument } from "./memoryDocument";
import type { MemoryManager } from "./memoryManager";

// Evidence belongs to memory, not the general ToolContext or a second transcript.
export function memoryMessageText(message: Message): string {
  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

export function memoryMessageHash(message: Message): Promise<string> {
  return memoryRevision(`${message.role}\n${memoryMessageText(message)}`);
}

export function memorySourceResource(chatId: string, id: string): string {
  return `wingman://chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(id)}`;
}

/** Expired evidence remains inspectable, but cannot be injected as current fact. */
export async function reconcileMemorySources(manager: MemoryManager): Promise<void> {
  // Include pending agent settings and message edits in the evidence snapshot.
  await flushPersistence();
  const chats = new Map<string, Promise<Map<string, string>>>();
  await manager.transaction(
    async ({ files }) => {
      for (const [path, text] of files) {
        const doc = parseMemoryDocument(text);
        if (
          (doc.metadata.generated as { by?: string } | undefined)?.by !== "wingman/learning" ||
          doc.metadata.status === "deprecated"
        )
          continue;
        const sources = Array.isArray(doc.metadata.sources) ? doc.metadata.sources : [];
        const invalid = await Promise.all(
          sources.map(async (source) => {
            const match =
              typeof source.resource === "string" &&
              source.resource.match(/^wingman:\/\/chats\/([^/]+)\/messages\/([^/]+)$/);
            if (!match || typeof source.wingman_hash !== "string") return false;
            const chatId = decodeURIComponent(match[1]);
            if (!chats.has(chatId))
              chats.set(
                chatId,
                (async () => {
                  const chat = await loadChat(chatId, false);
                  return new Map(
                    await Promise.all(
                      (chat?.messages ?? [])
                        .filter((message) => message.id)
                        .map(async (message) => [message.id!, await memoryMessageHash(message)] as const),
                    ),
                  );
                })(),
              );
            return (await chats.get(chatId)!).get(decodeURIComponent(match[2])) !== source.wingman_hash;
          }),
        );
        if (invalid.some(Boolean)) {
          doc.metadata.status = "draft";
          doc.metadata.wingman_evidence = "Source changed or was removed; review before using.";
          delete doc.metadata.verified;
          files.set(path, serializeMemoryDocument(doc));
        }
      }
    },
    { requireEnabled: true, lockSources: true },
  );
}
