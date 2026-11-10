import { useMemo, useSyncExternalStore } from "react";

/**
 * Unsaved edits per file. A draft outlives its editor: switching files, hiding
 * the drawer or opening another chat keeps it until it is saved or discarded.
 * Drafts live in memory, so leaving the page while any exist asks the browser
 * to warn first.
 */
export interface StoredDraft {
  /** The edited text. */
  text: string;
  /** The file's text the edits were made against. */
  base: string;
}

const drafts = new Map<string, StoredDraft>();
/** Deleted files and folders: an editor closing on one must not leave a draft behind. */
const removed = new Set<string>();
const listeners = new Set<() => void>();
let keys: readonly string[] = [];

const within = (key: string, prefix: string) => key === prefix || key.startsWith(`${prefix}/`);

/** Identifies one file of one chat's workspace. */
export function draftKey(chatId: string, path: string): string {
  return `${chatId}\u0000${path}`;
}

const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();

function changed() {
  const had = keys.length > 0;
  keys = [...drafts.keys()];
  if (typeof window !== "undefined" && had !== keys.length > 0) {
    if (keys.length > 0) window.addEventListener("beforeunload", warnBeforeUnload);
    else window.removeEventListener("beforeunload", warnBeforeUnload);
  }
  for (const listener of listeners) listener();
}

export function getDraft(key: string): StoredDraft | undefined {
  return drafts.get(key);
}

/** Records a draft; listeners hear only when a file gains one. */
export function putDraft(key: string, draft: StoredDraft): void {
  for (const prefix of removed) if (within(key, prefix)) return;
  const added = !drafts.has(key);
  drafts.set(key, draft);
  if (added) changed();
}

export function dropDraft(key: string): void {
  if (drafts.delete(key)) changed();
}

/** Follows a renamed file, or a moved folder's files, with their drafts. */
export function moveDrafts(chatId: string, from: string, to: string): void {
  const prefix = draftKey(chatId, from);
  // Collected first: keys added while iterating a Map are visited too.
  const moving = Array.from(drafts.entries()).filter(([key]) => within(key, prefix));
  for (const [key, draft] of moving) {
    drafts.delete(key);
    drafts.set(draftKey(chatId, to) + key.slice(prefix.length), draft);
  }
  if (moving.length > 0) changed();
}

/** Drops the drafts of a deleted file, or of a deleted folder's files, and keeps them from returning. */
export function dropDrafts(chatId: string, path: string): void {
  const prefix = draftKey(chatId, path);
  removed.add(prefix);
  let dropped = false;
  for (const key of drafts.keys()) {
    if (!within(key, prefix)) continue;
    drafts.delete(key);
    dropped = true;
  }
  if (dropped) changed();
}

/** A file was created again where one was deleted: it may have drafts again. */
export function allowDrafts(chatId: string, path: string): void {
  const key = draftKey(chatId, path);
  for (const prefix of removed) if (within(key, prefix)) removed.delete(prefix);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => keys;

/** Paths in the chat's workspace that have unsaved edits. */
export function useUnsavedPaths(chatId: string | undefined): ReadonlySet<string> {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  return useMemo(() => {
    const prefix = chatId === undefined ? null : draftKey(chatId, "");
    return new Set(
      prefix === null ? [] : current.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)),
    );
  }, [current, chatId]);
}
