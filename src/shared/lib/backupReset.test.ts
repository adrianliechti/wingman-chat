import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adoptLocalWorkspace,
  assertWorkspaceOwner,
  completePendingBackupReset,
  prepareBackupAccount,
  recordBackupAccount,
  requestBackupReset,
} from "./backupReset";
import { BACKUP_GENERATION_KEY, BACKUP_RESET_KEY, WORKSPACE_OWNER_KEY, WorkspaceOwnerError } from "./backupLifecycle";
import { readJson, writeJson } from "./opfs-core";
import { resetLocalBackupState } from "./chatSync";
import { fetchMe, getKeystore, resetBackup, ServerError } from "./storeClient";
import { forgetBackup } from "./rememberedBackup";

vi.mock("./rememberedBackup", () => ({ forgetBackup: vi.fn() }));

vi.mock("./chatSync", () => ({ resetLocalBackupState: vi.fn() }));
vi.mock("./opfs-core", () => ({ readJson: vi.fn(), writeJson: vi.fn() }));
vi.mock("./storeClient", async (importOriginal) => ({
  ServerError: (await importOriginal<typeof import("./storeClient")>()).ServerError,
  resetBackup: vi.fn(),
  fetchMe: vi.fn(),
  getKeystore: vi.fn(),
}));
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
  localStorage.setItem(
    BACKUP_RESET_KEY,
    JSON.stringify({ userId: "alice", phase: "delete", target: { keystore: "etag-1" } }),
  );
  vi.mocked(resetLocalBackupState).mockRejectedValueOnce(new Error("disk unavailable"));
  await expect(completePendingBackupReset("alice")).rejects.toThrow("disk unavailable");
  expect(JSON.parse(localStorage.getItem(BACKUP_RESET_KEY)!)).toEqual({ userId: "alice", phase: "local" });
  expect(resetBackup).toHaveBeenCalledWith({ keystore: "etag-1" });
  await completePendingBackupReset("alice");
  expect(resetBackup).toHaveBeenCalledOnce();
  expect(forgetBackup).toHaveBeenCalledTimes(2);
  expect(resetLocalBackupState).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem(BACKUP_RESET_KEY)).toBeNull();
});

it("does not reset a different signed-in account", async () => {
  localStorage.setItem(
    BACKUP_RESET_KEY,
    JSON.stringify({ userId: "alice", phase: "delete", target: { keystore: "etag-1" } }),
  );
  await expect(completePendingBackupReset("bob")).rejects.toThrow("Sign in to the account");
  expect(resetBackup).not.toHaveBeenCalled();
  expect(resetLocalBackupState).not.toHaveBeenCalled();
});

it("preserves the pending reset when server deletion fails", async () => {
  localStorage.setItem(
    BACKUP_RESET_KEY,
    JSON.stringify({ userId: "alice", phase: "delete", target: { keystore: "etag-1" } }),
  );
  vi.mocked(resetBackup).mockRejectedValueOnce(new Error("offline"));
  await expect(completePendingBackupReset("alice")).rejects.toThrow("offline");
  expect(JSON.parse(localStorage.getItem(BACKUP_RESET_KEY)!).phase).toBe("delete");
  expect(resetLocalBackupState).not.toHaveBeenCalled();
});

it("records which backup the user confirmed resetting", async () => {
  const reload = vi.fn();
  vi.stubGlobal("window", { location: { reload } });
  vi.mocked(fetchMe).mockResolvedValue({ id: "alice" });
  vi.mocked(getKeystore).mockResolvedValueOnce({ data: "{}", etag: "etag-1" });
  await requestBackupReset();
  expect(JSON.parse(localStorage.getItem(BACKUP_RESET_KEY)!).target).toEqual({ keystore: "etag-1" });

  vi.mocked(getKeystore).mockResolvedValueOnce(null);
  await requestBackupReset();
  expect(JSON.parse(localStorage.getItem(BACKUP_RESET_KEY)!).target).toEqual({ keystore: null });

  vi.mocked(getKeystore).mockRejectedValueOnce(new ServerError(422, "unreadable"));
  await requestBackupReset();
  expect(JSON.parse(localStorage.getItem(BACKUP_RESET_KEY)!).target).toEqual({ unreadable: true });

  vi.mocked(getKeystore).mockRejectedValueOnce(new Error("offline"));
  await expect(requestBackupReset()).rejects.toThrow("offline");
  expect(reload).toHaveBeenCalledTimes(3);
});

it("finishes locally when the confirmed backup was replaced", async () => {
  localStorage.setItem(
    BACKUP_RESET_KEY,
    JSON.stringify({ userId: "alice", phase: "delete", target: { keystore: "old" } }),
  );
  vi.mocked(getKeystore).mockResolvedValueOnce({ data: "{}", etag: "replacement" });
  await completePendingBackupReset("alice");
  expect(resetLocalBackupState).toHaveBeenCalledOnce();
  expect(localStorage.getItem(BACKUP_RESET_KEY)).toBeNull();
});

it("keeps the reset pending while the confirmed keystore still exists", async () => {
  const pending = JSON.stringify({ userId: "alice", phase: "delete", target: { keystore: "old" } });
  localStorage.setItem(BACKUP_RESET_KEY, pending);
  vi.mocked(getKeystore).mockResolvedValueOnce({ data: "{}", etag: "old" }).mockResolvedValueOnce(null);

  await expect(completePendingBackupReset("alice")).rejects.toThrow("The confirmed online backup is still present");
  expect(localStorage.getItem(BACKUP_RESET_KEY)).toBe(pending);
  expect(resetLocalBackupState).not.toHaveBeenCalled();

  await completePendingBackupReset("alice");
  expect(resetBackup).toHaveBeenNthCalledWith(2, { keystore: "old" });
  expect(resetLocalBackupState).toHaveBeenCalledOnce();
  expect(localStorage.getItem(BACKUP_RESET_KEY)).toBeNull();
});

it("never deletes online data for a reset without a confirmed target", async () => {
  localStorage.setItem(BACKUP_RESET_KEY, JSON.stringify({ userId: "alice", phase: "delete" }));
  await completePendingBackupReset("alice");
  expect(resetBackup).not.toHaveBeenCalled();
  expect(resetLocalBackupState).toHaveBeenCalledOnce();
  expect(localStorage.getItem(BACKUP_RESET_KEY)).toBeNull();
});

it("binds the local workspace to its first account", async () => {
  await assertWorkspaceOwner("alice");
  await assertWorkspaceOwner("alice");
  await expect(assertWorkspaceOwner("bob")).rejects.toThrow(/another account/);
  expect(localStorage.getItem(WORKSPACE_OWNER_KEY)).toBe("alice");
});

it("blocks a different account's existing sync state", async () => {
  vi.mocked(readJson).mockResolvedValue({ userId: "bob" });
  await expect(assertWorkspaceOwner("alice")).rejects.toThrow(/another account/);
  expect(localStorage.getItem(WORKSPACE_OWNER_KEY)).toBeNull();
});

it("adopts another account's workspace by clearing its sync tracking", async () => {
  const reload = vi.fn();
  vi.stubGlobal("window", { location: { reload } });
  localStorage.setItem(WORKSPACE_OWNER_KEY, "old-id");
  localStorage.setItem(BACKUP_RESET_KEY, JSON.stringify({ userId: "old-id", phase: "delete" }));
  vi.mocked(fetchMe).mockResolvedValue({ id: "new-id" } as never);
  await expect(assertWorkspaceOwner("new-id")).rejects.toThrow(WorkspaceOwnerError);

  await adoptLocalWorkspace();

  expect(resetLocalBackupState).toHaveBeenCalledOnce();
  expect(forgetBackup).toHaveBeenCalledOnce();
  expect(resetBackup).not.toHaveBeenCalled();
  expect(localStorage.getItem(BACKUP_RESET_KEY)).toBeNull();
  expect(reload).toHaveBeenCalledOnce();
  await assertWorkspaceOwner("new-id");
  expect(localStorage.getItem(WORKSPACE_OWNER_KEY)).toBe("new-id");
});

describe("backup account tracking", () => {
  let files: Map<string, unknown>;
  beforeEach(() => {
    files = new Map();
    vi.mocked(readJson).mockImplementation(async (path: string) => (files.get(path) ?? null) as never);
    vi.mocked(writeJson).mockImplementation(async (path: string, value: unknown) => void files.set(path, value));
  });

  it("keeps tracking for the recorded backup", async () => {
    await recordBackupAccount("account-a");
    files.set("_sync/state.json", { userId: "alice", heads: { chat: 3 } });
    expect(await prepareBackupAccount("account-a")).toBe(true);
    expect(resetLocalBackupState).not.toHaveBeenCalled();
  });

  it("clears tracking from another backup instead of treating its chats as deleted", async () => {
    await recordBackupAccount("account-a");
    expect(await prepareBackupAccount("account-b")).toBe(false);
    expect(forgetBackup).toHaveBeenCalledOnce();
    expect(resetLocalBackupState).toHaveBeenCalledOnce();
    expect(localStorage.getItem(BACKUP_GENERATION_KEY)).not.toBeNull();
  });

  it("clears tracking when the server has no backup", async () => {
    await recordBackupAccount("account-a");
    expect(await prepareBackupAccount(null)).toBe(false);
    expect(resetLocalBackupState).toHaveBeenCalledOnce();
  });

  it("clears unrecorded baselines only when the server has no backup", async () => {
    files.set("_sync/files.json", { userId: "alice", entries: {} });
    files.set("_sync/state.json", { userId: "alice", heads: {} });
    expect(await prepareBackupAccount(null)).toBe(true);
    expect(await prepareBackupAccount("account-a")).toBe(true);
    files.set("_sync/state.json", { userId: "alice", heads: { chat: 3 } });
    expect(await prepareBackupAccount("account-a")).toBe(true);
    expect(resetLocalBackupState).not.toHaveBeenCalled();
    expect(await prepareBackupAccount(null)).toBe(false);
    expect(resetLocalBackupState).toHaveBeenCalledOnce();
  });
});
