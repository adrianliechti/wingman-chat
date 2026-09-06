import { getConfig } from "@/shared/config";
import * as opfs from "@/shared/lib/opfs";
import { withPersistenceLock } from "@/shared/lib/persistence";
import type { Chat, ChatEntry } from "@/shared/types/chat";

export function chatEntry(chat: ChatEntry): ChatEntry {
  const { id, title, customTitle, customIndex, created, updated } = chat;
  return { id, title, customTitle, customIndex, created, updated };
}

export async function storeChat(chat: Chat): Promise<void> {
  await withPersistenceLock("collection:chats", async () => {
    const stored = await opfs.extractChatBlobs(chat);
    await opfs.writeJson(`chats/${chat.id}/chat.json`, stored);
    await opfs.upsertIndexEntry("chats", {
      id: chat.id,
      title: chat.title,
      customTitle: chat.customTitle,
      customIndex: chat.customIndex,
      created: stored.created ?? undefined,
      updated: stored.updated ?? stored.created ?? new Date(0).toISOString(),
    });
    // Cleanup follows the durable commit; cleanup failure is not a failed save.
    await opfs.deleteUnreferencedChatBlobs(stored).catch((error) => console.warn("Chat blob cleanup failed:", error));
  });
}

async function removeChatFiles(id: string): Promise<void> {
  await opfs.deleteDirectory(`chats/${id}`);
  await opfs.deleteFile(`chats/${id}.json`);
  await opfs.removeIndexEntry("chats", id);
}

export function removeChat(id: string): Promise<void> {
  return withPersistenceLock("collection:chats", () => removeChatFiles(id));
}

export async function loadChat(id: string, hydrateBlobs = true): Promise<Chat | undefined> {
  const stored =
    (await opfs.readJson<opfs.StoredChat>(`chats/${id}/chat.json`)) ??
    (await opfs.readJson<opfs.StoredChat>(`chats/${id}.json`));
  return stored
    ? hydrateBlobs
      ? opfs.rehydrateChatBlobs({ ...stored, id })
      : opfs.restoreChatManifest({ ...stored, id })
    : undefined;
}

export async function loadChatIndex(): Promise<ChatEntry[]> {
  return withPersistenceLock("collection:chats", async () => {
    const index = await opfs.readIndex("chats");
    const retentionDays = getConfig().chat?.retentionDays;
    const cutoff = new Date();
    if (retentionDays && retentionDays > 0) cutoff.setDate(cutoff.getDate() - retentionDays);
    const summaries: ChatEntry[] = [];
    for (const entry of index) {
      let summary: ChatEntry = {
        ...entry,
        created: entry.created ? new Date(entry.created) : null,
        updated: entry.updated ? new Date(entry.updated) : null,
      };
      // Only retention candidates need a manifest read. Verify the saved date
      // before deletion: an interrupted index update can leave an older date.
      if (retentionDays && retentionDays > 0 && summary.updated && summary.updated < cutoff) {
        try {
          const chat = await loadChat(entry.id, false);
          if (!chat) continue;
          if (chat.updated && chat.updated < cutoff) {
            await removeChatFiles(entry.id);
            continue;
          }
          summary = chatEntry(chat);
        } catch (error) {
          console.error(`Could not check retention for chat ${entry.id}:`, error);
        }
      }
      summaries.push(summary);
    }
    return summaries.sort((a, b) => (b.updated?.getTime() ?? 0) - (a.updated?.getTime() ?? 0));
  });
}
