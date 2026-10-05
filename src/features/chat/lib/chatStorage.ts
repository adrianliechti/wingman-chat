import { getConfig } from "@/shared/config";
import {
  collectLegacyChatBlobIds,
  isLegacyStoredChat,
  normalizeStoredChat,
  type LegacyStoredChat,
} from "@/shared/lib/chatMigration";
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
    // Cleanup follows the durable commit. An unreadable recovery record must
    // leave all blobs intact; cleanup failure is not a failed save.
    try {
      const legacy = await opfs.readJson<unknown>(legacyChatPath(chat.id));
      await opfs.deleteUnreferencedChatBlobs(stored, collectLegacyChatBlobIds(legacy));
    } catch (error) {
      console.warn("Chat blob cleanup failed:", error);
    }
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

/** The pre-migration record, retained with its attachments so a lossy migration can be redone. */
export const legacyChatPath = (id: string) => `chats/${id}/chat.legacy.json`;

/**
 * Chats saved before the native transcript migrate on read; the next save
 * writes the current record over the old file. The old record is copied once
 * before that can happen, because the migration drops what it cannot read.
 * Failing to keep the copy is logged, not fatal: the chat still opens.
 */
async function keepLegacyRecord(id: string, raw: LegacyStoredChat): Promise<void> {
  try {
    if (await opfs.fileExists(legacyChatPath(id))) return;
    await opfs.writeJson(legacyChatPath(id), raw);
  } catch (error) {
    console.warn(`Could not keep the pre-migration record of chat ${id}:`, error);
  }
}

export async function loadChat(id: string, hydrateBlobs = true): Promise<Chat | undefined> {
  const raw =
    (await opfs.readJson<opfs.StoredChat | LegacyStoredChat>(`chats/${id}/chat.json`)) ??
    (await opfs.readJson<opfs.StoredChat | LegacyStoredChat>(`chats/${id}.json`));
  if (!raw || typeof raw !== "object") return undefined;
  if (isLegacyStoredChat(raw)) await keepLegacyRecord(id, raw);
  const stored = normalizeStoredChat({ ...raw, id });
  return hydrateBlobs ? opfs.rehydrateChatBlobs(stored) : opfs.restoreChatManifest(stored);
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
