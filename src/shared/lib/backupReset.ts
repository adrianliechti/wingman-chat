import { resetLocalBackupState } from "./chatSync";
import { flushPersistence, withPersistenceLock } from "./persistence";
import { fetchMe, resetBackup } from "./storeClient";
import { readJson, writeJson } from "./opfs-core";
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

const otherAccount =
  "This browser contains another account's local workspace. Sign back in to export it before clearing local data.";

/** Check before starting engines: a browser's local workspace belongs to one account. */
export async function assertWorkspaceOwner(userId: string): Promise<void> {
  await withPersistenceLock("backup-reset", async () => {
    const owner = localStorage.getItem(WORKSPACE_OWNER_KEY);
    if (owner && owner !== userId) throw new Error(otherAccount);
    const states = await Promise.all([
      readJson<{ userId: string }>("_sync/state.json"),
      readJson<{ userId: string }>("_sync/files.json"),
    ]);
    if (states.some((state) => state && state.userId !== userId)) throw new Error(otherAccount);
    localStorage.setItem(WORKSPACE_OWNER_KEY, userId);
  });
}

const BACKUP_ACCOUNT_FILE = "_sync/backup.json";

/** Record which backup the local sync tracking refers to. Called when engines start. */
export function recordBackupAccount(accountId: string): Promise<void> {
  return writeJson(BACKUP_ACCOUNT_FILE, { accountId });
}

/**
 * Check before starting engines. Sync tracking from another backup (a switched
 * provider/connection, or a reset by another browser) would make its confirmed
 * chats look remotely deleted, so clear it while keeping local content. Pass
 * null when the server has no keystore. Returns false when tracking was
 * cleared and open tabs must reload.
 */
export async function prepareBackupAccount(accountId: string | null): Promise<boolean> {
  return withPersistenceLock("backup-reset", async () => {
    const recorded = await readJson<{ accountId: string }>(BACKUP_ACCOUNT_FILE);
    let stale = !!recorded && recorded.accountId !== accountId;
    if (!accountId && !recorded) {
      // Older browsers have no record; any confirmed baseline belongs to a backup that no longer exists.
      const [chats, files] = await Promise.all([
        readJson<{ heads?: object; tombstones?: object }>("_sync/state.json"),
        readJson<{ entries?: object }>("_sync/files.json"),
      ]);
      stale = [chats?.heads, chats?.tombstones, files?.entries].some((v) => v && Object.keys(v).length > 0);
    }
    if (!stale) return true;
    await forgetBackup();
    await resetLocalBackupState();
    invalidateBackupSessions();
    return false;
  });
}
