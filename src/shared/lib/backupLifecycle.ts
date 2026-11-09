import { withPersistenceLock } from "./persistence";

export const BACKUP_RESET_KEY = "wingman:backup-reset";
export const BACKUP_GENERATION_KEY = "wingman:backup-generation";

function generation(): string | null {
  return typeof localStorage === "undefined" ? null : localStorage.getItem(BACKUP_GENERATION_KEY);
}

// A stale tab stays fenced even after the reset marker has been cleared.
const pageGeneration = generation();

export function isBackupSessionCurrent(): boolean {
  return (
    pageGeneration === generation() && (typeof localStorage === "undefined" || !localStorage.getItem(BACKUP_RESET_KEY))
  );
}

export function invalidateBackupSessions(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(BACKUP_GENERATION_KEY, crypto.randomUUID());
}

export function markBackupReset(userId: string): void {
  invalidateBackupSessions();
  localStorage.setItem(BACKUP_RESET_KEY, JSON.stringify({ userId, phase: "delete" }));
}

/** Shared by whole sync operations, including their local response continuations.
 * Reset uses the exclusive counterpart through withPersistenceLock. */
export function withBackupStorage<T>(operation: () => Promise<T>): Promise<T> {
  if (globalThis.navigator?.locks) {
    return navigator.locks.request("wingman:backup-reset", { mode: "shared" }, operation);
  }
  return withPersistenceLock("backup-reset", operation);
}
