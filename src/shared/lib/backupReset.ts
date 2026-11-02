import { resetLocalBackupState } from "./chatSync";
import { flushPersistence, withPersistenceLock } from "./persistence";
import { fetchMe, resetBackup } from "./storeClient";
import { BACKUP_GENERATION_KEY, BACKUP_RESET_KEY, markBackupReset } from "./backupLifecycle";
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
    const request = JSON.parse(pending) as { userId: string; phase: "delete" | "local" };
    if (request.userId !== userId) throw new Error("Sign in to the account that requested the backup reset.");
    if (request.phase === "delete") {
      await resetBackup();
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
