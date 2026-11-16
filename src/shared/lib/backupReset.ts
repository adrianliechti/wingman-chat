import { resetLocalBackupState } from "./chatSync";
import { flushPersistence, withPersistenceLock } from "./persistence";
import { fetchMe, resetBackup } from "./storeClient";
import { readJson } from "./opfs-core";
import {
  BACKUP_GENERATION_KEY,
  BACKUP_RESET_KEY,
  WORKSPACE_OWNER_KEY,
  invalidateBackupSessions,
  markBackupReset,
} from "./backupLifecycle";
import { notify } from "./notify";
import { forgetBackup } from "./rememberedBackup";

// Reload peer tabs after stopping sync or resetting backup so old engines and
// decrypted keys cannot survive the change. The generation also fences stale tabs.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === BACKUP_GENERATION_KEY && event.newValue !== event.oldValue) {
      void flushPersistence()
        .then(() => window.location.reload())
        .catch((error) => {
          notify.error("Couldn't save before backup settings changed", error);
        });
    }
  });
}

export async function requestBackupReset(): Promise<void> {
  const user = await fetchMe();
  await flushPersistence();
  markBackupReset(user.id);
  window.location.reload();
}

/** Complete before any upload or restore engine is started. Retry after failures. */
export async function completePendingBackupReset(userId: string): Promise<void> {
  await withPersistenceLock("backup-reset", async () => {
    const pending = localStorage.getItem(BACKUP_RESET_KEY);
    if (!pending) return;
    const request = JSON.parse(pending) as { userId: string; phase: "delete" | "local"; resetId: string };
    if (request.userId !== userId) throw new Error("Sign in to the account that requested the backup reset.");
    if (request.phase === "delete") {
      await resetBackup(request.resetId);
      // A local cleanup retry must never erase a newly configured remote backup.
      localStorage.setItem(BACKUP_RESET_KEY, JSON.stringify({ userId, phase: "local" }));
    } else if (request.phase !== "local") {
      throw new Error("Invalid backup reset state.");
    }
    await forgetBackup();
    await resetLocalBackupState();
    localStorage.removeItem(BACKUP_RESET_KEY);
  });
}

/** Prepare before starting engines. A changed destination must never interpret
 * the previous destination's confirmed heads as remote deletions. */
export async function prepareBackupDestination(userId: string, destination: string): Promise<boolean> {
  return withPersistenceLock("backup-reset", async () => {
    const marker = `wingman:backup-destination:${userId}`;
    const owner = localStorage.getItem(WORKSPACE_OWNER_KEY);
    if (owner && owner !== userId) {
      throw new Error(
        "This browser contains another account's local workspace. Sign back in to export it before clearing local data.",
      );
    }
    const previous = localStorage.getItem(marker);
    const states = await Promise.all([
      readJson<{ userId: string }>("_sync/state.json"),
      readJson<{ userId: string }>("_sync/files.json"),
    ]);
    if (states.some((state) => state && state.userId !== userId)) {
      throw new Error(
        "This browser contains another account's local workspace. Sign back in to export it before clearing local data.",
      );
    }
    if (previous === destination) {
      localStorage.setItem(marker, destination);
      localStorage.setItem(WORKSPACE_OWNER_KEY, userId);
      return true;
    }
    const pending = localStorage.getItem(BACKUP_RESET_KEY);
    if (pending) {
      const reset = JSON.parse(pending) as { phase: string };
      if (reset.phase !== "local") {
        throw new Error("Finish the pending backup reset before changing backup destination.");
      }
    }
    // Account-switch cleanup depends on these ownership markers. Clearing them
    // here would let the next account inherit the previous account's workspace.
    await forgetBackup();
    await resetLocalBackupState();
    localStorage.setItem(marker, destination);
    localStorage.setItem(WORKSPACE_OWNER_KEY, userId);
    invalidateBackupSessions();
    return false;
  });
}
