/**
 * Server-synced chat storage with offline-capable OPFS mirror.
 *
 * Wire format: each chat is an append-only log. Both on the server
 * (`{chatId}.jsonl`) and locally in OPFS (`chats/{id}/log.jsonl`), the
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
import { applyEntriesInPlace, decodeLines, diffChat, encodeLines, type LogEntry, replayLog } from "./chatLog";
import * as api from "./chatstoreClient";
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
const logPath = (chatId: string) => `chats/${chatId}/log.jsonl`;
const targetPath = (chatId: string) => `chats/${chatId}/target.json`;
const legacyChatJsonPath = (chatId: string) => `chats/${chatId}/chat.json`;

// ChatSync ---------------------------------------------------------------

export interface ChatSyncOptions {
  userId: string;
  dek: DEK;
}

export class ChatSync {
  private state: SyncState;
  /** Server-confirmed state per chat (in memory; persisted as log.jsonl). */
  private lastSynced = new Map<string, StoredChat>();
  /** Pending target per chat (in memory; persisted as target.json). */
  private pendingTargets = new Map<string, StoredChat>();
  private flushing = false;
  private readonly userId: string;
  private readonly dek: DEK;

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

  /** Pull remote changes for every chat into the local mirror; return
   *  the materialized chat list (lastSynced wins over pending targets
   *  only for chats with no pending edits). */
  async pull(): Promise<Chat[]> {
    const remote = await api.listChats();

    // Pull events in parallel — server reads are cheap and serial waits
    // dominate when there are many chats.
    await Promise.all(
      remote.map(async (meta) => {
        const localHead = this.state.heads[meta.id] ?? 0;
        if (meta.headSeq > localHead) {
          await this.applyRemoteEvents(meta.id, localHead);
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
    return out;
  }

  /** Persist a chat as a delta. Idempotent on retry. */
  async saveChat(chat: Chat): Promise<void> {
    const stored = await this.uploadBlobsAndExtract(chat);
    this.pendingTargets.set(chat.id, stored);
    await writeJson(targetPath(chat.id), stored);
    void this.flushPending();
  }

  /** Delete a chat: emit a tombstone, drop local state, DELETE on server. */
  async deleteChat(chatId: string): Promise<void> {
    // Blob ids are unique per attachment (never shared across chats), so
    // the server copies can go with the chat. Collect before dropping state.
    const blobIds = new Set<string>();
    for (const stored of [this.pendingTargets.get(chatId), this.lastSynced.get(chatId)]) {
      if (stored) for (const id of collectChatBlobIds(stored)) blobIds.add(id);
    }

    this.pendingTargets.delete(chatId);
    await deleteFile(targetPath(chatId));

    try {
      await this.postEntries(chatId, [{ type: "tombstone" }]);
    } catch (err) {
      console.warn(`chatSync.deleteChat: tombstone post failed for ${chatId}`, err);
    }
    await api.deleteChat(chatId);

    for (const blobId of blobIds) {
      try {
        await api.deleteBlob(blobId);
      } catch (err) {
        console.warn(`chatSync.deleteChat: blob delete failed for ${blobId}`, err);
      }
    }

    await deleteDirectory(`chats/${chatId}`);
    this.lastSynced.delete(chatId);
    delete this.state.heads[chatId];
    delete this.state.lastFrameHash[chatId];
    await saveState(this.state);
  }

  /** Replay any persisted pending targets through the server. */
  async flushPending(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      // snapshot: flushChat mutates pendingTargets while we iterate
      for (const chatId of Array.from(this.pendingTargets.keys())) {
        const ok = await this.flushChat(chatId);
        if (!ok) {
          // Network or persistent conflict — bail; next caller will retry.
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  // internals -----------------------------------------------------------

  private async hydrateFromOpfs(): Promise<void> {
    const ids = await listDirectories("chats");
    for (const id of ids) {
      // Migrate legacy chat.json → log.jsonl if needed.
      const hasLog = await fileExists(logPath(id));
      if (!hasLog) {
        const legacy = await readJson<StoredChat>(legacyChatJsonPath(id));
        if (legacy) {
          // Seed log from legacy chat. This represents a chat that was
          // saved locally but has never been synced — so we leave
          // lastSynced empty and stash it as a pending target instead.
          this.pendingTargets.set(id, legacy);
          await writeJson(targetPath(id), legacy);
          await deleteFile(legacyChatJsonPath(id));
          continue;
        }
      }

      // Replay log → lastSynced.
      const text = await readText(logPath(id));
      if (text) {
        const entries = decodeLines(text);
        const { chat } = replayLog(id, entries);
        if (chat) this.lastSynced.set(id, chat);
      }

      // Restore any pending target.
      const target = await readJson<StoredChat>(targetPath(id));
      if (target) this.pendingTargets.set(id, target);
    }
  }

  private async uploadBlobsAndExtract(chat: Chat): Promise<StoredChat> {
    const stored = await extractChatBlobs(chat);
    const blobIds = collectChatBlobIds(stored);
    for (const blobId of blobIds) {
      if (await api.headBlob(blobId)) continue;
      const blob = await getChatBlob(chat.id, blobId);
      if (!blob) continue;
      const plain = new Uint8Array(await blob.arrayBuffer());
      const cipher = await encryptBlob(this.dek, plain, this.userId, blobId);
      await api.putBlob(blobId, cipher);
    }
    return stored;
  }

  /** Compute the delta for one chat and post it. Returns true on
   *  success (or no-op), false on network/persistent conflict. */
  private async flushChat(chatId: string): Promise<boolean> {
    const target = this.pendingTargets.get(chatId);
    if (!target) return true;

    const baseline = this.lastSynced.get(chatId) ?? null;
    const entries = diffChat(baseline, target);

    if (entries.length === 0) {
      this.pendingTargets.delete(chatId);
      await deleteFile(targetPath(chatId));
      return true;
    }

    try {
      await this.postEntries(chatId, entries);
    } catch (err) {
      if (err instanceof PostConflictAfterRetry) return false;
      console.warn(`chatSync.flushChat(${chatId}): post failed`, err);
      return false;
    }

    this.pendingTargets.delete(chatId);
    await deleteFile(targetPath(chatId));
    void this.maybeCompact(chatId);
    return true;
  }

  /** Encrypt + post one batch of entries. Handles 409 by pulling and
   *  re-diffing once. Throws PostConflictAfterRetry if the second
   *  attempt still conflicts (caller leaves the target in place). */
  private async postEntries(chatId: string, entries: LogEntry[]): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const expectedSeq = this.state.heads[chatId] ?? 0;
      const prevHash = this.state.lastFrameHash[chatId] ?? ZERO_HASH;

      const payload = { id: crypto.randomUUID(), ts: new Date().toISOString(), prevHash, body: entries };
      const frame = await encryptEvent(this.dek, payload, this.userId, chatId, expectedSeq + 1);

      const res = await api.appendEvents(chatId, expectedSeq, [{ id: payload.id, frame }]);

      if (res === null) {
        // 409 — pull, then retry once with a freshly re-diff'd payload
        // computed against the new baseline.
        await this.applyRemoteEvents(chatId, expectedSeq);
        const newTarget = this.pendingTargets.get(chatId);
        if (!newTarget) return; // somehow no longer pending
        const newBaseline = this.lastSynced.get(chatId) ?? null;
        entries = diffChat(newBaseline, newTarget);
        if (entries.length === 0) return;
        continue;
      }

      // Accepted — apply the entries to local state.
      await appendBlob(logPath(chatId), new Blob([enc.encode(encodeLines(entries))]));
      const merged = applyEntriesInPlace(this.lastSynced.get(chatId) ?? null, entries, chatId);
      if (merged) this.lastSynced.set(chatId, merged);
      else this.lastSynced.delete(chatId);

      this.state.heads[chatId] = res.newSeq;
      this.state.lastFrameHash[chatId] = await hashFrame(frame);
      this.bumpEntryCount(chatId, entries[0]?.type === "init" ? -Infinity : entries.length);
      await saveState(this.state);
      return;
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
  private async maybeCompact(chatId: string): Promise<void> {
    const count = this.state.entriesSinceCompact?.[chatId] ?? 0;
    if (count < COMPACT_THRESHOLD) return;

    const target = this.lastSynced.get(chatId);
    if (!target) return;
    // Don't compact while there's a pending edit — the next flush handles it.
    if (this.pendingTargets.has(chatId)) return;

    const entries = diffChat(null, target); // forces init + meta + messages
    if (entries.length === 0) return;

    try {
      await this.postEntries(chatId, entries);
    } catch (err) {
      console.warn(`chatSync.maybeCompact(${chatId}): post failed`, err);
      return;
    }

    const compactBefore = this.state.heads[chatId] ?? 0;
    if (compactBefore < 2) return; // nothing to drop

    try {
      await api.compactChat(chatId, compactBefore);
    } catch (err) {
      console.warn(`chatSync.maybeCompact(${chatId}): server compact failed`, err);
      return;
    }

    // Replace the local log with just the surviving snapshot entry.
    await writeBlob(logPath(chatId), new Blob([enc.encode(encodeLines(entries))]));
  }

  /** Pull events from the server starting after fromSeq and apply them
   *  to local state (log file + in-memory baseline + head + hash). */
  private async applyRemoteEvents(chatId: string, fromSeq: number): Promise<void> {
    const events = await api.readEvents(chatId, fromSeq);
    if (events.length === 0) return;

    let head = this.state.heads[chatId] ?? 0;
    let lastHash = this.state.lastFrameHash[chatId] ?? ZERO_HASH;
    let baseline = this.lastSynced.get(chatId) ?? null;

    const appendedText: string[] = [];
    let logWasReset = false;

    for (const e of events) {
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
      if (logWasReset) await writeBlob(logPath(chatId), text);
      else await appendBlob(logPath(chatId), text);

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
