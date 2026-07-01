/**
 * Chat-as-log representation.
 *
 * A chat is stored — both locally (`chats/{id}/log.jsonl`) and on the
 * wire (each encrypted event's plaintext) — as a sequence of LogEntry
 * lines in JSON-Lines format. Replay folds the lines into a StoredChat;
 * diff produces the minimal entry sequence to turn one StoredChat into
 * another.
 *
 * This makes append-only saves O(delta), not O(chat).
 */

import type { Chat } from "@/shared/types/chat";
import type { StoredChat, StoredMessage } from "./opfs-chat";

export type LogEntry =
  | { type: "init"; id: string; created: string | null; model: Chat["model"] | null }
  | {
      type: "meta";
      title?: string | null;
      customTitle?: string | null;
      customIndex?: number | null;
      model?: Chat["model"] | null;
      updated?: string | null;
    }
  | ({ type: "message" } & StoredMessage)
  | { type: "replace"; index: number; message: StoredMessage }
  | { type: "truncate"; length: number }
  | { type: "tombstone" };

// JSONL codec ------------------------------------------------------------

export function encodeLines(entries: LogEntry[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "");
}

export function decodeLines(text: string): LogEntry[] {
  const out: LogEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as LogEntry);
    } catch (err) {
      console.warn("chatLog.decodeLines: skipping malformed line", err);
    }
  }
  return out;
}

/** Per-frame plaintext budget. Base64 + GCM overhead keeps the resulting
 *  frame comfortably under the server's 8 MiB MaxFrameBytes. */
const MAX_FRAME_PLAINTEXT = 4 * 1024 * 1024;

/** Split entries into runs that each fit one encrypted frame. A single
 *  oversized entry (one message with huge tool results) still gets its
 *  own frame. */
export function chunkEntries(entries: LogEntry[]): LogEntry[][] {
  const out: LogEntry[][] = [];
  let cur: LogEntry[] = [];
  let size = 0;
  for (const e of entries) {
    const n = JSON.stringify(e).length + 1;
    if (cur.length > 0 && size + n > MAX_FRAME_PLAINTEXT) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(e);
    size += n;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

// Replay -----------------------------------------------------------------

export interface ReplayResult {
  /** null when the chat has been tombstoned. */
  chat: StoredChat | null;
}

export function replayLog(chatId: string, entries: LogEntry[]): ReplayResult {
  let chat: StoredChat | null = {
    id: chatId,
    created: null,
    updated: null,
    model: null,
    messages: [],
  };

  for (const e of entries) {
    if (e.type === "tombstone") {
      chat = null;
      continue;
    }
    if (!chat) {
      // Re-create on writes after a tombstone (very unusual but harmless).
      chat = { id: chatId, created: null, updated: null, model: null, messages: [] };
    }
    switch (e.type) {
      case "init":
        chat.id = e.id;
        chat.created = e.created;
        chat.model = e.model;
        break;
      case "meta":
        if (e.title !== undefined) chat.title = e.title ?? undefined;
        if (e.customTitle !== undefined) chat.customTitle = e.customTitle ?? undefined;
        if (e.customIndex !== undefined) chat.customIndex = e.customIndex ?? undefined;
        if (e.model !== undefined) chat.model = e.model ?? null;
        if (e.updated !== undefined) chat.updated = e.updated;
        break;
      case "message": {
        const { type: _t, ...m } = e;
        chat.messages.push(m as StoredMessage);
        break;
      }
      case "replace":
        if (e.index >= 0 && e.index < chat.messages.length) {
          chat.messages[e.index] = e.message;
        } else if (e.index === chat.messages.length) {
          chat.messages.push(e.message);
        } else {
          console.warn(`chatLog.replay: replace index ${e.index} out of range (${chat.messages.length})`);
        }
        break;
      case "truncate":
        if (e.length >= 0 && e.length <= chat.messages.length) {
          chat.messages.length = e.length;
        }
        break;
    }
  }

  return { chat };
}

// Diff -------------------------------------------------------------------

function messagesEqual(a: StoredMessage, b: StoredMessage): boolean {
  // Stable JSON compare. Cheap relative to encrypt+upload, and StoredMessage
  // contains only JSON-serializable values (blob refs, not Blob objects).
  return JSON.stringify(a) === JSON.stringify(b);
}

function modelsEqual(a: Chat["model"] | null | undefined, b: Chat["model"] | null | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Compute the minimal LogEntry sequence that turns `prev` into `next`.
 *
 * Strategy:
 *  - First sync: emit init + meta(if non-empty) + one `message` per message.
 *  - Meta diff: emit one meta line covering whichever fields changed.
 *  - Messages: find the longest common prefix. If any tail remains in
 *    prev, emit a `truncate`. Then either:
 *      • exactly one tail message changed in next at the boundary: emit
 *        a single `replace`, then append the rest.
 *      • otherwise: append all of next's tail as `message` lines.
 */
export function diffChat(prev: StoredChat | null, next: StoredChat): LogEntry[] {
  const out: LogEntry[] = [];

  if (!prev) {
    out.push({ type: "init", id: next.id, created: next.created, model: next.model });
    if (next.title || next.customTitle || next.customIndex !== undefined || next.updated) {
      out.push({
        type: "meta",
        title: next.title,
        customTitle: next.customTitle,
        customIndex: next.customIndex,
        updated: next.updated,
      });
    }
    for (const m of next.messages) {
      out.push({ type: "message", ...m });
    }
    return out;
  }

  // Meta diff
  const meta: Extract<LogEntry, { type: "meta" }> = { type: "meta" };
  let metaDirty = false;
  if (prev.title !== next.title) {
    meta.title = next.title ?? null;
    metaDirty = true;
  }
  if (prev.customTitle !== next.customTitle) {
    meta.customTitle = next.customTitle ?? null;
    metaDirty = true;
  }
  if (prev.customIndex !== next.customIndex) {
    meta.customIndex = next.customIndex ?? null;
    metaDirty = true;
  }
  if (!modelsEqual(prev.model, next.model)) {
    meta.model = next.model;
    metaDirty = true;
  }
  if (prev.updated !== next.updated) {
    meta.updated = next.updated;
    metaDirty = true;
  }
  if (metaDirty) out.push(meta);

  // Messages: longest common prefix
  let i = 0;
  while (i < prev.messages.length && i < next.messages.length && messagesEqual(prev.messages[i], next.messages[i])) {
    i++;
  }

  const prevTail = prev.messages.length - i;
  const nextTail = next.messages.length - i;

  if (prevTail > 0) {
    // Special case: exactly one message changed at position i and the
    // rest match — emit a single replace, no truncate. Saves a line for
    // the common "regenerate last response" pattern.
    if (prevTail === 1 && nextTail >= 1 && prev.messages.length - 1 === i && next.messages.length - 1 >= i) {
      out.push({ type: "replace", index: i, message: next.messages[i] });
      for (let j = i + 1; j < next.messages.length; j++) {
        out.push({ type: "message", ...next.messages[j] });
      }
      return out;
    }
    out.push({ type: "truncate", length: i });
  }

  for (let j = i; j < next.messages.length; j++) {
    out.push({ type: "message", ...next.messages[j] });
  }

  return out;
}

// Convenience -----------------------------------------------------------

export function applyEntriesInPlace(chat: StoredChat | null, entries: LogEntry[], chatId: string): StoredChat | null {
  const seed = chat ? { ...chat, messages: chat.messages.slice() } : null;
  const { chat: result } = replayLog(chatId, [...(seed ? toReplayBaseline(seed) : []), ...entries]);
  return result;
}

function toReplayBaseline(chat: StoredChat): LogEntry[] {
  // Reconstruct a minimal entry sequence equivalent to the current state.
  const out: LogEntry[] = [{ type: "init", id: chat.id, created: chat.created, model: chat.model }];
  if (chat.title || chat.customTitle || chat.customIndex !== undefined || chat.updated) {
    out.push({
      type: "meta",
      title: chat.title,
      customTitle: chat.customTitle,
      customIndex: chat.customIndex,
      updated: chat.updated,
    });
  }
  for (const m of chat.messages) out.push({ type: "message", ...m });
  return out;
}
