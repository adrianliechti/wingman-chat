import { flushPersistence } from "./persistence";

// Nesting covers a send, its connection, and any queued/tool continuations.
const active = new Map<string, Set<() => void>>();
const listeners = new Set<() => void>();

export function isChatBackupPaused(id: string): boolean {
  return active.has(id);
}

export function areFileBackupsPaused(): boolean {
  return active.size > 0;
}

export function onChatBackupReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function beginChatBackupPause(id: string): () => void {
  const holds = active.get(id) ?? new Set<() => void>();
  const release = () => {
    const current = active.get(id);
    if (!current?.delete(release)) return;
    if (current.size === 0) {
      active.delete(id);
      for (const listener of listeners) listener();
    }
  };
  holds.add(release);
  active.set(id, holds);
  return release;
}

/** Stop freezes native persistence even if a provider ignores its abort signal. */
export async function finishStoppedChatBackups(id: string): Promise<void> {
  const releases = [...(active.get(id) ?? [])];
  await finishChatBackupPause(() => {
    for (const release of releases) release();
  });
}

/** Preserve frequent local saves; publish the final durable state after completion/stop/error. */
export async function finishChatBackupPause(release: () => void): Promise<void> {
  try {
    await flushPersistence();
  } catch (error) {
    console.error("Couldn't finish saving the chat before backup", error);
  } finally {
    release();
  }
}

export class BackupPausedError extends Error {}

export function requireChatBackupReady(id: string): void {
  if (isChatBackupPaused(id)) throw new BackupPausedError("Chat backup waits for the request to finish.");
}

export function requireFileBackupReady(): void {
  if (areFileBackupsPaused()) throw new BackupPausedError("File backup waits for the request to finish.");
}
