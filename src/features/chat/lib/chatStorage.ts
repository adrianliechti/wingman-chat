import { getConfig } from "@/shared/config";
import * as opfs from "@/shared/lib/opfs";
import { withPersistenceLock } from "@/shared/lib/persistence";
import type { Chat } from "@/shared/types/chat";

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

export async function loadChat(id: string): Promise<Chat | undefined> {
  const stored =
    (await opfs.readJson<opfs.StoredChat>(`chats/${id}/chat.json`)) ??
    (await opfs.readJson<opfs.StoredChat>(`chats/${id}.json`));
  return stored ? opfs.rehydrateChatBlobs({ ...stored, id }) : undefined;
}

export async function loadChats(): Promise<Chat[]> {
  return withPersistenceLock("collection:chats", async () => {
    const index = await opfs.readIndex("chats");
    const retentionDays = getConfig().chat?.retentionDays;
    const cutoff = new Date();
    if (retentionDays && retentionDays > 0) cutoff.setDate(cutoff.getDate() - retentionDays);
    const chats: Chat[] = [];
    for (const entry of index) {
      try {
        const chat = await loadChat(entry.id);
        if (!chat) continue;
        // A stale index must never expire a recently updated manifest.
        if (retentionDays && retentionDays > 0 && chat.updated && chat.updated < cutoff) {
          await removeChatFiles(chat.id);
        } else {
          chats.push(chat);
        }
      } catch (error) {
        console.error(`Could not load chat ${entry.id}:`, error);
      }
    }
    return chats.sort((a, b) => (b.updated?.getTime() || 0) - (a.updated?.getTime() || 0));
  });
}
