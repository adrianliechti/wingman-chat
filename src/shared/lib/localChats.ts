import type { Chat } from "@/shared/types/chat";
import { withPersistenceLock } from "./persistence";
import { normalizeStoredChat, type LegacyStoredChat } from "./chatMigration";
import { decodeLines, encodeLines, replayLog, type LogEntry } from "./chatLog";
import { rehydrateChatBlobs, restoreChatManifest, type StoredChat } from "./opfs-chat";
import {
  deleteFile,
  fileExists,
  listDirectories,
  listFiles,
  readBlob,
  readFileMetadata,
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
/** The pre-migration record, retained with its attachments so a lossy migration can be redone. */
export const legacyChatPath = (id: string) => `chats/${id}/chat.legacy.json`;

/**
 * Older transcripts and fields migrate on read; the next save writes the
 * current record over the old file. Keep the original once before that can
 * happen, because conversion drops what it cannot read.
 * Failing to keep the copy is logged, not fatal: the chat still opens.
 */
export async function keepLegacyRecord(id: string, raw: LegacyStoredChat | StoredChat): Promise<void> {
  try {
    if (await fileExists(legacyChatPath(id))) return;
    await writeJson(legacyChatPath(id), raw);
  } catch (error) {
    console.warn(`Could not keep the pre-migration record of chat ${id}:`, error);
  }
}

/** Written when this browser first starts backup engines. */
export const BACKUP_ACCOUNT_FILE = "_sync/backup.json";

/** Saves only need an outbox once this browser has started backing up. */
export function isBackupActivated(): Promise<boolean> {
  return fileExists(BACKUP_ACCOUNT_FILE);
}

const withoutBase = ({ baseSeq: _base, ...chat }: StoredChat) => chat;

/**
 * The pending target, unless a newer native snapshot was written without it
 * (an older build, or a save before backup started). The pending commit writes
 * both with the same content, so only a differing, later chat.json wins. It
 * keeps the target's base, because its edits were made on top of it.
 */
export async function readPendingTarget(
  id: string,
  knownLocal?: StoredChat | LegacyStoredChat,
): Promise<StoredChat | undefined> {
  const target = await readJson<StoredChat | LegacyStoredChat>(targetPath(id));
  if (!target) return undefined;
  const pending = normalizeStoredChat(target);
  const local = knownLocal ?? (await readJson<StoredChat | LegacyStoredChat>(localChatPath(id)));
  if (!local) return pending;
  const native = withoutBase(normalizeStoredChat(local));
  if (JSON.stringify(native) === JSON.stringify(withoutBase(pending))) return pending;
  const [targetFile, localFile] = await Promise.all([
    readFileMetadata(targetPath(id)),
    readFileMetadata(localChatPath(id)),
  ]);
  if ((localFile?.lastModified ?? 0) <= (targetFile?.lastModified ?? 0)) return pending;
  return pending.baseSeq === undefined ? native : { ...native, baseSeq: pending.baseSeq };
}

/** Read the local mirror without a DEK — logs and pending targets are
 *  plaintext locally; the PIN only protects the server copies. Lets the
 *  UI show chats while the session is still locked. */
export async function readLocalChat(
  id: string,
  hydrateBlobs = true,
  knownLocal?: StoredChat | LegacyStoredChat,
): Promise<Chat | undefined> {
  let stored: StoredChat | LegacyStoredChat | undefined = await readPendingTarget(id, knownLocal);
  if (!stored) stored = knownLocal ?? (await readJson<StoredChat | LegacyStoredChat>(localChatPath(id)));
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
  return withChatTarget(stored.id, async () => {
    if (pending) return writeLocalChatSnapshotUnlocked(stored, true);
    // Without an outbox this is the same commit as before backups; skip the repair marker.
    await writeJson(localChatPath(stored.id), stored);
    await storeChatIndexEntry(stored);
  });
}

export function writeLocalChatSnapshotUnlocked(stored: StoredChat, pending: boolean): Promise<void> {
  return withChatIndexUpdate(stored.id, async () => {
    if (pending) {
      await writeJson(targetPath(stored.id), stored);
      announceOutbox(stored.id);
      // The target is already durable if the native snapshot fails afterward.
      await storeChatIndexEntry(stored);
      await writeJson(localChatPath(stored.id), stored);
    } else {
      await writeJson(localChatPath(stored.id), stored);
      await storeChatIndexEntry(stored);
    }
  });
}

// Outbox notifications -----------------------------------------------------

const outboxListeners = new Set<(chatId: string) => void>();
let outboxChannel: BroadcastChannel | null | undefined;

function channel(): BroadcastChannel | null {
  if (outboxChannel !== undefined) return outboxChannel;
  outboxChannel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("wingman:chat-outbox");
  // Node (tests) would otherwise keep the process alive for the channel.
  (outboxChannel as { unref?: () => void } | null)?.unref?.();
  outboxChannel?.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (typeof event.data !== "string") return;
    for (const listener of outboxListeners) listener(event.data);
  });
  return outboxChannel;
}

function announceOutbox(chatId: string): void {
  for (const listener of outboxListeners) listener(chatId);
  channel()?.postMessage(chatId);
}

/** Tells sync engines (in any tab) which chats need a flush, so a flush need not scan every chat. */
export function onOutboxWrite(listener: (chatId: string) => void): () => void {
  channel();
  outboxListeners.add(listener);
  return () => outboxListeners.delete(listener);
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
async function withChatIndexUpdate(id: string, operation: () => Promise<void>): Promise<void> {
  await writeJson(repairPath(id), { id });
  await operation();
  await completeChatIndexRepair(id);
}

/** Shared by local saves, recovery, and incoming backup changes. */
function storeChatIndexEntry(chat: StoredChat): Promise<void> {
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
  count: number;
  /** Highest sequence received from another device that local edits have not
   *  yet incorporated. Pending edits derived from an older base are stale. */
  remote?: number;
}

type HistoryEntry = LogEntry | ({ type: "checkpoint" } & ChatCheckpoint);

export const chatHistoryPath = (id: string) => `chats/${id}/history.jsonl`;

/** The entries and their checkpoint close in the same atomic OPFS write. */
export function encodeHistory(entries: LogEntry[], checkpoint: ChatCheckpoint): string {
  return encodeLines(entries) + JSON.stringify({ type: "checkpoint", ...checkpoint }) + "\n";
}

export async function readChatHistory(id: string, known?: { head: number; chat: StoredChat }) {
  const file = await readBlob(chatHistoryPath(id));
  if (!file?.size) return undefined;
  // Check only the trailing checkpoint before deciding whether to replay a
  // potentially large log. Older logs replay in full until their next commit.
  const start = Math.max(0, file.size - 1024);
  const tail = (await file.slice(start).text()).trimEnd();
  const boundary = tail.lastIndexOf("\n");
  let checkpoint: ChatCheckpoint | undefined;
  if (start === 0 || boundary >= 0) {
    let last: HistoryEntry | undefined;
    try {
      last = JSON.parse(tail.slice(boundary + 1)) as HistoryEntry;
    } catch {
      last = undefined;
    }
    if (last?.type === "checkpoint")
      checkpoint = {
        head: last.head,
        count: last.count,
        ...(last.remote !== undefined ? { remote: last.remote } : {}),
      };
  }
  if (known && checkpoint?.head === known.head) return { chat: known.chat, checkpoint };

  const entries: LogEntry[] = [];
  for (const entry of decodeLines(await file.text()) as HistoryEntry[]) {
    if (entry.type !== "checkpoint") entries.push(entry);
  }
  // Older histories use the separately stored checkpoint until their next write.
  return { chat: replayLog(id, entries).chat, checkpoint };
}
