import type { Chat } from "@/shared/types/chat";
import { withPersistenceLock } from "./persistence";
import { normalizeStoredChat, type LegacyStoredChat } from "./chatMigration";
import { decodeLines, encodeLines, replayLog, type LogEntry } from "./chatLog";
import { rehydrateChatBlobs, restoreChatManifest, type StoredChat } from "./opfs-chat";
import {
  deleteFile,
  listDirectories,
  listFiles,
  readBlob,
  readJson,
  upsertIndexEntry,
  writeJson,
  type IndexEntry,
} from "./opfs-core";

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

// Retention ----------------------------------------------------------------

/** Use calendar days consistently for local expiration and incoming backups. */
export function chatRetentionCutoff(days: number | undefined): Date | null {
  if (!days || days <= 0) return null;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff;
}

// Index repair -------------------------------------------------------------

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

// Backup history -----------------------------------------------------------

interface ChatCheckpoint {
  head: number;
  hash: string;
  count: number;
}

type HistoryEntry = LogEntry | ({ type: "checkpoint" } & ChatCheckpoint);

export const chatHistoryPath = (id: string) => `chats/${id}/history.jsonl`;

/** The entries and their checkpoint close in the same atomic OPFS write. */
export function encodeHistory(entries: LogEntry[], checkpoint: ChatCheckpoint): string {
  return encodeLines(entries) + JSON.stringify({ type: "checkpoint", ...checkpoint }) + "\n";
}

export async function readChatHistory(id: string, known?: { head: number; hash: string; chat: StoredChat }) {
  const file = await readBlob(chatHistoryPath(id));
  if (!file?.size) return undefined;
  // Check only the trailing checkpoint before deciding whether to replay a
  // potentially large log. Older logs replay in full until their next commit.
  const start = Math.max(0, file.size - 1024);
  const tail = (await file.slice(start).text()).trimEnd();
  const boundary = tail.lastIndexOf("\n");
  let checkpoint: ChatCheckpoint | undefined;
  if (start === 0 || boundary >= 0) {
    const last = JSON.parse(tail.slice(boundary + 1)) as HistoryEntry;
    if (last.type === "checkpoint") checkpoint = { head: last.head, hash: last.hash, count: last.count };
  }
  if (known && checkpoint?.head === known.head && checkpoint.hash === known.hash)
    return { chat: known.chat, checkpoint };

  const entries: LogEntry[] = [];
  for (const entry of decodeLines(await file.text()) as HistoryEntry[]) {
    if (entry.type !== "checkpoint") entries.push(entry);
  }
  // Older histories use the separately stored checkpoint until their next write.
  return { chat: replayLog(id, entries).chat, checkpoint };
}
