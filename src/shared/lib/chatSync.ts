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

import type { Chat } from "@/shared/types/chat";
import {
  applyEntriesInPlace,
  chunkEntries,
  decodeLines,
  diffChat,
  encodeLines,
  type LogEntry,
  MAX_ENTRY_PLAINTEXT,
  replayLog,
} from "./chatLog";
import * as api from "./storeClient";
import { type DEK, decryptBlob, decryptEvent, encryptBlob, encryptEvent, hashFrame, ZERO_HASH } from "./crypto";
import { collectChatBlobIds, extractChatBlobs, getChatBlob, rehydrateChatBlobs, type StoredChat } from "./opfs-chat";
import {
  appendBlob,
  deleteDirectory,
  deleteFile,
  fileExists,
  listDirectories,
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
  /** Deletions journaled until the server confirms them. */
  pendingDeletes?: { id: string; blobIds: string[] }[];
}

/** Threshold of entries that triggers an automatic compaction. Keeps fresh
 *  devices' first pull bounded; the snapshot is paid for once per N saves. */
const COMPACT_THRESHOLD = 50;

async function loadState(): Promise<SyncState | undefined> {
  return readJson<SyncState>(STATE_FILE);
}

async function saveState(state: SyncState): Promise<void> {
  await writeJson(STATE_FILE, state);
}

// Per-chat paths in OPFS
const historyPath = (chatId: string) => `chats/${chatId}/history.jsonl`;
const targetPath = (chatId: string) => `chats/${chatId}/target.json`;
/** OPFS-only mode stores chats here; promoted to pending targets when
 *  the server store is enabled on a deployment that has local data. */
const opfsOnlyChatPath = (chatId: string) => `chats/${chatId}/chat.json`;

/** Read the local mirror without a DEK — logs and pending targets are
 *  plaintext locally; the PIN only protects the server copies. Lets the
 *  UI show chats while the session is still locked. */
export async function readLocalMirror(): Promise<Chat[]> {
  const out: Chat[] = [];
  for (const id of await listDirectories("chats")) {
    let stored = await readJson<StoredChat>(targetPath(id));
    if (!stored) {
      const text = await readText(historyPath(id));
      if (text) stored = replayLog(id, decodeLines(text)).chat ?? undefined;
    }
    if (!stored) stored = await readJson<StoredChat>(opfsOnlyChatPath(id));
    if (stored) out.push(await rehydrateChatBlobs(stored));
  }
  return out;
}

/** Persist a chat as a pending target without a session — used while the
 *  store session is locked or errored, so edits survive the tab. The next
 *  ChatSync hydration picks the target up and flushes it. */
export async function stashPendingTarget(chat: Chat): Promise<void> {
  const stored = await extractChatBlobs(chat);
  await writeJson(targetPath(chat.id), stored);
}

// ChatSync ---------------------------------------------------------------

export interface ChatSyncOptions {
  userId: string;
  dek: DEK;
}

export interface SyncActivity {
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
  private flushing = false;
  private readonly userId: string;
  private readonly dek: DEK;

  private activity: SyncActivity = { syncing: false, pendingCount: 0, lastSyncAt: null, lastError: null };
  private activityListeners = new Set<(a: SyncActivity) => void>();
  private remoteChangeListeners = new Set<(chats: Chat[]) => void>();

  constructor(userId: string, dek: DEK, initialState?: SyncState) {
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
    return sync;
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

  private setActivity(patch: Partial<SyncActivity>): void {
    this.activity = { ...this.activity, pendingCount: this.pendingTargets.size, ...patch };
    for (const l of this.activityListeners) l(this.activity);
  }

  private pullInFlight: Promise<Chat[]> | null = null;

  /** Pull remote changes for every chat into the local mirror; return
   *  the materialized chat list (lastSynced wins over pending targets
   *  only for chats with no pending edits). Concurrent calls share one
   *  in-flight pull — interleaved pulls would double-apply events. */
  async pull(): Promise<Chat[]> {
    if (this.pullInFlight) return this.pullInFlight;
    this.pullInFlight = (async () => {
      this.setActivity({ syncing: true });
      try {
        return await this.pullInner();
      } catch (err) {
        this.setActivity({ syncing: false, lastError: err instanceof Error ? err.message : String(err) });
        throw err;
      } finally {
        this.pullInFlight = null;
      }
    })();
    return this.pullInFlight;
  }

  private async pullInner(): Promise<Chat[]> {
    const remote = await api.listChats();
    let changed = false;

    // Pull events in parallel — server reads are cheap and serial waits
    // dominate when there are many chats.
    await Promise.all(
      remote.map(async (meta) => {
        // A journaled deletion beats the server copy — don't resurrect it.
        if (this.state.pendingDeletes?.some((d) => d.id === meta.id)) return;
        const localHead = this.state.heads[meta.id] ?? 0;
        if (meta.headSeq > localHead) {
          await this.applyRemoteEvents(meta.id, localHead);
          changed = true;
        }
      }),
    );

    // Drop chats deleted server-side.
    const remoteIds = new Set(remote.map((r) => r.id));
    const localDirs = await listDirectories("chats");
    for (const id of localDirs) {
      if (!remoteIds.has(id) && this.state.heads[id] !== undefined) {
        await deleteDirectory(`chats/${id}`);
        this.lastSynced.delete(id);
        this.pendingTargets.delete(id);
        delete this.state.heads[id];
        delete this.state.lastFrameHash[id];
        changed = true;
      }
    }

    await saveState(this.state);

    // Compose the visible chat list: pending target if any, else lastSynced.
    const out: Chat[] = [];
    const seen = new Set<string>();
    for (const id of this.pendingTargets.keys()) {
      seen.add(id);
      const stored = this.pendingTargets.get(id);
      if (stored) out.push(await rehydrateChatBlobs(stored));
    }
    for (const [id, stored] of this.lastSynced) {
      if (seen.has(id)) continue;
      out.push(await rehydrateChatBlobs(stored));
    }

    this.setActivity({ syncing: false, lastSyncAt: new Date().toISOString(), lastError: null });
    if (changed) {
      for (const l of this.remoteChangeListeners) l(out);
    }
    return out;
  }

  /** Persist a chat as a delta: local mirror first (offline-safe), then
   *  flush. Idempotent on retry. */
  async saveChat(chat: Chat): Promise<void> {
    const stored = await extractChatBlobs(chat);
    this.pendingTargets.set(chat.id, stored);
    this.setActivity({});
    await writeJson(targetPath(chat.id), stored);
    void this.flushPending();
  }

  /** Delete a chat: drop local state immediately, journal the server-side
   *  deletion so it retries until confirmed. Other devices learn of the
   *  deletion from the chat listing. */
  async deleteChat(chatId: string): Promise<void> {
    // Blob ids are unique per attachment (never shared across chats), so
    // the server copies can go with the chat. Collect before dropping state.
    const blobIds = new Set<string>();
    for (const stored of [this.pendingTargets.get(chatId), this.lastSynced.get(chatId)]) {
      if (stored) for (const id of collectChatBlobIds(stored)) blobIds.add(id);
    }

    this.state.pendingDeletes = [
      ...(this.state.pendingDeletes ?? []).filter((d) => d.id !== chatId),
      { id: chatId, blobIds: [...blobIds] },
    ];
    this.pendingTargets.delete(chatId);
    this.lastSynced.delete(chatId);
    delete this.state.heads[chatId];
    delete this.state.lastFrameHash[chatId];
    await saveState(this.state);
    this.setActivity({});

    await deleteDirectory(`chats/${chatId}`);
    void this.flushPending();
  }

  /** Replay any journaled deletions and pending targets through the server. */
  async flushPending(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    this.setActivity({ syncing: true });
    let failed = false;
    try {
      // snapshot: successful deletes rewrite state.pendingDeletes mid-loop
      for (const del of Array.from(this.state.pendingDeletes ?? [])) {
        if (await this.pushDelete(del)) {
          this.state.pendingDeletes = (this.state.pendingDeletes ?? []).filter((d) => d.id !== del.id);
          await saveState(this.state);
        } else {
          failed = true;
        }
      }

      // snapshot: flushChat mutates pendingTargets while we iterate.
      // Keep going past failures — one poisoned chat must not block the rest.
      for (const chatId of Array.from(this.pendingTargets.keys())) {
        if (!(await this.flushChat(chatId))) failed = true;
      }
    } finally {
      this.flushing = false;
      this.setActivity(
        failed ? { syncing: false } : { syncing: false, lastSyncAt: new Date().toISOString(), lastError: null },
      );
    }

    // Work that arrived mid-flush was skipped by the re-entrancy guard.
    if (!failed && (this.pendingTargets.size > 0 || (this.state.pendingDeletes?.length ?? 0) > 0)) {
      void this.flushPending();
    }
  }

  // internals -----------------------------------------------------------

  private async hydrateFromOpfs(): Promise<void> {
    const ids = await listDirectories("chats");
    for (const id of ids) {
      // Promote chats written by OPFS-only mode (chat.json) to pending
      // targets: they exist only locally, so the next flush uploads them.
      if (!(await fileExists(historyPath(id)))) {
        const local = await readJson<StoredChat>(opfsOnlyChatPath(id));
        if (local) {
          this.pendingTargets.set(id, local);
          await writeJson(targetPath(id), local);
          await deleteFile(opfsOnlyChatPath(id));
          continue;
        }
      }

      // Replay history → lastSynced.
      const text = await readText(historyPath(id));
      if (text) {
        const entries = decodeLines(text);
        const { chat } = replayLog(id, entries);
        if (chat) this.lastSynced.set(id, chat);
      } else if (this.state.heads[id] !== undefined) {
        // The head claims we're synced but the local history is gone
        // (cleared cache, lost file) — forget it so pull refetches from 0.
        delete this.state.heads[id];
        delete this.state.lastFrameHash[id];
      }

      // Restore any pending target.
      const target = await readJson<StoredChat>(targetPath(id));
      if (target) this.pendingTargets.set(id, target);
    }
  }

  private async pushDelete(del: { id: string; blobIds: string[] }): Promise<boolean> {
    try {
      await api.deleteChat(del.id);
      for (const blobId of del.blobIds) {
        await api.deleteBlob(blobId);
      }
      return true;
    } catch (err) {
      this.setActivity({ lastError: err instanceof Error ? err.message : String(err) });
      console.warn(`chatSync: server delete failed for ${del.id}`, err);
      return false;
    }
  }

  /** Serialize sync operations per chat — a pull-apply interleaving with
   *  a flush post on the same history corrupts the local replay. */
  private chatOps = new Map<string, Promise<unknown>>();

  private withChat<T>(chatId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chatOps.get(chatId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.chatOps.set(
      chatId,
      run.catch(() => {}),
    );
    return run;
  }

  private async uploadMissingBlobs(chatId: string, stored: StoredChat): Promise<void> {
    for (const blobId of collectChatBlobIds(stored)) {
      if (await api.headBlob(blobId)) continue;
      const blob = await getChatBlob(chatId, blobId);
      if (!blob) continue;
      const plain = new Uint8Array(await blob.arrayBuffer());
      const cipher = await encryptBlob(this.dek, plain, this.userId, blobId);
      await api.putBlob(blobId, cipher);
    }
  }

  /** Compute the delta for one chat and post it. Returns true on
   *  success (or no-op), false on network/persistent conflict. */
  private flushChat(chatId: string): Promise<boolean> {
    return this.withChat(chatId, () => this.flushChatInner(chatId));
  }

  private async flushChatInner(chatId: string): Promise<boolean> {
    const target = this.pendingTargets.get(chatId);
    if (!target) return true;

    const baseline = this.lastSynced.get(chatId) ?? null;
    const entries = diffChat(baseline, target);

    if (entries.length === 0) {
      await this.clearPendingTarget(chatId, target);
      return true;
    }

    try {
      // Attachments must exist on the server before the entries that
      // reference them.
      await this.uploadMissingBlobs(chatId, target);
      await this.postEntries(chatId, entries);
    } catch (err) {
      this.setActivity({ lastError: err instanceof Error ? err.message : String(err) });
      if (err instanceof PostConflictAfterRetry) return false;
      console.warn(`chatSync.flushChat(${chatId}): post failed`, err);
      return false;
    }

    await this.clearPendingTarget(chatId, target);
    void this.maybeCompact(chatId);
    return true;
  }

  /** Drop the pending target — unless a newer save replaced it while the
   *  flush was in flight, in which case it must flush again. */
  private async clearPendingTarget(chatId: string, flushed: StoredChat): Promise<void> {
    if (this.pendingTargets.get(chatId) !== flushed) return;
    this.pendingTargets.delete(chatId);
    await deleteFile(targetPath(chatId));
  }

  /** Encrypt + post one batch of entries. Handles 409 by pulling and
   *  re-diffing once. Throws PostConflictAfterRetry if the second
   *  attempt still conflicts (caller leaves the target in place).
   *  Returns the posted seq range, or null when the retry re-diff came
   *  up empty. */
  private async postEntries(chatId: string, entries: LogEntry[]): Promise<{ firstSeq: number; newSeq: number } | null> {
    // A single entry that cannot fit one frame can never be posted — fail
    // fast with a readable error instead of hammering the server with 413s.
    for (const e of entries) {
      if (JSON.stringify(e).length > MAX_ENTRY_PLAINTEXT) {
        throw new Error("a message is too large to sync (limit ~11 MB) — it stays on this device only");
      }
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const expectedSeq = this.state.heads[chatId] ?? 0;
      let prevHash = this.state.lastFrameHash[chatId] ?? ZERO_HASH;

      // One frame per chunk, hash-chained in order. A first-sync snapshot
      // of a long chat easily exceeds the server's per-frame cap as a
      // single frame.
      const events: { id: string; frame: string }[] = [];
      let seq = expectedSeq;
      for (const chunk of chunkEntries(entries)) {
        seq += 1;
        const payload = { id: crypto.randomUUID(), ts: new Date().toISOString(), prevHash, body: chunk };
        const frame = await encryptEvent(this.dek, payload, this.userId, chatId, seq);
        events.push({ id: payload.id, frame });
        prevHash = await hashFrame(frame);
      }

      const res = await api.appendEvents(chatId, expectedSeq, events);

      if (res === null) {
        // 409 — pull, then retry once with a freshly re-diff'd payload
        // computed against the new baseline. Inner variant: we already
        // hold this chat's lock.
        await this.applyRemoteEventsInner(chatId, expectedSeq);
        const newTarget = this.pendingTargets.get(chatId);
        if (!newTarget) return null; // somehow no longer pending
        const newBaseline = this.lastSynced.get(chatId) ?? null;
        entries = diffChat(newBaseline, newTarget);
        if (entries.length === 0) return null;
        continue;
      }

      // Accepted — apply the entries to local state.
      await appendBlob(historyPath(chatId), new Blob([enc.encode(encodeLines(entries))]));
      const merged = applyEntriesInPlace(this.lastSynced.get(chatId) ?? null, entries, chatId);
      if (merged) this.lastSynced.set(chatId, merged);
      else this.lastSynced.delete(chatId);

      this.state.heads[chatId] = res.newSeq;
      this.state.lastFrameHash[chatId] = prevHash;
      this.bumpEntryCount(chatId, entries[0]?.type === "init" ? -Infinity : entries.length);
      await saveState(this.state);
      return { firstSeq: expectedSeq + 1, newSeq: res.newSeq };
    }
    throw new PostConflictAfterRetry();
  }

  private bumpEntryCount(chatId: string, delta: number): void {
    if (!this.state.entriesSinceCompact) this.state.entriesSinceCompact = {};
    if (delta === -Infinity) {
      // After a compaction event the count resets — the post itself
      // counts as 1 surviving entry.
      this.state.entriesSinceCompact[chatId] = 1;
      return;
    }
    const cur = this.state.entriesSinceCompact[chatId] ?? 0;
    this.state.entriesSinceCompact[chatId] = cur + delta;
  }

  /** If the log has grown past the threshold, replace it with a single
   *  init-led snapshot and ask the server to drop the prefix. */
  private maybeCompact(chatId: string): Promise<void> {
    return this.withChat(chatId, () => this.maybeCompactInner(chatId));
  }

  private async maybeCompactInner(chatId: string): Promise<void> {
    const count = this.state.entriesSinceCompact?.[chatId] ?? 0;
    if (count < COMPACT_THRESHOLD) return;

    const target = this.lastSynced.get(chatId);
    if (!target) return;
    // Don't compact while there's a pending edit — the next flush handles it.
    if (this.pendingTargets.has(chatId)) return;

    const entries = diffChat(null, target); // forces init + meta + messages
    if (entries.length === 0) return;

    let posted: { firstSeq: number; newSeq: number } | null;
    try {
      posted = await this.postEntries(chatId, entries);
    } catch (err) {
      console.warn(`chatSync.maybeCompact(${chatId}): post failed`, err);
      return;
    }
    if (!posted) return;

    // Keep the whole snapshot: it may span several frames, and the first
    // one carries the init entry fresh readers replay from.
    const compactBefore = posted.firstSeq;
    if (compactBefore < 2) return; // nothing to drop

    try {
      await api.compactChat(chatId, compactBefore);
    } catch (err) {
      console.warn(`chatSync.maybeCompact(${chatId}): server compact failed`, err);
      return;
    }

    // Replace the local log with just the surviving snapshot entry.
    await writeBlob(historyPath(chatId), new Blob([enc.encode(encodeLines(entries))]));
  }

  /** Pull events from the server starting after fromSeq and apply them
   *  to local state (history file + in-memory baseline + head + hash).
   *  Serialized per chat; postEntries' 409 recovery runs inside its own
   *  chat lock and uses the inner variant directly. */
  private applyRemoteEvents(chatId: string, fromSeq: number): Promise<void> {
    return this.withChat(chatId, () => this.applyRemoteEventsInner(chatId, fromSeq));
  }

  private async applyRemoteEventsInner(chatId: string, fromSeq: number): Promise<void> {
    // The caller's fromSeq may predate ops that ran while we waited for
    // the chat lock — never refetch what's already applied.
    fromSeq = Math.max(fromSeq, this.state.heads[chatId] ?? 0);

    const events = await api.readEvents(chatId, fromSeq);
    if (events.length === 0) return;

    let head = this.state.heads[chatId] ?? 0;
    let lastHash = this.state.lastFrameHash[chatId] ?? ZERO_HASH;
    let baseline = this.lastSynced.get(chatId) ?? null;

    const appendedText: string[] = [];
    let logWasReset = false;

    for (const e of events) {
      if (e.seq <= head) continue; // already applied

      type RemotePayload = { id: string; ts: string; prevHash: string; body: LogEntry[] };
      let payload: RemotePayload;
      try {
        payload = await decryptEvent<RemotePayload>(this.dek, e.frame, this.userId, chatId, e.seq);
      } catch (err) {
        console.error(`chatSync: failed to decrypt ${chatId}@${e.seq}`, err);
        return;
      }

      const entries = payload.body;
      const isReset = entries[0]?.type === "init";

      // A gap is expected right after another device compacted the chat
      // (the server dropped the log prefix) — but only an init snapshot
      // may bridge it, since it replays from scratch.
      if (e.seq !== head + 1 && !isReset) {
        console.warn(`chatSync: gap in ${chatId} log at seq ${e.seq} (expected ${head + 1})`);
        break;
      }

      if (!isReset && payload.prevHash !== lastHash) {
        console.error(`chatSync: hash chain mismatch for ${chatId}@${e.seq} — possible tampering`);
        return;
      }

      if (isReset) {
        // Compaction snapshot — discard prior state and replay fresh.
        baseline = null;
        appendedText.length = 0;
        logWasReset = true;
      }
      baseline = applyEntriesInPlace(baseline, entries, chatId);
      appendedText.push(encodeLines(entries));
      this.bumpEntryCount(chatId, isReset ? -Infinity : entries.length);

      lastHash = await hashFrame(e.frame);
      head = e.seq;
    }

    if (appendedText.length > 0) {
      const text = new Blob([enc.encode(appendedText.join(""))]);
      if (logWasReset) await writeBlob(historyPath(chatId), text);
      else await appendBlob(historyPath(chatId), text);

      // Download any newly referenced blobs that we don't have locally.
      if (baseline) {
        await this.downloadMissingBlobs(chatId, baseline);
      }
    }

    if (baseline) this.lastSynced.set(chatId, baseline);
    else this.lastSynced.delete(chatId);

    this.state.heads[chatId] = head;
    this.state.lastFrameHash[chatId] = lastHash;
    await saveState(this.state);
  }

  private async downloadMissingBlobs(chatId: string, stored: StoredChat): Promise<void> {
    const blobIds = collectChatBlobIds(stored);
    for (const blobId of blobIds) {
      const local = await getChatBlob(chatId, blobId);
      if (local) continue;
      const cipher = await api.getBlob(blobId);
      if (!cipher) {
        console.warn(`chatSync: blob ${blobId} referenced by ${chatId} not found on server`);
        continue;
      }
      try {
        const plain = await decryptBlob(this.dek, cipher, this.userId, blobId);
        await writeBlob(`chats/${chatId}/blobs/${blobId}.bin`, new Blob([new Uint8Array(plain)]));
      } catch (err) {
        console.error(`chatSync: failed to decrypt blob ${blobId}`, err);
      }
    }
  }
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
    await deleteDirectory(SYNC_DIR);
  } catch {
    /* empty */
  }
}
