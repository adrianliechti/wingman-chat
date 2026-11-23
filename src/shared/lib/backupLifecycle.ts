import { withPersistenceLock } from "./persistence";
import type { ResetTarget } from "./storeClient";

export const WORKSPACE_OWNER_KEY = "wingman:workspace-owner";
export const BACKUP_RESET_KEY = "wingman:backup-reset";
export const REOPEN_BACKUP_SETTINGS_KEY = "wingman:reopen-backup-settings";
export const BACKUP_GENERATION_KEY = "wingman:backup-generation";
/** Holds the generation that wiped local storage; peers must drop, not flush, their pending saves. */
export const STORAGE_RESET_KEY = "wingman:storage-reset";

/** Local workspace was bound to a different account ID than the signed-in one. */
export class WorkspaceOwnerError extends Error {
  constructor() {
    super(
      "This browser contains another account's local workspace. Sign back in to export it, or use it with this account.",
    );
    this.name = "WorkspaceOwnerError";
  }
}

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

export function invalidateBackupSessions(storageWiped = false): void {
  if (typeof localStorage === "undefined") return;
  const next = crypto.randomUUID();
  if (storageWiped) localStorage.setItem(STORAGE_RESET_KEY, next);
  localStorage.setItem(BACKUP_GENERATION_KEY, next);
}

export function markBackupReset(userId: string, target: ResetTarget): void {
  invalidateBackupSessions();
  localStorage.setItem(BACKUP_RESET_KEY, JSON.stringify({ userId, phase: "delete", target }));
}

/** Shared by whole sync operations, including their local response continuations.
 * Reset uses the exclusive counterpart through withPersistenceLock. */
export function withBackupStorage<T>(operation: () => Promise<T>): Promise<T> {
  if (globalThis.navigator?.locks) {
    return navigator.locks.request("wingman:backup-reset", { mode: "shared" }, operation);
  }
  return withPersistenceLock("backup-reset", operation);
}
