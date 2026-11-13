import { stashPendingDeletion } from "@/shared/lib/chatSync";
import { readLocalChat, withChatTarget, writeLocalChatSnapshot } from "@/shared/lib/localChats";
import { completeChatIndexRepair, pendingChatIndexRepairs } from "@/shared/lib/chatIndex";
import { getConfig } from "@/shared/config";
import { chatRetentionCutoff } from "@/shared/lib/chatRetention";
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
  const { id, projectId, title, customTitle, customIndex, created, updated } = chat;
  return { id, projectId, title, customTitle, customIndex, created, updated };
}

export async function storeChat(chat: Chat): Promise<void> {
  await withPersistenceLock("collection:chats", async () => {
    const stored = await opfs.extractChatBlobs(chat);
    // Commit the shared pending target first so interrupted native writes
    // remain recoverable locally and when online sync resumes.
    const pending = Boolean(
      getConfig().store ||
      (await opfs.fileExists(`chats/${chat.id}/history.jsonl`)) ||
      (await opfs.fileExists(`chats/${chat.id}/target.json`)),
    );
    await writeLocalChatSnapshot(stored, pending);
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
  if (getConfig().store || (await opfs.fileExists("_sync/state.json"))) await stashPendingDeletion(id);
  await opfs.deleteDirectory(`chats/${id}`);
  await opfs.deleteFile(`chats/${id}.json`);
  await opfs.removeIndexEntry("chats", id);
  await completeChatIndexRepair(id);
  await withPersistenceLock("collection:drafts", () =>
    opfs.deleteDirectory(`drafts/${encodeURIComponent(`chat-${id}`)}`),
  );
}

export function removeChat(id: string): Promise<void> {
  return withPersistenceLock("collection:chats", () => removeChatFiles(id));
}

/** The pre-migration record, retained with its attachments so a lossy migration can be redone. */
export const legacyChatPath = (id: string) => `chats/${id}/chat.legacy.json`;

/**
 * Older transcripts and fields migrate on read; the next save writes the
 * current record over the old file. Keep the original once before that can
 * happen, because conversion drops what it cannot read.
 * Failing to keep the copy is logged, not fatal: the chat still opens.
 */
async function keepLegacyRecord(id: string, raw: LegacyStoredChat | opfs.StoredChat): Promise<void> {
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
  if (!raw || typeof raw !== "object") return readLocalChat(id, hydrateBlobs);
  const version: unknown = raw.version;
  if (version !== undefined && version !== opfs.STORED_CHAT_VERSION)
    throw new Error(`Unsupported chat record version: ${JSON.stringify(version)}`);
  const record = { ...raw, id };
  const stored = normalizeStoredChat(record);
  if (isLegacyStoredChat(raw) || stored !== record) await keepLegacyRecord(id, raw);
  if (!opfs.isStoredChat(stored)) throw new Error(`Invalid chat record: ${id}`);
  if ((await opfs.fileExists(`chats/${id}/history.jsonl`)) || (await opfs.fileExists(`chats/${id}/target.json`))) {
    const mirror = await readLocalChat(id, hydrateBlobs);
    if (
      mirror &&
      ((await opfs.fileExists(`chats/${id}/target.json`)) ||
        (mirror.updated?.getTime() ?? 0) > (stored.updated ? Date.parse(stored.updated) : 0))
    )
      return mirror;
  }
  return hydrateBlobs ? opfs.rehydrateChatBlobs(stored) : opfs.restoreChatManifest(stored);
}

export async function loadChatIndex(): Promise<ChatEntry[]> {
  return withPersistenceLock("collection:chats", async () => {
    const index = await opfs.readIndex("chats");
    const [directories, files] = await Promise.all([opfs.listDirectories("chats"), opfs.listFiles("chats")]);
    const ids = new Set([
      ...directories,
      ...files.filter((file) => file !== "index.json" && file.endsWith(".json")).map((file) => file.slice(0, -5)),
    ]);
    const entries = new Map(index.filter((entry) => ids.has(entry.id)).map((entry) => [entry.id, entry]));
    const repairs = await pendingChatIndexRepairs();
    for (const id of repairs) ids.add(id);
    // Ordinary startup reads metadata only. Read transcripts only for missing
    // index entries or commits whose snapshot/index projection was interrupted.
    for (const id of ids) {
      if (entries.has(id) && !repairs.has(id)) continue;
      try {
        await withChatTarget(id, async () => {
          const chat = await loadChat(id, false);
          if (chat) {
            const entry = {
              ...chatEntry(chat),
              created: chat.created?.toISOString(),
              updated: (chat.updated ?? chat.created ?? new Date(0)).toISOString(),
            };
            await opfs.upsertIndexEntry("chats", entry);
            entries.set(id, entry);
          } else entries.delete(id);
          await completeChatIndexRepair(id);
        });
      } catch (error) {
        if (!(error instanceof Error && error.cause instanceof SyntaxError)) throw error;
        console.warn(`Could not recover chat index entry ${id}:`, error);
      }
    }
    const cutoff = chatRetentionCutoff(getConfig().chat?.retentionDays);
    const summaries: ChatEntry[] = [];
    for (const entry of entries.values()) {
      let summary: ChatEntry = {
        ...entry,
        created: entry.created ? new Date(entry.created) : null,
        updated: entry.updated ? new Date(entry.updated) : null,
      };
      // Only retention candidates need a manifest read. Verify the saved date
      // before deletion: an interrupted index update can leave an older date.
      // Online retention runs after reconciliation, when another device's newer
      // timestamp is known. Startup must not expire a stale offline snapshot.
      if (!getConfig().store && cutoff && summary.updated && summary.updated < cutoff) {
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
