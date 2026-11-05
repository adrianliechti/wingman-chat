import { beforeEach, expect, it, vi } from "vitest";
import { completePendingBackupReset } from "./backupReset";
import { BACKUP_RESET_KEY } from "./backupLifecycle";
import { resetLocalBackupState } from "./chatSync";
import { resetBackup } from "./storeClient";
import { forgetBackup } from "./rememberedBackup";

vi.mock("./rememberedBackup", () => ({ forgetBackup: vi.fn() }));

vi.mock("./chatSync", () => ({ resetLocalBackupState: vi.fn() }));
vi.mock("./storeClient", () => ({ resetBackup: vi.fn(), fetchMe: vi.fn() }));
vi.mock("./persistence", () => ({
  flushPersistence: vi.fn(),
  withPersistenceLock: (_key: string, operation: () => Promise<void>) => operation(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

it("retries failed local cleanup without deleting a new online backup", async () => {
  localStorage.setItem(BACKUP_RESET_KEY, JSON.stringify({ userId: "alice", phase: "delete" }));
  vi.mocked(resetLocalBackupState).mockRejectedValueOnce(new Error("disk unavailable"));
  await expect(completePendingBackupReset("alice")).rejects.toThrow("disk unavailable");
  expect(JSON.parse(localStorage.getItem(BACKUP_RESET_KEY)!)).toEqual({ userId: "alice", phase: "local" });
  await completePendingBackupReset("alice");
  expect(resetBackup).toHaveBeenCalledOnce();
  expect(forgetBackup).toHaveBeenCalledTimes(2);
  expect(resetLocalBackupState).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem(BACKUP_RESET_KEY)).toBeNull();
});

it("does not reset a different signed-in account", async () => {
  localStorage.setItem(BACKUP_RESET_KEY, JSON.stringify({ userId: "alice", phase: "delete" }));
  await expect(completePendingBackupReset("bob")).rejects.toThrow("Sign in to the account");
  expect(resetBackup).not.toHaveBeenCalled();
  expect(resetLocalBackupState).not.toHaveBeenCalled();
});

it("preserves the pending reset when server deletion fails", async () => {
  localStorage.setItem(BACKUP_RESET_KEY, JSON.stringify({ userId: "alice", phase: "delete" }));
  vi.mocked(resetBackup).mockRejectedValueOnce(new Error("offline"));
  await expect(completePendingBackupReset("alice")).rejects.toThrow("offline");
  expect(JSON.parse(localStorage.getItem(BACKUP_RESET_KEY)!).phase).toBe("delete");
  expect(resetLocalBackupState).not.toHaveBeenCalled();
});
