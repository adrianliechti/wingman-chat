import type { Chat } from "@/shared/types/chat";
import { withPersistenceLock } from "./persistence";
import { normalizeStoredChat, type LegacyStoredChat } from "./chatMigration";
import { readChatHistory } from "./chatHistoryStorage";
import { storeChatIndexEntry, withChatIndexUpdate } from "./chatIndex";
import { rehydrateChatBlobs, restoreChatManifest, type StoredChat } from "./opfs-chat";
import { listDirectories, readJson, writeJson } from "./opfs-core";

// Per-chat paths in OPFS
export const targetPath = (chatId: string) => `chats/${chatId}/target.json`;
/** Shared by unlocked engines and saves from locked/offline tabs. */
export const withChatTarget = <T>(chatId: string, operation: () => Promise<T>) =>
  withPersistenceLock(`chat-target:${encodeURIComponent(chatId)}`, operation);
/** The native local snapshot is kept in both local-only and online modes. */
export const localChatPath = (chatId: string) => `chats/${chatId}/chat.json`;

/** Read the local mirror without a DEK — logs and pending targets are
 *  plaintext locally; the PIN only protects the server copies. Lets the
 *  UI show chats while the session is still locked. */
export async function readLocalChat(id: string, hydrateBlobs = true): Promise<Chat | undefined> {
  let stored = await readJson<StoredChat | LegacyStoredChat>(targetPath(id));
  if (!stored) stored = await readJson<StoredChat | LegacyStoredChat>(localChatPath(id));
  if (!stored) {
    stored = (await readChatHistory(id))?.chat ?? undefined;
  }
  if (!stored) return undefined;
  const normalized = normalizeStoredChat({ ...stored, id });
  return hydrateBlobs ? rehydrateChatBlobs(normalized) : restoreChatManifest(normalized);
}

export async function readLocalMirror(hydrateBlobs = true): Promise<Chat[]> {
  const out: Chat[] = [];
  for (const id of await listDirectories("chats")) {
    const chat = await readLocalChat(id, hydrateBlobs);
    if (chat) out.push(chat);
  }
  return out;
}

/** Share the snapshot commit with native local storage and its durable outbox. */
export function writeLocalChatSnapshot(stored: StoredChat, pending: boolean): Promise<void> {
  return withChatTarget(stored.id, () => writeLocalChatSnapshotUnlocked(stored, pending));
}

export function writeLocalChatSnapshotUnlocked(stored: StoredChat, pending: boolean): Promise<void> {
  return withChatIndexUpdate(stored.id, async () => {
    if (pending) {
      await writeJson(targetPath(stored.id), stored);
      // The target is already durable if the native snapshot fails afterward.
      await storeChatIndexEntry(stored);
      await writeJson(localChatPath(stored.id), stored);
    } else {
      await writeJson(localChatPath(stored.id), stored);
      await storeChatIndexEntry(stored);
    }
  });
}
