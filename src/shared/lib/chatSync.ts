import { SyncProgressTracker, type SyncProgress } from "./syncProgress";
/**
 * Server-synced chat storage with offline-capable OPFS mirror.
 *
 * Wire format: each chat is an append-only log. Both on the server
 * (`{chatId}.jsonl`) and locally in OPFS (`chats/{id}/history.jsonl`), the
 * physical file is one event per line. The *plaintext* of each encrypted
 * frame is itself JSON-Lines — one or more LogEntry records describing
 * the delta (init / meta / message / replace / truncate / tombstone).
 *
 * Save flow is delta-based: each save diffs the in-memory chat against
 * the last-server-confirmed StoredChat, emits only the changed entries,
 * encrypts that JSONL string, and posts. No full-chat snapshots.
 *
 * Reading: the local log is replayed into a StoredChat, then blobs are
 * rehydrated. lastSynced is held in memory after bootstrap so save
 * doesn't need to hit OPFS to compute the diff.
 */

import { isChatBackupPaused, requireChatBackupReady, BackupPausedError } from "./chatBackupActivity";
import { isBackupSessionCurrent, withBackupStorage } from "./backupLifecycle";
import { withPersistenceLock } from "./persistence";
import { normalizeStoredChat, type LegacyStoredChat } from "./chatMigration";
import type { Chat } from "@/shared/types/chat";
import { applyEntries, chunkEntries, decodeLines, diffChat, encodeLines, type LogEntry, replayLog } from "./chatLog";
import * as api from "./storeClient";
import {
  type StoreKey,
  canRestore,
  decryptBlob,
  decryptEvent,
  encryptBlob,
  encryptEvent,
  hashFrame,
  ZERO_HASH,
} from "./crypto";
import {
  collectChatBlobIds,
  extractChatBlobs,
  getChatBlob,
  rehydrateChatBlobs,
  restoreChatManifest,
  type StoredChat,
} from "./opfs-chat";
import {
  appendBlob,
  deleteDirectory,
  deleteFile,
  listDirectories,
  listFiles,
  readJson,
  readText,
  writeBlob,
  writeJson,
} from "./opfs-core";

const SYNC_DIR = "_sync";
const STATE_FILE = `${SYNC_DIR}/state.json`;

const enc = new TextEncoder();

interface SyncState {
  userId: string;
  heads: Record<string, number>;
  lastFrameHash: Record<string, string>;
  /** Number of events on the server since the last compaction for this chat. */
  entriesSinceCompact?: Record<string, number>;
}

/** Threshold of entries that triggers an automatic compaction. Keeps fresh
 *  devices' first pull bounded; the snapshot is paid for once per N saves. */
const COMPACT_THRESHOLD = 50;

interface PendingDeletion {
  id: string;
  token: string;
}
const deleteDir = (userId: string) => `_sync/deletes/u-${encodeURIComponent(userId)}`;
const deletePath = (userId: string, id: string) => `${deleteDir(userId)}/${encodeURIComponent(id)}.json`;
const withDeletionLock = <T>(userId: string, id: string, operation: () => Promise<T>) =>
  withPersistenceLock(`chat-deletion:${encodeURIComponent(userId)}:${encodeURIComponent(id)}`, operation);

async function journalDeletion(userId: string, id: string): Promise<void> {
  await withDeletionLock(userId, id, () => writeJson(deletePath(userId, id), { id, token: crypto.randomUUID() }));
}

async function pendingDeletions(userId: string): Promise<PendingDeletion[]> {
  const dir = deleteDir(userId);
  const files = await listFiles(dir);
  const entries = await Promise.all(
    files.filter((file) => file.endsWith(".json")).map((file) => readJson<PendingDeletion>(`${dir}/${file}`)),
  );
  return entries.filter(
    (entry): entry is PendingDeletion => !!entry && typeof entry.id === "string" && typeof entry.token === "string",
  );
}

async function acknowledgeDeletion(userId: string, deletion: PendingDeletion): Promise<void> {
  await withDeletionLock(userId, deletion.id, async () => {
    const path = deletePath(userId, deletion.id);
    if ((await readJson<PendingDeletion>(path))?.token === deletion.token) await deleteFile(path);
  });
}

async function loadState(): Promise<SyncState | undefined> {
  return withPersistenceLock("chat-sync-state", () => readJson<SyncState>(STATE_FILE));
}

/** Persist one chat's baseline. Each tab only writes the chats it touched, so a
 *  stale tab can never roll back heads that another tab advanced. */
async function saveChatState(state: SyncState, chatId: string): Promise<void> {
  await withPersistenceLock("chat-sync-state", async () => {
    const disk = (await readJson<SyncState>(STATE_FILE)) ?? { userId: state.userId, heads: {}, lastFrameHash: {} };
    if (disk.userId !== state.userId) return;
    const counts = (disk.entriesSinceCompact ??= {});
    if (state.heads[chatId] === undefined) {
      delete disk.heads[chatId];
      delete disk.lastFrameHash[chatId];
      delete counts[chatId];
    } else {
      disk.heads[chatId] = state.heads[chatId];
      disk.lastFrameHash[chatId] = state.lastFrameHash[chatId];
      const count = state.entriesSinceCompact?.[chatId];
      if (count === undefined) delete counts[chatId];
      else counts[chatId] = count;
    }
    await writeJson(STATE_FILE, disk);
  });
}

function forgetChatState(state: SyncState, chatId: string): void {
  delete state.heads[chatId];
  delete state.lastFrameHash[chatId];
  if (state.entriesSinceCompact) delete state.entriesSinceCompact[chatId];
}

// Per-chat paths in OPFS
const historyPath = (chatId: string) => `chats/${chatId}/history.jsonl`;
const targetPath = (chatId: string) => `chats/${chatId}/target.json`;
/** Shared by unlocked engines and saves from locked/offline tabs. */
const withTarget = <T>(chatId: string, operation: () => Promise<T>) =>
  withPersistenceLock(`chat-target:${encodeURIComponent(chatId)}`, operation);
/** OPFS-only mode stores chats here; promoted to pending targets when
 *  the server store is enabled on a deployment that has local data. */
const opfsOnlyChatPath = (chatId: string) => `chats/${chatId}/chat.json`;

/** Preserve local snapshots and attachments, but start the next backup from seq 0. */
export async function resetLocalBackupState(): Promise<void> {
  for (const id of await listDirectories("chats")) {
    const target = await readJson<StoredChat | LegacyStoredChat>(targetPath(id));
    const history = await readText(historyPath(id));
    const stored =
      target ??
      (history ? replayLog(id, decodeLines(history)).chat : null) ??
      (await readJson<StoredChat | LegacyStoredChat>(opfsOnlyChatPath(id)));
    if (stored) await writeJson(targetPath(id), normalizeStoredChat(stored));
    await deleteFile(historyPath(id));
  }
  await deleteDirectory(SYNC_DIR);
}

/** Read the local mirror without a DEK — logs and pending targets are
 *  plaintext locally; the PIN only protects the server copies. Lets the
 *  UI show chats while the session is still locked. */
export async function readLocalChat(id: string, hydrateBlobs = true): Promise<Chat | undefined> {
  let stored = await readJson<StoredChat | LegacyStoredChat>(targetPath(id));
  if (!stored) {
    const history = await readText(historyPath(id));
    if (history) stored = replayLog(id, decodeLines(history)).chat ?? undefined;
  }
  if (!stored) stored = await readJson<StoredChat | LegacyStoredChat>(opfsOnlyChatPath(id));
  if (!stored) return undefined;
  const normalized = normalizeStoredChat(stored);
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

/** Persist a chat as a pending target without a session — used while the
 *  store session is locked or errored, so edits survive the tab. The next
 *  ChatSync hydration picks the target up and flushes it. */
export function stashPendingTarget(chat: Chat): Promise<void> {
  return withBackupStorage(() => stashPendingTargetUnlocked(chat));
}

async function stashPendingTargetUnlocked(chat: Chat): Promise<void> {
  const stored = await extractChatBlobs(chat);
  await withTarget(chat.id, () => writeJson(targetPath(chat.id), stored));
}

/** Keep local deletion usable before backup protection has been configured. */
export function stashPendingDeletion(chatId: string, userId?: string): Promise<void> {
  return withBackupStorage(() => stashPendingDeletionUnlocked(chatId, userId));
}

async function stashPendingDeletionUnlocked(chatId: string, userId?: string): Promise<void> {
  const previous = await loadState();
  const owner = userId ?? previous?.userId;
  if (!owner || (previous && previous.userId !== owner)) {
    await deleteDirectory(`chats/${chatId}`);
    return;
  }
  const state = previous ?? { userId: owner, heads: {}, lastFrameHash: {} };
  await journalDeletion(owner, chatId);
  forgetChatState(state, chatId);
  await saveChatState(state, chatId);
  await deleteDirectory(`chats/${chatId}`);
}

// ChatSync ---------------------------------------------------------------

export interface ChatSyncOptions {
  userId: string;
  dek: StoreKey;
}

export interface SyncActivity {
  progress: SyncProgress[];
  syncing: boolean;
  /** Chats with local edits not yet confirmed by the server. */
  pendingCount: number;
  lastSyncAt: string | null; // ISO
  lastError: string | null;
}

export class ChatSync {
  private state: SyncState;
  /** Server-confirmed state per chat (in memory; persisted as history.jsonl). */
  private lastSynced = new Map<string, StoredChat>();
  /** Pending target per chat (in memory; persisted as target.json). */
  private pendingTargets = new Map<string, StoredChat>();
  private deletions = new Map<string, PendingDeletion>();
  private flushing = false;
  private readonly userId: string;
  private dek: StoreKey;

  private activity: SyncActivity = { syncing: false, pendingCount: 0, lastSyncAt: null, lastError: null, progress: [] };
  private progress = new SyncProgressTracker(() => this.setActivity({}));
  private activityListeners = new Set<(a: SyncActivity) => void>();
  private remoteChangeListeners = new Set<(chats: Chat[]) => void>();

  constructor(userId: string, dek: StoreKey, initialState?: SyncState) {
    this.userId = userId;
    this.dek = dek;
    this.state = initialState ?? { userId, heads: {}, lastFrameHash: {} };
  }

  static async create(opts: ChatSyncOptions): Promise<ChatSync> {
    let state = await loadState();
    if (state && state.userId !== opts.userId) {
      await wipeLocalMirror();
      state = undefined;
    }
    const sync = new ChatSync(opts.userId, opts.dek, state);
    await sync.hydrateFromOpfs();
    await sync.refreshDeletions();
    sync.setActivity({});
    return sync;
  }

  /** Grant restore access for this page without replacing engines with writes in flight. */
  setKey(dek: StoreKey): void {
    this.dek = dek;
  }

  // public API ----------------------------------------------------------

  /** Watch sync activity (in-flight, pending count, last sync, last error). */
  subscribeActivity(fn: (a: SyncActivity) => void): () => void {
    this.activityListeners.add(fn);
    fn(this.activity);
    return () => this.activityListeners.delete(fn);
  }

  /** Notified with the fresh composed chat list whenever a pull() applied
   *  remote changes (new events or server-side deletions). */
  subscribeRemoteChanges(fn: (chats: Chat[]) => void): () => void {
    this.remoteChangeListeners.add(fn);
    return () => this.remoteChangeListeners.delete(fn);
  }

  private setActivity(patch: Partial<Omit<SyncActivity, "syncing" | "progress">>): void {
    const progress = this.progress.snapshot;
    this.activity = {
      ...this.activity,
      pendingCount: new Set([...this.pendingTargets.keys(), ...this.deletions.keys()]).size,
      ...patch,
      progress,
      syncing: progress.length > 0,
    };
    for (const l of this.activityListeners) l(this.activity);
  }

  private pullInFlight: Promise<Chat[]> | null = null;

  /** Pull remote changes for every chat into the local mirror; return
   *  the materialized chat list (pending targets win over lastSynced).
   *  Concurrent calls share one in-flight pull. */
  pull(): Promise<Chat[]> {
    return withBackupStorage(() => (isBackupSessionCurrent() ? this.pullUnlocked() : Promise.resolve([])));
  }

  private async pullUnlocked(): Promise<Chat[]> {
    if (!canRestore(this.dek)) throw new Error("Unlock with your PIN or passkey to restore server data.");
    if (this.pullInFlight) return this.pullInFlight;
    this.pullInFlight = (async () => {
      const progress = this.progress.begin("restore");
      try {
        return await this.pullInner(progress);
      } catch (err) {
        this.setActivity({ lastError: errorMessage(err) });
        throw err;
      } finally {
        progress.finish();
        this.pullInFlight = null;
      }
    })();
    return this.pullInFlight;
  }

  private async pullInner(progress: ReturnType<SyncProgressTracker["begin"]>): Promise<Chat[]> {
    const before = new Map(this.lastSynced);
    // Other tabs share the OPFS mirror; adopt chats they created or removed.
    await this.syncKnownChats();
    const headsBeforeListing = { ...this.state.heads };
    const remote = await api.listChats();
    await this.refreshDeletions();
    const pending = remote.filter(
      (meta) => !this.deletions.has(meta.id) && meta.headSeq > (this.state.heads[meta.id] ?? 0),
    );
    progress.setTotal(pending.length);

    // Pull in parallel; one broken chat must not hide changes to the others.
    const results = await Promise.allSettled(
      pending.map(async (meta) => {
        await this.applyRemoteEvents(meta.id, meta.headSeq);
        progress.advance();
      }),
    );
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    for (const failure of failures) console.warn("chatSync.pull: chat restore failed", failure.reason);

    // Apply remote deletions only to baselines that existed before this listing.
    // A concurrent upload may have created or updated a chat since the request began.
    const remoteIds = new Set(remote.map((r) => r.id));
    for (const [id, head] of Object.entries(headsBeforeListing)) {
      if (remoteIds.has(id)) continue;
      await this.withChat(id, async () => {
        if (this.state.heads[id] !== head) return;
        if (this.pendingTargets.has(id)) {
          // Keep offline edits and their attachments; the next upload starts
          // a fresh log rather than diffing against the deleted server copy.
          await deleteFile(historyPath(id));
        } else {
          await deleteDirectory(`chats/${id}`);
        }
        this.lastSynced.delete(id);
        forgetChatState(this.state, id);
        await saveChatState(this.state, id);
      });
    }

    // Compose the visible chat list: pending target if any, else lastSynced.
    await this.refreshDeletions();
    const out: Chat[] = [];
    for (const id of new Set([...this.pendingTargets.keys(), ...this.lastSynced.keys()])) {
      if (this.deletions.has(id)) continue;
      const stored = this.pendingTargets.get(id) ?? this.lastSynced.get(id);
      if (stored) out.push(restoreChatManifest(stored));
    }

    // Adopting another tab's baseline changes the view even without a download.
    if (before.size !== this.lastSynced.size || [...before].some(([id, chat]) => this.lastSynced.get(id) !== chat)) {
      for (const l of this.remoteChangeListeners) l(out);
    }
    // Healthy chats are applied and published above; report the first broken one.
    if (failures.length > 0) throw failures[0].reason;
    this.setActivity({ lastSyncAt: new Date().toISOString(), lastError: null });
    return out;
  }

  /** Persist a chat as a delta: local mirror first (offline-safe), then
   *  flush. Never waits for network work on the same chat. */
  saveChat(chat: Chat): Promise<void> {
    return withBackupStorage(async () => {
      if (!isBackupSessionCurrent()) return stashPendingTargetUnlocked(chat);
      const stored = await extractChatBlobs(chat);
      await withTarget(chat.id, async () => {
        await writeJson(targetPath(chat.id), stored);
        this.pendingTargets.set(chat.id, stored);
      });
      this.setActivity({});
      if (!isChatBackupPaused(chat.id)) void this.flushPending();
    });
  }

  /** Delete a chat: drop local state immediately, journal the server-side
   *  deletion so it retries until confirmed. Other devices learn of the
   *  deletion from the chat listing. */
  deleteChat(chatId: string): Promise<void> {
    return withBackupStorage(() =>
      isBackupSessionCurrent()
        ? this.withChat(chatId, () => this.deleteChatUnlocked(chatId))
        : stashPendingDeletionUnlocked(chatId, this.userId),
    );
  }

  private async deleteChatUnlocked(chatId: string): Promise<void> {
    await journalDeletion(this.userId, chatId);
    this.pendingTargets.delete(chatId);
    this.lastSynced.delete(chatId);
    forgetChatState(this.state, chatId);
    await saveChatState(this.state, chatId);
    this.setActivity({});

    await deleteDirectory(`chats/${chatId}`);
    void this.flushPending();
  }

  /** Replay any journaled deletions and pending targets through the server. */
  flushPending(): Promise<void> {
    return withBackupStorage(async () => {
      if (isBackupSessionCurrent()) await this.flushPendingUnlocked();
    });
  }

  private async flushPendingUnlocked(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      await this.refreshDeletions();
    } catch (error) {
      this.flushing = false;
      this.setActivity({ lastError: errorMessage(error) });
      throw error;
    }
    const deletes = Array.from(this.deletions.values()).filter((del) => !isChatBackupPaused(del.id));
    const chats = Array.from(this.pendingTargets.keys()).filter(
      (id) => !isChatBackupPaused(id) && !this.deletions.has(id),
    );
    const progress = this.progress.begin("backup", deletes.length + chats.length);
    let failed = false;
    try {
      for (const del of deletes) {
        if (isChatBackupPaused(del.id)) continue;
        if (await this.pushDelete(del)) {
          await acknowledgeDeletion(this.userId, del);
          this.deletions.delete(del.id);
          this.pendingTargets.delete(del.id);
          this.lastSynced.delete(del.id);
          progress.advance();
        } else {
          failed = true;
        }
      }

      // Keep going past failures — one poisoned chat must not block the rest.
      for (const chatId of chats) {
        if (isChatBackupPaused(chatId)) continue;
        if (!(await this.withChat(chatId, () => this.flushChat(chatId)))) failed = true;
        else progress.advance();
      }
      await this.refreshDeletions();
    } catch (error) {
      failed = true;
      this.setActivity({ lastError: errorMessage(error) });
      throw error;
    } finally {
      progress.finish();
      this.flushing = false;
      this.setActivity(failed ? {} : { lastSyncAt: new Date().toISOString(), lastError: null });
    }

    // Work that arrived mid-flush was skipped by the re-entrancy guard.
    if (
      !failed &&
      ([...this.pendingTargets.keys()].some((id) => !isChatBackupPaused(id) && !this.deletions.has(id)) ||
        [...this.deletions.values()].some((entry) => !isChatBackupPaused(entry.id)))
    ) {
      void this.flushPending();
    }
  }

  // internals -----------------------------------------------------------

  private async refreshDeletions(): Promise<void> {
    this.deletions = new Map((await pendingDeletions(this.userId)).map((entry) => [entry.id, entry]));
    this.setActivity({});
  }

  private async hydrateFromOpfs(): Promise<void> {
    for (const id of await listDirectories("chats")) {
      const target = await readJson<StoredChat | LegacyStoredChat>(targetPath(id));
      const history = await readText(historyPath(id));
      if (!history) {
        // A pending edit takes precedence over an older local-only record.
        const local = target ?? (await readJson<StoredChat | LegacyStoredChat>(opfsOnlyChatPath(id)));
        if (this.state.heads[id] !== undefined) {
          // Without a replayable log, the chat must upload as a fresh snapshot.
          forgetChatState(this.state, id);
          await saveChatState(this.state, id);
        }
        if (local) {
          const stored = normalizeStoredChat(local);
          this.pendingTargets.set(id, stored);
          await writeJson(targetPath(id), stored);
          await deleteFile(opfsOnlyChatPath(id));
        }
        continue;
      }
      const { chat } = replayLog(id, decodeLines(history));
      if (chat) this.lastSynced.set(id, chat);
      if (target) this.pendingTargets.set(id, normalizeStoredChat(target));
    }
  }

  /** Adopt chats another tab created and forget ones it deleted. */
  private async syncKnownChats(): Promise<void> {
    const ids = new Set(await listDirectories("chats"));
    for (const id of new Set([...this.lastSynced.keys(), ...this.pendingTargets.keys()])) {
      if (ids.has(id)) continue;
      this.lastSynced.delete(id);
      this.pendingTargets.delete(id);
    }
    for (const id of ids) {
      if (!this.lastSynced.has(id) && !this.pendingTargets.has(id)) await this.reloadChat(id);
    }
  }

  /** Re-read one chat's baseline and pending target from OPFS. Another tab may
   *  have advanced either since this tab last looked. */
  private async reloadChat(chatId: string): Promise<void> {
    const disk = await loadState();
    const owned = disk?.userId === this.userId;
    const head = owned ? disk.heads[chatId] : undefined;
    const hash = owned ? disk.lastFrameHash[chatId] : undefined;
    if (head !== this.state.heads[chatId] || hash !== this.state.lastFrameHash[chatId]) {
      if (head === undefined) {
        forgetChatState(this.state, chatId);
      } else {
        this.state.heads[chatId] = head;
        this.state.lastFrameHash[chatId] = hash ?? ZERO_HASH;
        const count = owned ? disk.entriesSinceCompact?.[chatId] : undefined;
        if (count === undefined) delete this.state.entriesSinceCompact?.[chatId];
        else (this.state.entriesSinceCompact ??= {})[chatId] = count;
      }
      const history = head === undefined ? undefined : await readText(historyPath(chatId));
      const chat = history ? replayLog(chatId, decodeLines(history)).chat : null;
      if (chat) this.lastSynced.set(chatId, chat);
      else this.lastSynced.delete(chatId);
    }
    await withTarget(chatId, async () => {
      const target = await readJson<StoredChat | LegacyStoredChat>(targetPath(chatId));
      if (target) this.pendingTargets.set(chatId, normalizeStoredChat(target));
      else this.pendingTargets.delete(chatId);
    });
  }

  private async pushDelete(del: { id: string }): Promise<boolean> {
    try {
      if (!canRestore(this.dek)) throw new Error("Unlock restore before deleting a server backup.");
      requireChatBackupReady(del.id);
      await api.deleteChat(del.id);
      // Content-addressed blobs can be shared by other chats or devices.
      // Keep them until account reset; deleting without a reference index loses data.
      return true;
    } catch (err) {
      if (err instanceof BackupPausedError) return false;
      this.setActivity({ lastError: errorMessage(err) });
      console.warn(`chatSync: server delete failed for ${del.id}`, err);
      return false;
    }
  }

  /** Serialize network sync per chat across tabs. Each run starts from the
   *  baseline on disk, since another tab may have posted or pulled meanwhile. */
  private withChat<T>(chatId: string, fn: () => Promise<T>): Promise<T> {
    return withPersistenceLock(
      `chat-sync:${encodeURIComponent(this.userId)}:${encodeURIComponent(chatId)}`,
      async () => {
        await this.reloadChat(chatId);
        return fn();
      },
    );
  }

  private async uploadMissingBlobs(chatId: string, stored: StoredChat): Promise<void> {
    for (const blobId of collectChatBlobIds(stored)) {
      requireChatBackupReady(chatId);
      if (await api.headBlob(blobId)) continue;
      const blob = await getChatBlob(chatId, blobId);
      if (!blob) throw new Error(`Attachment ${blobId} is missing locally and has not been backed up.`);
      const plain = new Uint8Array(await blob.arrayBuffer());
      const cipher = await encryptBlob(this.dek, plain, this.userId, blobId);
      requireChatBackupReady(chatId);
      await api.putBlob(blobId, cipher);
    }
  }

  /** Compute the delta for one chat and post it (caller holds the chat lock).
   *  Returns true on success (or no-op), false on network/persistent conflict. */
  private async flushChat(chatId: string): Promise<boolean> {
    const target = this.pendingTargets.get(chatId);
    if (!target) return true;

    const entries = diffChat(this.lastSynced.get(chatId) ?? null, target);
    if (entries.length === 0) {
      await this.clearPendingTarget(chatId, target);
      return true;
    }

    try {
      // Attachments must exist on the server before the entries that
      // reference them.
      await this.uploadMissingBlobs(chatId, target);
      if (isChatBackupPaused(chatId)) return false;
      await this.postEntries(chatId, entries);
    } catch (err) {
      if (err instanceof BackupPausedError) return false;
      this.setActivity({ lastError: errorMessage(err) });
      console.warn(`chatSync.flushChat(${chatId}): post failed`, err);
      return false;
    }

    await this.clearPendingTarget(chatId, target);
    await this.maybeCompact(chatId);
    return true;
  }

  /** Drop the pending target — unless a newer save replaced it while the
   *  flush was in flight (in this or another tab), in which case it must flush again. */
  private async clearPendingTarget(chatId: string, flushed: StoredChat): Promise<void> {
    await withTarget(chatId, async () => {
      const current = await readJson<StoredChat | LegacyStoredChat>(targetPath(chatId));
      if (!current) {
        this.pendingTargets.delete(chatId);
      } else if (JSON.stringify(current) === JSON.stringify(flushed)) {
        this.pendingTargets.delete(chatId);
        await deleteFile(targetPath(chatId));
      } else {
        this.pendingTargets.set(chatId, normalizeStoredChat(current));
      }
    });
    this.setActivity({});
  }

  /** Encrypt + post entries, split into requests under the server's append cap.
   *  Each accepted request is committed locally, so a later failure resumes
   *  from there. A 409 pulls and re-diffs once; snapshots give up instead,
   *  since a re-diffed delta must never be mistaken for a compaction base.
   *  Returns the first posted seq, or null when nothing (more) was posted. */
  private async postEntries(chatId: string, entries: LogEntry[], snapshot = false): Promise<number | null> {
    let firstSeq: number | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      // One frame per chunk, hash-chained in order. A first-sync snapshot
      // of a long chat easily exceeds the server's per-frame cap as a single frame.
      const chunks = chunkEntries(entries);
      const frames: { id: string; frame: string; hash: string; entries: LogEntry[] }[] = [];
      let prevHash = this.state.lastFrameHash[chatId] ?? ZERO_HASH;
      let seq = this.state.heads[chatId] ?? 0;
      for (const chunk of chunks) {
        seq += 1;
        const payload = { id: crypto.randomUUID(), ts: new Date().toISOString(), prevHash, body: chunk };
        const frame = await encryptEvent(this.dek, payload, this.userId, chatId, seq);
        prevHash = await hashFrame(frame);
        frames.push({ id: payload.id, frame, hash: prevHash, entries: chunk });
      }

      let conflict = false;
      for (const batch of appendBatches(frames)) {
        const expectedSeq = this.state.heads[chatId] ?? 0;
        requireChatBackupReady(chatId);
        const res = await api.appendEvents(
          chatId,
          expectedSeq,
          batch.map(({ id, frame }) => ({ id, frame })),
        );
        if (res === null) {
          conflict = true;
          break;
        }
        firstSeq ??= expectedSeq + 1;
        await this.commitPosted(
          chatId,
          batch.flatMap((item) => item.entries),
          res.newSeq,
          batch.at(-1)!.hash,
        );
      }
      if (!conflict) return firstSeq;
      if (snapshot) return null;

      requireChatBackupReady(chatId);
      if (!canRestore(this.dek))
        throw new Error("Another device changed this chat. Unlock restore to reconcile before uploading.");
      // We already hold this chat's lock.
      await this.applyRemoteEventsLocked(chatId, this.state.heads[chatId] ?? 0);
      const target = this.pendingTargets.get(chatId);
      if (!target) return firstSeq;
      entries = diffChat(this.lastSynced.get(chatId) ?? null, target);
      if (entries.length === 0) return firstSeq;
    }
    throw new PostConflictAfterRetry();
  }

  /** Apply entries the server accepted to the local log, baseline and head. */
  private async commitPosted(chatId: string, entries: LogEntry[], head: number, hash: string): Promise<void> {
    await appendBlob(historyPath(chatId), new Blob([enc.encode(encodeLines(entries))]));
    const merged = applyEntries(this.lastSynced.get(chatId) ?? null, entries, chatId);
    if (merged) this.lastSynced.set(chatId, merged);
    else this.lastSynced.delete(chatId);

    this.state.heads[chatId] = head;
    this.state.lastFrameHash[chatId] = hash;
    const counts = (this.state.entriesSinceCompact ??= {});
    // A snapshot resets the count; it survives as one entry.
    counts[chatId] = entries[0]?.type === "init" ? 1 : (counts[chatId] ?? 0) + entries.length;
    await saveChatState(this.state, chatId);
  }

  /** If the log has grown past the threshold, replace it with a single
   *  init-led snapshot and ask the server to drop the prefix. */
  private async maybeCompact(chatId: string): Promise<void> {
    const count = this.state.entriesSinceCompact?.[chatId] ?? 0;
    if (count < COMPACT_THRESHOLD) return;

    const target = this.lastSynced.get(chatId);
    if (!target) return;
    // Don't compact while there's a pending edit — the next flush handles it.
    if (this.pendingTargets.has(chatId)) return;

    const entries = diffChat(null, target); // forces init + meta + messages
    if (entries.length === 0) return;

    let firstSeq: number | null;
    try {
      firstSeq = await this.postEntries(chatId, entries, true);
    } catch (err) {
      if (err instanceof BackupPausedError) return;
      console.warn(`chatSync.maybeCompact(${chatId}): post failed`, err);
      return;
    }
    // Keep the whole snapshot: it may span several frames, and the first
    // one carries the init entry fresh readers replay from.
    if (firstSeq === null || firstSeq < 2) return; // nothing to drop

    try {
      requireChatBackupReady(chatId);
      await api.compactChat(chatId, firstSeq);
    } catch (err) {
      if (err instanceof BackupPausedError) return;
      console.warn(`chatSync.maybeCompact(${chatId}): server compact failed`, err);
      return;
    }

    // Replace the local log with just the surviving snapshot entry.
    await writeBlob(historyPath(chatId), new Blob([enc.encode(encodeLines(entries))]));
  }

  /** Pull events up to expectedHead and apply them. Returns whether anything changed. */
  private applyRemoteEvents(chatId: string, expectedHead: number): Promise<boolean> {
    return this.withChat(chatId, async () => {
      const head = this.state.heads[chatId] ?? 0;
      // Another tab may already have pulled this range.
      if (head >= expectedHead) return false;
      return this.applyRemoteEventsLocked(chatId, head, expectedHead);
    });
  }

  /** Apply events after fromSeq to local state (history file + in-memory
   *  baseline + head + hash). The caller holds this chat's lock. */
  private async applyRemoteEventsLocked(chatId: string, fromSeq: number, expectedHead = fromSeq): Promise<boolean> {
    const applied = await withDeletionLock(this.userId, chatId, async () => {
      // A journaled deletion beats the server copy — don't resurrect it.
      if (await readJson(deletePath(this.userId, chatId))) return false;
      // Another tab may already have applied part of the range.
      fromSeq = Math.max(fromSeq, this.state.heads[chatId] ?? 0);

      const events = await api.readEvents(chatId, fromSeq);
      if (events.length === 0) {
        if (fromSeq < expectedHead)
          throw new Error(`Incomplete backup for ${chatId}: expected sequence ${expectedHead}.`);
        return false;
      }

      let head = this.state.heads[chatId] ?? 0;
      let lastHash = this.state.lastFrameHash[chatId] ?? ZERO_HASH;
      let baseline = this.lastSynced.get(chatId) ?? null;

      const appendedText: string[] = [];
      let logWasReset = false;
      let entryCount = this.state.entriesSinceCompact?.[chatId] ?? 0;

      for (const e of events) {
        if (e.seq <= head) continue; // already applied

        type RemotePayload = { id: string; ts: string; prevHash: string; body: LogEntry[] };
        let payload: RemotePayload;
        try {
          payload = await decryptEvent<RemotePayload>(this.dek, e.frame, this.userId, chatId, e.seq);
        } catch (err) {
          throw new Error(`Could not decrypt backup ${chatId}@${e.seq}.`, { cause: err });
        }

        const entries = payload.body;
        const isReset = entries[0]?.type === "init";

        // A gap is expected right after another device compacted the chat
        // (the server dropped the log prefix) — but only an init snapshot
        // may bridge it, since it replays from scratch.
        if (e.seq !== head + 1 && !isReset) {
          throw new Error(`Incomplete backup for ${chatId}: expected sequence ${head + 1}, received ${e.seq}.`);
        }

        if (!isReset && payload.prevHash !== lastHash) {
          throw new Error(`Backup integrity check failed for ${chatId}@${e.seq}.`);
        }

        if (isReset) {
          // Compaction snapshot — discard prior state and replay fresh.
          baseline = null;
          appendedText.length = 0;
          logWasReset = true;
        }
        baseline = applyEntries(baseline, entries, chatId);
        appendedText.push(encodeLines(entries));
        entryCount = isReset ? 1 : entryCount + entries.length;

        lastHash = await hashFrame(e.frame);
        head = e.seq;
      }

      if (head < expectedHead)
        throw new Error(`Incomplete backup for ${chatId}: expected sequence ${expectedHead}, received ${head}.`);
      if (appendedText.length === 0) return false;

      // Confirm attachments before committing history/head so a failed download
      // retries on the next pull, even if no new events have arrived.
      if (baseline) await this.downloadMissingBlobs(chatId, baseline);
      const text = new Blob([enc.encode(appendedText.join(""))]);
      if (logWasReset) await writeBlob(historyPath(chatId), text);
      else await appendBlob(historyPath(chatId), text);

      (this.state.entriesSinceCompact ??= {})[chatId] = entryCount;
      if (baseline) this.lastSynced.set(chatId, baseline);
      else this.lastSynced.delete(chatId);
      this.state.heads[chatId] = head;
      this.state.lastFrameHash[chatId] = lastHash;
      return true;
    });
    if (applied) await saveChatState(this.state, chatId);
    return applied;
  }

  private async downloadMissingBlobs(chatId: string, stored: StoredChat): Promise<void> {
    for (const blobId of collectChatBlobIds(stored)) {
      if (await getChatBlob(chatId, blobId)) continue;
      const cipher = await api.getBlob(blobId);
      if (!cipher) throw new Error(`Attachment ${blobId} is missing from backup ${chatId}.`);
      const plain = await decryptBlob(this.dek, cipher, this.userId, blobId);
      await writeBlob(`chats/${chatId}/blobs/${blobId}.bin`, new Blob([new Uint8Array(plain)]));
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Stay well below the server's 64 MiB append body cap. */
const MAX_APPEND_BYTES = 48 * 1024 * 1024;

function appendBatches<T extends { id: string; frame: string }>(frames: T[]): T[][] {
  const batches: T[][] = [];
  let size = 0;
  for (const frame of frames) {
    const bytes = frame.id.length + frame.frame.length + 32;
    if (batches.length === 0 || size + bytes > MAX_APPEND_BYTES) {
      batches.push([]);
      size = 0;
    }
    batches.at(-1)!.push(frame);
    size += bytes;
  }
  return batches;
}

class PostConflictAfterRetry extends Error {
  constructor() {
    super("chatSync: still 409 after retry");
  }
}

async function wipeLocalMirror(): Promise<void> {
  try {
    await deleteDirectory("chats");
  } catch {
    /* empty */
  }
  try {
    // File sync owns its user marker and must see it to clear the old workspace.
    await deleteFile(STATE_FILE);
  } catch {
    /* empty */
  }
}
