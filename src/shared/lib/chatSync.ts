import { SyncProgressTracker, type SyncProgress } from "./syncProgress";
/**
 * Server-synced chat storage with offline-capable OPFS mirror.
 *
 * Local chat.json snapshots remain usable independently of backup. The
 * confirmed backup baseline lives in history.jsonl; target.json is its outbox.
 * Each encrypted remote frame contains one or more LogEntry records describing
 * the delta (init / meta / message / replace / truncate / tombstone).
 *
 * Save flow is delta-based: each save diffs the in-memory chat against
 * the last-server-confirmed StoredChat, emits only the changed entries,
 * encrypts that JSONL string, and posts. No full-chat snapshots.
 *
 * Reading uses the native snapshot (with log replay for older local records).
 * lastSynced is held in memory after bootstrap so backup
 * doesn't need to hit OPFS to compute the diff.
 */

import { isChatBackupPaused, requireChatBackupReady, BackupPausedError } from "./chatBackupActivity";
import { BackupBusyError } from "./backupBusy";
import { CHAT_APPEND_BATCH_SIZE, createChatAppendBatch } from "./chatAppendBatch";
import { isBackupSessionCurrent, withBackupStorage, WORKSPACE_OWNER_KEY } from "./backupLifecycle";
import { withPersistenceLock } from "./persistence";
import {
  chatHistoryPath as historyPath,
  chatRetentionCutoff,
  completeChatIndexRepair,
  encodeHistory,
  readChatHistory,
  targetPath,
  localChatPath,
  withChatTarget,
  writeLocalChatSnapshot,
  writeLocalChatSnapshotUnlocked,
} from "./localChats";
import { normalizeStoredChat, type LegacyStoredChat } from "./chatMigration";
import type { Chat } from "@/shared/types/chat";
import { applyEntries, chunkEntries, decodeLines, diffChat, encodeLines, type LogEntry, replayLog } from "./chatLog";
import * as api from "./storeClient";
import { type RootKey, decryptBlob, decryptEvent, encryptBlob, encryptEvent } from "./crypto";
import { collectChatBlobIds, extractChatBlobs, getChatBlob, restoreChatManifest, type StoredChat } from "./opfs-chat";
import {
  appendBlob,
  deleteDirectory,
  deleteFile,
  listDirectories,
  listFiles,
  fileExists,
  readJson,
  readText,
  writeBlob,
  writeJson,
  removeIndexEntry,
} from "./opfs-core";

const SYNC_DIR = "_sync";
const STATE_FILE = `${SYNC_DIR}/state.json`;

const enc = new TextEncoder();

interface SyncState {
  userId: string;
  heads: Record<string, number>;
  /** Deleted logs retain their cursor so a new init never reuses a sequence. */
  tombstones?: Record<string, number>;
  /** Number of events on the server since the last compaction for this chat. */
  entriesSinceCompact?: Record<string, number>;
  /** In memory only; persisted in each history checkpoint. See ChatCheckpoint.remote. */
  remoteHeads?: Record<string, number>;
}

/** Threshold of entries that triggers an automatic compaction. Keeps fresh
 *  devices' first pull bounded; the snapshot is paid for once per N saves. */
const COMPACT_THRESHOLD = 50;

interface PendingDeletion {
  id: string;
  token: string;
  expectedSeq: number;
}
const deleteDir = (userId: string) => `_sync/deletes/u-${encodeURIComponent(userId)}`;
const deletePath = (userId: string, id: string) => `${deleteDir(userId)}/${encodeURIComponent(id)}.json`;
const withDeletionLock = <T>(userId: string, id: string, operation: () => Promise<T>) =>
  withPersistenceLock(`chat-deletion:${encodeURIComponent(userId)}:${encodeURIComponent(id)}`, operation);

async function journalDeletion(userId: string, id: string, expectedSeq: number): Promise<void> {
  await withDeletionLock(userId, id, async () => {
    // A new deletion supersedes an earlier cancelled one; its files may go now.
    await deleteFile(keepPath(userId, id));
    await writeJson(deletePath(userId, id), { id, token: crypto.randomUUID(), expectedSeq });
  });
}

// Chat workspace files ----------------------------------------------------
//
// Artifacts under chats/<id>/ sync through FileSync, which sees a removed chat
// folder as a deletion of each file. Their fate follows the chat's: they are
// deleted remotely only once the server confirms the chat deletion. When the
// deletion is cancelled because another device saved newer work, or local
// edits recreate a chat another device deleted, a marker tells FileSync to
// restore or re-upload the files instead of deleting them.

const keepDir = (userId: string) => `_sync/keep-files/u-${encodeURIComponent(userId)}`;
const keepPath = (userId: string, id: string) => `${keepDir(userId)}/${encodeURIComponent(id)}.json`;

/** "restore": bring back files removed with a cancelled deletion.
 *  "reupload": upload files again for a chat recreated after a remote deletion. */
export type WorkspaceKeep = { token: string; kind: "restore" | "reupload" };

function keepMarker(id: string, kind: WorkspaceKeep["kind"]) {
  return { id, kind, token: crypto.randomUUID() };
}

async function keepChatWorkspace(userId: string, id: string, kind: WorkspaceKeep["kind"]): Promise<void> {
  await withDeletionLock(userId, id, () => writeJson(keepPath(userId, id), keepMarker(id, kind)));
}

function parseKeep(marker: { token?: unknown; kind?: unknown } | undefined): WorkspaceKeep | null {
  if (typeof marker?.token !== "string" || (marker.kind !== "restore" && marker.kind !== "reupload")) return null;
  return { token: marker.token, kind: marker.kind };
}

export interface ChatWorkspaceState {
  /** A local deletion of the chat awaits the server's decision. */
  deleting: boolean;
  keep: WorkspaceKeep | null;
  /** The chat has local edits that the backup has not confirmed yet. */
  pendingEdit: boolean;
}

export async function chatWorkspaceState(userId: string, id: string): Promise<ChatWorkspaceState> {
  const [deletion, keep, pendingEdit] = await Promise.all([
    readJson<PendingDeletion>(deletePath(userId, id)),
    readJson<{ token?: unknown; kind?: unknown }>(keepPath(userId, id)),
    fileExists(targetPath(id)),
  ]);
  return { deleting: !!deletion, keep: parseKeep(keep), pendingEdit };
}

/** Keep markers by chat ID. */
export async function keptChatWorkspaces(userId: string): Promise<Map<string, WorkspaceKeep>> {
  const dir = keepDir(userId);
  const kept = new Map<string, WorkspaceKeep>();
  for (const file of await listFiles(dir)) {
    if (!file.endsWith(".json")) continue;
    const marker = await readJson<{ id?: unknown; token?: unknown; kind?: unknown }>(`${dir}/${file}`);
    const keep = parseKeep(marker);
    if (typeof marker?.id === "string" && keep) kept.set(marker.id, keep);
  }
  return kept;
}

/** Drop a keep marker once its files have been reconciled. */
export async function releaseChatWorkspace(userId: string, id: string, token: string): Promise<void> {
  await withDeletionLock(userId, id, async () => {
    const path = keepPath(userId, id);
    if ((await readJson<{ token?: string }>(path))?.token === token) await deleteFile(path);
  });
}

async function pendingDeletions(userId: string): Promise<PendingDeletion[]> {
  const dir = deleteDir(userId);
  const files = await listFiles(dir);
  const entries = await Promise.all(
    files.filter((file) => file.endsWith(".json")).map((file) => readJson<PendingDeletion>(`${dir}/${file}`)),
  );
  return entries.filter(
    (entry): entry is PendingDeletion =>
      !!entry &&
      typeof entry.id === "string" &&
      typeof entry.token === "string" &&
      typeof entry.expectedSeq === "number",
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
    const disk = (await readJson<SyncState>(STATE_FILE)) ?? { userId: state.userId, heads: {} };
    if (disk.userId !== state.userId) return;
    const counts = (disk.entriesSinceCompact ??= {});
    const tombstones = (disk.tombstones ??= {});
    if (state.tombstones?.[chatId] === undefined) delete tombstones[chatId];
    else tombstones[chatId] = state.tombstones[chatId];
    if (state.heads[chatId] === undefined) {
      delete disk.heads[chatId];
      delete counts[chatId];
    } else {
      disk.heads[chatId] = state.heads[chatId];
      const count = state.entriesSinceCompact?.[chatId];
      if (count === undefined) delete counts[chatId];
      else counts[chatId] = count;
    }
    await writeJson(STATE_FILE, disk);
  });
}

function forgetChatState(state: SyncState, chatId: string): void {
  delete state.heads[chatId];
  if (state.entriesSinceCompact) delete state.entriesSinceCompact[chatId];
  if (state.tombstones) delete state.tombstones[chatId];
  if (state.remoteHeads) delete state.remoteHeads[chatId];
}

function isPrefix(prefix: StoredChat["messages"], messages: StoredChat["messages"]): boolean {
  return (
    prefix.length <= messages.length &&
    prefix.every((message, index) => JSON.stringify(message) === JSON.stringify(messages[index]))
  );
}

/** Preserve local snapshots and attachments, but start the next backup from seq 0. */
export async function resetLocalBackupState(): Promise<void> {
  for (const id of await listDirectories("chats")) {
    // Native saves use this lock even while backup is disabled or resetting.
    // Preserve the snapshot and remove its old baseline as one operation.
    await withChatTarget(id, async () => {
      const target = await readJson<StoredChat | LegacyStoredChat>(targetPath(id));
      const history = await readText(historyPath(id));
      const stored =
        target ??
        (await readJson<StoredChat | LegacyStoredChat>(localChatPath(id))) ??
        (history ? replayLog(id, decodeLines(history)).chat : null);
      // The next backup has a different sequence space, so the origin is unknown.
      if (stored) await writeLocalChatSnapshotUnlocked({ ...normalizeStoredChat(stored), baseSeq: -1 }, true);
      await deleteFile(historyPath(id));
    });
  }
  await deleteDirectory(SYNC_DIR);
}

/** Persist a chat as a pending target without a session — used while the
 *  store session is locked or errored, so edits survive the tab. The next
 *  ChatSync hydration picks the target up and flushes it. */
export function stashPendingTarget(chat: Chat): Promise<void> {
  return withBackupStorage(async () => {
    await stashPendingTargetUnlocked(chat);
  });
}

async function stashPendingTargetUnlocked(chat: Chat): Promise<StoredChat> {
  const stored = await extractChatBlobs(chat);
  await writeLocalChatSnapshot(stored, true);
  return stored;
}

/** Keep local deletion usable before backup protection has been configured. */
export function stashPendingDeletion(chatId: string, userId?: string): Promise<void> {
  return withBackupStorage(() => stashPendingDeletionUnlocked(chatId, userId));
}

async function stashPendingDeletionUnlocked(chatId: string, userId?: string): Promise<void> {
  const previous = await loadState();
  const owner =
    userId ??
    previous?.userId ??
    (typeof localStorage === "undefined" ? undefined : localStorage.getItem(WORKSPACE_OWNER_KEY));
  if (!owner || (previous && previous.userId !== owner)) {
    await deleteDirectory(`chats/${chatId}`);
    return;
  }
  // A response from an active upload must finish its local commit before the
  // deletion removes history; otherwise that response can recreate the chat.
  await withPersistenceLock(`chat-sync:${encodeURIComponent(owner)}:${encodeURIComponent(chatId)}`, () =>
    withChatTarget(chatId, async () => {
      const state = (await loadState()) ?? { userId: owner, heads: {} };
      const head =
        (await readChatHistory(chatId))?.checkpoint?.head ?? state.heads[chatId] ?? state.tombstones?.[chatId] ?? 0;
      await journalDeletion(owner, chatId, head);
      forgetChatState(state, chatId);
      await saveChatState(state, chatId);
      await deleteDirectory(`chats/${chatId}`);
      await removeIndexEntry("chats", chatId);
      await completeChatIndexRepair(chatId);
    }),
  );
}

// ChatSync ---------------------------------------------------------------

interface ChatSyncOptions {
  userId: string;
  /** Keystore ID bound into ciphertext. */
  accountId: string;
  dek: RootKey;
  retentionDays?: number;
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
  private flushAgain = false;
  /** A conflict resolution changed chats the UI shows. */
  private viewChanged = false;
  // Attachments are immutable and content-addressed, so one confirmation per
  // session saves a request per attachment on every later save of the chat.
  private backedUpBlobs = new Set<string>();
  private readonly userId: string;
  private readonly accountId: string;
  private readonly retentionDays?: number;
  private readonly dek: RootKey;

  private activity: SyncActivity = { syncing: false, pendingCount: 0, lastSyncAt: null, lastError: null, progress: [] };
  // A successful upload cannot confirm that a failed restore has recovered, or vice versa.
  private errors: Record<SyncProgress["direction"], string | null> = { restore: null, backup: null };
  private progress = new SyncProgressTracker(() => this.setActivity({}));
  private activityListeners = new Set<(a: SyncActivity) => void>();
  private remoteChangeListeners = new Set<(chats: Chat[]) => void>();

  constructor(userId: string, accountId: string, dek: RootKey, initialState?: SyncState, retentionDays?: number) {
    this.userId = userId;
    this.accountId = accountId;
    this.retentionDays = retentionDays;
    this.dek = dek;
    this.state = initialState ?? { userId, heads: {} };
  }

  static async create(opts: ChatSyncOptions): Promise<ChatSync> {
    const state = await loadState();
    if (state && state.userId !== opts.userId) {
      throw new Error(
        "This browser contains another account's local chats. Sign back in to export them before clearing local data.",
      );
    }
    const sync = new ChatSync(opts.userId, opts.accountId, opts.dek, state, opts.retentionDays);
    await sync.hydrateFromOpfs();
    await sync.refreshDeletions();
    sync.setActivity({});
    return sync;
  }

  private headSeq(chatId: string): number {
    return this.state.heads[chatId] ?? this.state.tombstones?.[chatId] ?? 0;
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

  private setActivity(
    patch: Partial<Omit<SyncActivity, "syncing" | "progress">>,
    direction: SyncProgress["direction"] = "backup",
  ): void {
    if (patch.lastError !== undefined) this.errors[direction] = patch.lastError;
    const progress = this.progress.snapshot;
    this.activity = {
      ...this.activity,
      pendingCount: new Set([...this.pendingTargets.keys(), ...this.deletions.keys()]).size,
      ...patch,
      lastError: this.errors.restore ?? this.errors.backup,
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
    if (this.pullInFlight) return this.pullInFlight;
    this.pullInFlight = (async () => {
      const progress = this.progress.begin("restore");
      try {
        return await this.pullInner(progress);
      } catch (err) {
        this.setActivity({ lastError: errorMessage(err) }, "restore");
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
      (meta) =>
        !this.deletions.has(meta.id) &&
        (meta.deleted ? meta.headSeq !== this.state.tombstones?.[meta.id] : meta.headSeq > this.headSeq(meta.id)),
    );
    progress.setTotal(pending.length);

    // Pull in parallel; one broken chat must not hide changes to the others.
    const results = await Promise.allSettled(
      pending.map(async (meta) => {
        if (meta.deleted) await this.applyRemoteDeletion(meta.id, meta.headSeq);
        else await this.applyRemoteEvents(meta.id, meta.headSeq);
        progress.advance();
      }),
    );
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    const failedIds = new Set(
      pending.filter((_, index) => results[index].status === "rejected").map((meta) => meta.id),
    );
    for (const failure of failures) console.warn("chatSync.pull: chat restore failed", failure.reason);

    // Apply remote deletions only to baselines that existed before this listing.
    // A concurrent upload may have created or updated a chat since the request began.
    // The server keeps tombstones, so an unlisted chat is re-uploaded rather than deleted.
    const remoteIds = new Set(remote.map((r) => r.id));
    for (const [id, head] of Object.entries(headsBeforeListing)) {
      if (remoteIds.has(id)) continue;
      await this.withChat(id, async () => {
        if (this.state.heads[id] !== head) return;
        const baseline = this.lastSynced.get(id);
        if (baseline && !this.deletions.has(id)) {
          console.warn(`chatSync.pull: chat ${id} missing from backup; re-uploading local copy`);
          await withChatTarget(id, async () => {
            if (!(await readJson(targetPath(id))))
              await writeLocalChatSnapshotUnlocked({ ...baseline, baseSeq: -1 }, true);
          });
        }
        await this.applyRemoteDeletionLocked(id);
      });
    }

    // Expiration also applies to an old backup restored on a fresh browser.
    const cutoff = chatRetentionCutoff(this.retentionDays);
    if (cutoff) {
      for (const id of new Set([...this.pendingTargets.keys(), ...this.lastSynced.keys()])) {
        if (failedIds.has(id)) continue;
        await this.withChat(id, async () => {
          await this.deleteChatUnlocked(id, cutoff);
        });
      }
    }

    await this.refreshDeletions();
    const out = this.composeChats();

    // Adopting another tab's baseline changes the view even without a download.
    if (before.size !== this.lastSynced.size || [...before].some(([id, chat]) => this.lastSynced.get(id) !== chat)) {
      for (const l of this.remoteChangeListeners) l(out);
    }
    // Healthy chats are applied and published above; report the first broken one.
    if (failures.length > 0) throw failures[0].reason;
    this.setActivity({ lastSyncAt: new Date().toISOString(), lastError: null }, "restore");
    return out;
  }

  /** Visible chat list: pending target if any, else the confirmed baseline. */
  private composeChats(): Chat[] {
    const out: Chat[] = [];
    for (const id of new Set([...this.pendingTargets.keys(), ...this.lastSynced.keys()])) {
      if (this.deletions.has(id)) continue;
      const pending = this.pendingTargets.get(id);
      const confirmed = this.lastSynced.get(id);
      const stored = pending ?? (confirmed && this.withBase(id, confirmed));
      if (stored) out.push(restoreChatManifest(stored));
    }
    return out;
  }

  /** Content projected from the confirmed baseline has seen its current head. */
  private withBase(chatId: string, stored: StoredChat): StoredChat {
    return { ...stored, baseSeq: this.headSeq(chatId) };
  }

  /** Persist a chat as a delta: local mirror first (offline-safe), then
   *  flush. Never waits for network work on the same chat. */
  saveChat(chat: Chat): Promise<void> {
    return withBackupStorage(async () => {
      const stored = await stashPendingTargetUnlocked(chat);
      if (!isBackupSessionCurrent()) return;
      this.pendingTargets.set(chat.id, stored);
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

  private async deleteChatUnlocked(chatId: string, retentionCutoff?: Date): Promise<void> {
    const deleted = await withChatTarget(chatId, async () => {
      // Native saves do not take the network lock. Recheck their durable target
      // under its own lock before expiring a chat inspected earlier in this pull.
      if (retentionCutoff) {
        const target = await readJson<StoredChat | LegacyStoredChat>(targetPath(chatId));
        const versions = [target, this.lastSynced.get(chatId)].filter((stored) => stored != null);
        if (
          !versions.length ||
          versions.some((stored) => !stored.updated || !(new Date(stored.updated) < retentionCutoff)) ||
          isChatBackupPaused(chatId)
        )
          return false;
      }
      await journalDeletion(this.userId, chatId, this.headSeq(chatId));
      this.pendingTargets.delete(chatId);
      this.lastSynced.delete(chatId);
      forgetChatState(this.state, chatId);
      await saveChatState(this.state, chatId);
      this.setActivity({});
      await deleteDirectory(`chats/${chatId}`);
      await removeIndexEntry("chats", chatId);
      await completeChatIndexRepair(chatId);
      return true;
    });
    if (!deleted) return;
    await withPersistenceLock("collection:drafts", () =>
      deleteDirectory(`drafts/${encodeURIComponent(`chat-${chatId}`)}`),
    );
    void this.flushPending();
  }

  /** Replay any journaled deletions and pending targets through the server. */
  flushPending(): Promise<void> {
    return withBackupStorage(async () => {
      if (isBackupSessionCurrent()) await this.flushPendingUnlocked();
    });
  }

  private async flushPendingUnlocked(): Promise<void> {
    if (this.flushing) {
      this.flushAgain = true;
      return;
    }
    this.flushAgain = false;
    this.flushing = true;
    try {
      await this.syncKnownChats();
      // Local saves need no initialized engine; adopt their durable outbox now.
      for (const id of await listDirectories("chats")) {
        await withChatTarget(id, async () => {
          const target = await readJson<StoredChat | LegacyStoredChat>(targetPath(id));
          if (target) this.pendingTargets.set(id, normalizeStoredChat(target));
          else this.pendingTargets.delete(id);
        });
      }
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
        const outcome = await this.pushDelete(del);
        if (outcome) {
          // Keep the chat's workspace files: the next pull restores the chat.
          if (outcome === "cancelled") await keepChatWorkspace(this.userId, del.id, "restore");
          await acknowledgeDeletion(this.userId, del);
          this.deletions.delete(del.id);
          this.pendingTargets.delete(del.id);
          this.lastSynced.delete(del.id);
          progress.advance();
        } else {
          failed = true;
        }
      }

      for (const group of this.groupChatUploads(chats)) {
        const append = group.length > 1 ? createChatAppendBatch() : api.appendEvents;
        const outcomes = await Promise.allSettled(
          group.map(async (chatId) => {
            if (isChatBackupPaused(chatId)) return;
            if (await this.withChat(chatId, () => this.flushChat(chatId, append))) progress.advance();
            else failed = true;
          }),
        );
        // Wait for every local commit before releasing the backup lock.
        const fatal = outcomes.find((outcome) => outcome.status === "rejected");
        if (fatal) throw fatal.reason;
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

    if (this.viewChanged) {
      this.viewChanged = false;
      const chats = this.composeChats();
      for (const l of this.remoteChangeListeners) l(chats);
    }

    // Work that arrived mid-flush was skipped by the re-entrancy guard.
    if (
      this.flushAgain ||
      (!failed &&
        ([...this.pendingTargets.keys()].some((id) => !isChatBackupPaused(id) && !this.deletions.has(id)) ||
          [...this.deletions.values()].some((entry) => !isChatBackupPaused(entry.id))))
    ) {
      void this.flushPending();
    }
  }

  // internals -----------------------------------------------------------

  private busyRetry: ReturnType<typeof setTimeout> | null = null;

  /** Retry sooner than the auto-sync tick once the backend has capacity. */
  private retryWhenNotBusy(delayMs: number): void {
    if (this.busyRetry) return;
    this.busyRetry = setTimeout(() => {
      this.busyRetry = null;
      void this.flushPending().catch((err) => console.warn("chatSync: retry after busy backend failed", err));
    }, delayMs);
  }

  private async refreshDeletions(): Promise<void> {
    this.deletions = new Map((await pendingDeletions(this.userId)).map((entry) => [entry.id, entry]));
    this.setActivity({});
  }

  private async hydrateFromOpfs(): Promise<void> {
    const ids = new Set(await listDirectories("chats"));
    for (const file of await listFiles("chats")) {
      if (file !== "index.json" && file.endsWith(".json")) ids.add(file.slice(0, -5));
    }
    for (const id of ids) {
      await this.withChat(id, () =>
        withChatTarget(id, async () => {
          const target = await readJson<StoredChat | LegacyStoredChat>(targetPath(id));
          if (!(await fileExists(historyPath(id)))) {
            // A pending edit takes precedence over an older local-only record.
            const flat = await readJson<StoredChat | LegacyStoredChat>(`chats/${id}.json`);
            const local = target ?? (await readJson<StoredChat | LegacyStoredChat>(localChatPath(id))) ?? flat;
            if (local) {
              const stored = normalizeStoredChat({ ...local, id });
              this.pendingTargets.set(id, stored);
              await writeLocalChatSnapshotUnlocked(stored, true);
              if (flat) {
                if (!(await fileExists(`chats/${id}/chat.legacy.json`)))
                  await writeJson(`chats/${id}/chat.legacy.json`, flat);
                await deleteFile(`chats/${id}.json`);
              }
            }
            return;
          }
          const chat = this.lastSynced.get(id);
          if (target) {
            const stored = normalizeStoredChat(target);
            this.pendingTargets.set(id, stored);
            await writeLocalChatSnapshotUnlocked(stored, true);
          } else if (!(await fileExists(localChatPath(id))) && chat) {
            await writeLocalChatSnapshotUnlocked(this.withBase(id, chat), false);
          }
        }),
      );
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
      await this.withChat(id, async () => {});
    }
  }

  /** Re-read one chat's baseline and pending target from OPFS. Another tab may
   *  have advanced either since this tab last looked. */
  private async reloadChat(chatId: string): Promise<void> {
    const disk = await loadState();
    const owned = disk?.userId === this.userId;
    const previous = this.lastSynced.get(chatId);
    const history = await readChatHistory(
      chatId,
      previous ? { head: this.state.heads[chatId], chat: previous } : undefined,
    );
    const head = history?.checkpoint?.head ?? (history && owned ? disk.heads[chatId] : undefined);
    const count = history?.checkpoint?.count ?? (history && owned ? disk.entriesSinceCompact?.[chatId] : undefined);
    if (head === undefined) {
      forgetChatState(this.state, chatId);
      const deletedHead = owned ? disk.tombstones?.[chatId] : undefined;
      if (deletedHead !== undefined) (this.state.tombstones ??= {})[chatId] = deletedHead;
    } else {
      this.state.heads[chatId] = head;
      if (this.state.tombstones) delete this.state.tombstones[chatId];
      if (count === undefined) delete this.state.entriesSinceCompact?.[chatId];
      else (this.state.entriesSinceCompact ??= {})[chatId] = count;
      const remote = history?.checkpoint?.remote;
      if (remote === undefined) delete this.state.remoteHeads?.[chatId];
      else (this.state.remoteHeads ??= {})[chatId] = remote;
    }
    if (history?.chat) this.lastSynced.set(chatId, history.chat);
    else this.lastSynced.delete(chatId);
    await withChatTarget(chatId, async () => {
      const target = await readJson<StoredChat | LegacyStoredChat>(targetPath(chatId));
      if (target) this.pendingTargets.set(chatId, normalizeStoredChat(target));
      else {
        this.pendingTargets.delete(chatId);
        if (history?.chat && head !== disk?.heads[chatId]) {
          // Finish projecting a history commit interrupted before its checkpoint cache.
          await writeLocalChatSnapshotUnlocked(this.withBase(chatId, history.chat), false);
        }
      }
    });
    if (head !== disk?.heads[chatId]) await saveChatState(this.state, chatId);
  }

  private async pushDelete(del: PendingDeletion): Promise<"deleted" | "cancelled" | false> {
    try {
      requireChatBackupReady(del.id);
      await api.deleteChat(del.id, del.expectedSeq);
      // Content-addressed blobs can be shared by other chats or devices.
      // Keep them until account reset; deleting without a reference index loses data.
      return "deleted";
    } catch (err) {
      if (err instanceof BackupPausedError) return false;
      // A newer edit wins over this deletion. Drop its journal so the next pull
      // restores the current server copy instead of suppressing it forever.
      if (err instanceof api.ServerError && err.status === 412) return "cancelled";
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
      if (this.backedUpBlobs.has(blobId)) continue;
      requireChatBackupReady(chatId);
      if (await api.headBlob(blobId)) {
        this.backedUpBlobs.add(blobId);
        continue;
      }
      const blob = await getChatBlob(chatId, blobId);
      if (!blob) throw new Error(`Attachment ${blobId} is missing locally and has not been backed up.`);
      const plain = new Uint8Array(await blob.arrayBuffer());
      const cipher = await encryptBlob(this.dek, plain, this.accountId, blobId);
      requireChatBackupReady(chatId);
      await api.putBlob(blobId, cipher);
      this.backedUpBlobs.add(blobId);
    }
  }

  private *groupChatUploads(ids: string[]): Iterable<string[]> {
    let group: string[] = [];
    for (const id of ids) {
      const target = this.pendingTargets.get(id);
      // Attachment uploads can hold a large plaintext and ciphertext in memory.
      if (target && collectChatBlobIds(target).length > 0) {
        if (group.length) yield group;
        yield [id];
        group = [];
        continue;
      }
      group.push(id);
      if (group.length === CHAT_APPEND_BATCH_SIZE) {
        yield group;
        group = [];
      }
    }
    if (group.length) yield group;
  }

  /** Compute the delta for one chat and post it (caller holds the chat lock).
   *  Returns true on success (or no-op), false on network/persistent conflict. */
  private async flushChat(chatId: string, append = api.appendEvents): Promise<boolean> {
    const target = this.pendingTargets.get(chatId);
    if (!target) return true;

    let entries: LogEntry[];
    try {
      entries = await this.resolveEntries(chatId);
    } catch (err) {
      this.setActivity({ lastError: errorMessage(err) });
      console.warn(`chatSync.flushChat(${chatId}): conflict resolution failed`, err);
      return false;
    }
    if (!this.pendingTargets.has(chatId)) return true; // the newer backup was adopted
    if (entries.length === 0) {
      await this.clearPendingTarget(chatId, target);
      return true;
    }

    try {
      // Attachments must exist on the server before the entries that
      // reference them.
      await this.uploadMissingBlobs(chatId, target);
      if (isChatBackupPaused(chatId)) return false;
      await this.postEntries(chatId, entries, false, append);
    } catch (err) {
      if (err instanceof BackupPausedError) return false;
      if (err instanceof BackupBusyError) {
        this.retryWhenNotBusy(err.retryAfterMs);
        return false;
      }
      this.setActivity({ lastError: errorMessage(err) });
      console.warn(`chatSync.flushChat(${chatId}): post failed`, err);
      return false;
    }

    await this.clearPendingTarget(chatId, target);
    await this.maybeCompact(chatId);
    return true;
  }

  private remoteCheckpoint(chatId: string): { remote?: number } {
    const remote = this.state.remoteHeads?.[chatId];
    return remote === undefined ? {} : { remote };
  }

  /**
   * Entries that move the server to the pending target without losing work.
   * A target whose base predates another device's events may lack those
   * messages: a plain diff would truncate them. Instead an older copy adopts
   * the backup, an extension of it uploads normally, and a divergent edit keeps
   * this chat while the backup's version is saved as a conflicted copy.
   */
  private async resolveEntries(chatId: string): Promise<LogEntry[]> {
    const target = this.pendingTargets.get(chatId);
    if (!target) return [];
    const baseline = this.lastSynced.get(chatId) ?? null;
    const base = target.baseSeq ?? 0;
    if (!baseline || base >= (this.state.remoteHeads?.[chatId] ?? 0)) return diffChat(baseline, target);
    if (!isPrefix(baseline.messages, target.messages)) {
      if (isPrefix(target.messages, baseline.messages)) {
        await this.adoptBaseline(chatId, target, baseline);
        return [];
      }
      await this.forkConflict(chatId, baseline);
    }
    await this.rebase(chatId, base);
    return diffChat(baseline, target);
  }

  /** The target now incorporates every remote event; edits derived from its base are current. */
  private async rebase(chatId: string, base: number): Promise<void> {
    (this.state.remoteHeads ??= {})[chatId] = base;
    const head = this.state.heads[chatId];
    if (head === undefined) return;
    const count = this.state.entriesSinceCompact?.[chatId] ?? 0;
    await appendBlob(historyPath(chatId), new Blob([enc.encode(encodeHistory([], { head, count, remote: base }))]));
  }

  /** Replace an older local copy with the newer backup instead of truncating it. */
  private async adoptBaseline(chatId: string, target: StoredChat, baseline: StoredChat): Promise<void> {
    await withChatTarget(chatId, async () => {
      const current = await readJson<StoredChat | LegacyStoredChat>(targetPath(chatId));
      if (current && JSON.stringify(current) !== JSON.stringify(target)) {
        this.pendingTargets.set(chatId, normalizeStoredChat(current));
        return;
      }
      await writeLocalChatSnapshotUnlocked(this.withBase(chatId, baseline), false);
      await deleteFile(targetPath(chatId));
      this.pendingTargets.delete(chatId);
      this.viewChanged = true;
    });
    this.setActivity({});
  }

  /**
   * Preserve the backup's divergent version, with its attachments, as a new
   * chat. It is backed up before this chat replaces it on the server. The ID
   * derives from the replaced head, so a retry reuses the same copy.
   */
  private async forkConflict(chatId: string, baseline: StoredChat): Promise<void> {
    const digest = await crypto.subtle.digest("SHA-256", enc.encode(`${chatId}:${this.headSeq(chatId)}`));
    const id = `conflict-${Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("")}`;
    const { baseSeq: _base, resume: _resume, customIndex: _index, ...rest } = baseline;
    const name = baseline.customTitle || baseline.title || "Untitled chat";
    const copy: StoredChat = { ...rest, id, customTitle: `${name} (conflicted copy)` };
    // A retry must not overwrite edits already made to the copy.
    if (!(await fileExists(localChatPath(id)))) {
      for (const blobId of collectChatBlobIds(baseline)) {
        const blob = await getChatBlob(chatId, blobId);
        if (blob) await writeBlob(`chats/${id}/blobs/${blobId}.bin`, blob);
        else await this.downloadBlob(id, blobId);
      }
      await writeLocalChatSnapshot(copy, true);
    }
    this.viewChanged = true;
    if (!(await this.withChat(id, () => this.flushChat(id)))) {
      throw new Error("Couldn't back up the conflicted copy; the chat will retry.");
    }
  }

  /** Drop the pending target — unless a newer save replaced it while the
   *  flush was in flight (in this or another tab), in which case it must flush again. */
  private async clearPendingTarget(chatId: string, flushed: StoredChat): Promise<void> {
    await withChatTarget(chatId, async () => {
      const current = await readJson<StoredChat | LegacyStoredChat>(targetPath(chatId));
      if (!current) {
        this.pendingTargets.delete(chatId);
      } else if (JSON.stringify(current) === JSON.stringify(flushed)) {
        // A prior save may have committed the outbox but failed its native
        // projection. Keep the outbox until that snapshot is durable too.
        await writeLocalChatSnapshotUnlocked(normalizeStoredChat(current), false);
        await deleteFile(targetPath(chatId));
        this.pendingTargets.delete(chatId);
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
   *  Snapshots must fit one request so their init cannot publish a partial chat.
   *  Returns the first posted seq, or null when nothing (more) was posted. */
  private async postEntries(
    chatId: string,
    entries: LogEntry[],
    snapshot = false,
    append = api.appendEvents,
  ): Promise<number | null> {
    let firstSeq: number | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      // One frame per chunk. A first-sync snapshot of a long chat easily
      // exceeds the server's per-frame cap as a single frame.
      const chunks = chunkEntries(entries);
      const frames: { id: string; frame: string; entries: LogEntry[] }[] = [];
      let seq = this.headSeq(chatId);
      for (const chunk of chunks) {
        seq += 1;
        const payload = { id: crypto.randomUUID(), ts: new Date().toISOString(), body: chunk };
        const frame = await encryptEvent(this.dek, payload, this.accountId, chatId, seq);
        frames.push({ id: payload.id, frame, entries: chunk });
      }

      const batches = appendBatches(frames);
      if (snapshot && batches.length > 1) return null;

      let conflict = false;
      for (const batch of batches) {
        const expectedSeq = this.headSeq(chatId);
        requireChatBackupReady(chatId);
        const post = attempt === 0 && batches.length === 1 ? append : api.appendEvents;
        const res = await post(
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
        );
      }
      if (!conflict) return firstSeq;
      if (snapshot) return null;

      requireChatBackupReady(chatId);
      // We already hold this chat's lock. A deleted log has no events to read;
      // adopt its tombstone cursor before encrypting a fresh init snapshot.
      const remote = (await api.listChats()).find((meta) => meta.id === chatId);
      if (remote?.deleted) await this.applyRemoteDeletionLocked(chatId, remote.headSeq);
      else await this.applyRemoteEventsLocked(chatId, this.headSeq(chatId));
      entries = await this.resolveEntries(chatId);
      if (entries.length === 0) return firstSeq;
    }
    throw new PostConflictAfterRetry();
  }

  /** Apply entries the server accepted to the local log, baseline and head. */
  private async commitPosted(chatId: string, entries: LogEntry[], head: number): Promise<void> {
    const count = entries[0]?.type === "init" ? 1 : (this.state.entriesSinceCompact?.[chatId] ?? 0) + entries.length;
    await appendBlob(
      historyPath(chatId),
      new Blob([enc.encode(encodeHistory(entries, { head, count, ...this.remoteCheckpoint(chatId) }))]),
    );
    const merged = applyEntries(this.lastSynced.get(chatId) ?? null, entries, chatId);
    if (merged) this.lastSynced.set(chatId, merged);
    else this.lastSynced.delete(chatId);

    this.state.heads[chatId] = head;
    if (this.state.tombstones) delete this.state.tombstones[chatId];
    (this.state.entriesSinceCompact ??= {})[chatId] = count;
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
    const checkpoint = {
      head: this.state.heads[chatId],
      count: this.state.entriesSinceCompact?.[chatId] ?? 1,
      ...this.remoteCheckpoint(chatId),
    };
    await writeBlob(historyPath(chatId), new Blob([enc.encode(encodeHistory(entries, checkpoint))]));
  }

  /** Adopt a deletion cursor while preserving unsynced work and its attachments. */
  private applyRemoteDeletion(chatId: string, head: number): Promise<void> {
    return this.withChat(chatId, () => this.applyRemoteDeletionLocked(chatId, head));
  }

  private async applyRemoteDeletionLocked(chatId: string, head?: number): Promise<void> {
    // An upload or another tab may have advanced the log after this listing.
    if (head !== undefined && this.headSeq(chatId) >= head) return;
    await withDeletionLock(this.userId, chatId, async () => {
      if (await readJson(deletePath(this.userId, chatId))) return;
      await withChatTarget(chatId, async () => {
        const target = await readJson<StoredChat | LegacyStoredChat>(targetPath(chatId));
        if (target) {
          // The pending edit recreates the chat; its workspace files go with it.
          await writeJson(keepPath(this.userId, chatId), keepMarker(chatId, "reupload"));
          this.pendingTargets.set(chatId, normalizeStoredChat(target));
          await deleteFile(historyPath(chatId));
        } else {
          // The chat is gone everywhere; an earlier marker must not revive its files.
          await deleteFile(keepPath(this.userId, chatId));
          await deleteDirectory(`chats/${chatId}`);
          await removeIndexEntry("chats", chatId);
          await completeChatIndexRepair(chatId);
          this.pendingTargets.delete(chatId);
        }
        this.lastSynced.delete(chatId);
        forgetChatState(this.state, chatId);
        if (head !== undefined) (this.state.tombstones ??= {})[chatId] = head;
        await saveChatState(this.state, chatId);
      });
    });
  }

  /** Pull events up to expectedHead and apply them. Returns whether anything changed. */
  private applyRemoteEvents(chatId: string, expectedHead: number): Promise<boolean> {
    return this.withChat(chatId, async () => {
      const head = this.headSeq(chatId);
      // Another tab may already have pulled this range.
      if (head >= expectedHead) return false;
      return this.applyRemoteEventsLocked(chatId, head, expectedHead);
    });
  }

  /** Apply events after fromSeq to local state (history file + in-memory
   *  baseline + head). The caller holds this chat's lock. */
  private async applyRemoteEventsLocked(chatId: string, fromSeq: number, expectedHead = fromSeq): Promise<boolean> {
    const applied = await withDeletionLock(this.userId, chatId, async () => {
      // A journaled deletion beats the server copy — don't resurrect it.
      if (await readJson(deletePath(this.userId, chatId))) return false;
      // Another tab may already have applied part of the range.
      fromSeq = Math.max(fromSeq, this.headSeq(chatId));

      const events = await api.readEvents(chatId, fromSeq);
      if (events.length === 0) {
        if (fromSeq < expectedHead)
          throw new Error(`Incomplete backup for ${chatId}: expected sequence ${expectedHead}.`);
        return false;
      }

      let head = this.headSeq(chatId);
      let baseline = this.lastSynced.get(chatId) ?? null;

      const appendedText: string[] = [];
      let logWasReset = false;
      let entryCount = this.state.entriesSinceCompact?.[chatId] ?? 0;

      for (const e of events) {
        if (e.seq <= head) continue; // already applied

        type RemotePayload = { id: string; ts: string; body: LogEntry[] };
        let payload: RemotePayload;
        try {
          payload = await decryptEvent<RemotePayload>(this.dek, e.frame, this.accountId, chatId, e.seq);
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

        if (isReset) {
          // Compaction snapshot — discard prior state and replay fresh.
          baseline = null;
          appendedText.length = 0;
          logWasReset = true;
        }
        baseline = applyEntries(baseline, entries, chatId);
        appendedText.push(encodeLines(entries));
        entryCount = isReset ? 1 : entryCount + entries.length;
        head = e.seq;
      }

      if (head < expectedHead)
        throw new Error(`Incomplete backup for ${chatId}: expected sequence ${expectedHead}, received ${head}.`);
      if (appendedText.length === 0) return false;

      // Confirm attachments before committing history/head so a failed download
      // retries on the next pull, even if no new events have arrived.
      if (baseline) await this.downloadMissingBlobs(chatId, baseline);
      // Pending edits made before these events no longer describe the latest chat.
      const checkpoint = encodeHistory([], { head, count: entryCount, remote: head });
      const text = new Blob([enc.encode(appendedText.join("") + checkpoint)]);
      if (logWasReset) await writeBlob(historyPath(chatId), text);
      else await appendBlob(historyPath(chatId), text);

      (this.state.entriesSinceCompact ??= {})[chatId] = entryCount;
      (this.state.remoteHeads ??= {})[chatId] = head;
      if (baseline) this.lastSynced.set(chatId, baseline);
      else this.lastSynced.delete(chatId);
      this.state.heads[chatId] = head;
      if (this.state.tombstones) delete this.state.tombstones[chatId];
      await withChatTarget(chatId, async () => {
        if (baseline && !(await readJson(targetPath(chatId)))) {
          await writeLocalChatSnapshotUnlocked({ ...baseline, baseSeq: head }, false);
        }
      });
      return true;
    });
    if (applied) await saveChatState(this.state, chatId);
    return applied;
  }

  private async downloadMissingBlobs(chatId: string, stored: StoredChat): Promise<void> {
    for (const blobId of collectChatBlobIds(stored)) {
      if (await getChatBlob(chatId, blobId)) continue;
      if (!(await this.downloadBlob(chatId, blobId))) {
        throw new Error(`Attachment ${blobId} is missing from backup ${chatId}.`);
      }
    }
  }

  private async downloadBlob(chatId: string, blobId: string): Promise<boolean> {
    const cipher = await api.getBlob(blobId);
    if (!cipher) return false;
    const plain = await decryptBlob(this.dek, cipher, this.accountId, blobId);
    await writeBlob(`chats/${chatId}/blobs/${blobId}.bin`, new Blob([new Uint8Array(plain)]));
    return true;
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
