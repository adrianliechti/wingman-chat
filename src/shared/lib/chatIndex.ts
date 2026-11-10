import { deleteFile, listFiles, upsertIndexEntry, writeJson, type IndexEntry } from "./opfs-core";
import type { StoredChat } from "./opfs-chat";

const repairDirectory = "_sync/chat-index";
const repairPath = (id: string) => `${repairDirectory}/${encodeURIComponent(id)}.json`;

/** Only interrupted commits need a transcript read to repair their metadata. */
export async function pendingChatIndexRepairs(): Promise<Set<string>> {
  return new Set(
    (await listFiles(repairDirectory))
      .filter((name) => name.endsWith(".json"))
      .map((name) => decodeURIComponent(name.slice(0, -5))),
  );
}

export function completeChatIndexRepair(id: string): Promise<void> {
  return deleteFile(repairPath(id));
}

/** The caller holds the chat target lock through snapshot and index commits. */
export async function withChatIndexUpdate(id: string, operation: () => Promise<void>): Promise<void> {
  await writeJson(repairPath(id), { id });
  await operation();
  await completeChatIndexRepair(id);
}

/** Shared by local saves, recovery, and incoming backup changes. */
export function storeChatIndexEntry(chat: StoredChat): Promise<void> {
  const entry: IndexEntry = {
    id: chat.id,
    projectId: chat.projectId,
    title: chat.title,
    customTitle: chat.customTitle,
    customIndex: chat.customIndex,
    created: chat.created ?? undefined,
    updated: chat.updated ?? chat.created ?? new Date(0).toISOString(),
  };
  return upsertIndexEntry("chats", entry);
}
