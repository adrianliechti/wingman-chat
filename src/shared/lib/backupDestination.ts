import { resetLocalBackupState } from "./chatSync";
import { readJson } from "./opfs-core";
import { withPersistenceLock } from "./persistence";
import { forgetBackup } from "./rememberedBackup";
import { BACKUP_RESET_KEY, invalidateBackupSessions } from "./backupLifecycle";

/** Prepare before starting engines. A changed destination must never interpret
 * the previous destination's confirmed heads as remote deletions. */
export async function prepareBackupDestination(
  userId: string,
  destination: string,
  previousUserId?: string,
): Promise<boolean> {
  return withPersistenceLock("backup-reset", async () => {
    const marker = `wingman:backup-destination:${userId}`;
    // Browsers predating destination selection only backed up to the server.
    const previous = localStorage.getItem(marker) ?? "server";
    const states =
      previous !== destination || previousUserId
        ? await Promise.all([
            readJson<{ userId: string }>("_sync/state.json"),
            readJson<{ userId: string }>("_sync/files.json"),
          ])
        : [];
    const canPreserve = states.every(
      (state) => !state || state.userId === userId || (previousUserId && state.userId === previousUserId),
    );
    const changedIdentity =
      canPreserve &&
      Boolean(previousUserId && previousUserId !== userId && states.some((state) => state?.userId === previousUserId));
    if (previous === destination && !changedIdentity) {
      localStorage.setItem(marker, destination);
      return true;
    }
    const pending = localStorage.getItem(BACKUP_RESET_KEY);
    if (pending) {
      const reset = JSON.parse(pending) as { userId: string; phase: string };
      if (reset.phase !== "local") {
        throw new Error("Finish the pending backup reset before changing backup destination or identity.");
      }
      if (canPreserve && previousUserId && reset.userId === previousUserId) {
        localStorage.setItem(BACKUP_RESET_KEY, JSON.stringify({ ...reset, userId }));
      }
    }
    // Account-switch cleanup depends on these ownership markers. Clearing them
    // here would let the next account inherit the previous account's workspace.
    if (canPreserve) {
      await forgetBackup();
      await resetLocalBackupState();
    }
    localStorage.setItem(marker, destination);
    invalidateBackupSessions();
    return false;
  });
}
