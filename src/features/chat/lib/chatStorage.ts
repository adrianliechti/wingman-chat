import { getConfig } from "@/shared/config";
import * as opfs from "@/shared/lib/opfs";
import { withPersistenceLock } from "@/shared/lib/persistence";
import { writeFileChanges } from "@/shared/lib/opfs-transaction";
import type { ChatEntry } from "@/shared/types/chat";
import { restoreChatRuntime, serializeChatRuntime, type ChatRecord } from "./chatRuntime";

export function chatEntry(chat: ChatEntry): ChatEntry {
  const { id, title, customTitle, customIndex, created, updated } = chat;
  return { id, title, customTitle, customIndex, created, updated };
}

export async function storeChat(chat: ChatRecord): Promise<void> {
  await withPersistenceLock("collection:chats", async () => {
    const stored = await opfs.extractChatBlobs(chat);
    const runtime = await serializeChatRuntime(stored.messages, chat.runtime);
    const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: "application/json" });
    await writeFileChanges(
      new Map([
        [`chats/${chat.id}/chat.json`, json(stored)],
        [`chats/${chat.id}/tanstack.json`, runtime ? json(runtime) : undefined],
      ]),
    );
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

export async function loadChat(id: string, hydrateBlobs = true): Promise<ChatRecord | undefined> {
  const stored =
    (await opfs.readJson<opfs.StoredChat>(`chats/${id}/chat.json`)) ??
    (await opfs.readJson<opfs.StoredChat>(`chats/${id}.json`));
  if (!stored) return undefined;
  const { messages, runtime } = await restoreChatRuntime({ ...stored, id });
  const manifest = { ...stored, id, messages };
  const chat = hydrateBlobs ? await opfs.rehydrateChatBlobs(manifest) : opfs.restoreChatManifest(manifest);
  return { ...chat, runtime };
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
