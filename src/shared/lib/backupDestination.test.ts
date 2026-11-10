import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareBackupDestination } from "./backupDestination";
import { resetLocalBackupState } from "./chatSync";
import { readJson } from "./opfs-core";
import { forgetBackup } from "./rememberedBackup";
import { BACKUP_RESET_KEY, invalidateBackupSessions } from "./backupLifecycle";

vi.mock("./chatSync", () => ({ resetLocalBackupState: vi.fn() }));
vi.mock("./opfs-core", () => ({ readJson: vi.fn() }));
vi.mock("./rememberedBackup", () => ({ forgetBackup: vi.fn() }));
vi.mock("./persistence", () => ({
  withPersistenceLock: (_key: string, operation: () => Promise<unknown>) => operation(),
}));
vi.mock("./backupLifecycle", () => ({
  BACKUP_RESET_KEY: "pending-reset",
  WORKSPACE_OWNER_KEY: "wingman:workspace-owner",
  invalidateBackupSessions: vi.fn(),
}));

const reload = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal("window", { location: { reload } });
});
afterEach(() => vi.unstubAllGlobals());

it("keeps tracking when the OneDrive destination is unchanged", async () => {
  localStorage.setItem("wingman:backup-destination:alice", "onedrive-app");
  expect(await prepareBackupDestination("alice", "onedrive-app")).toBe(true);
  expect(resetLocalBackupState).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});

it("preserves local content, resets tracking and reloads peer sessions on server to OneDrive transition", async () => {
  vi.mocked(readJson).mockResolvedValue({ userId: "alice" });
  expect(await prepareBackupDestination("alice", "onedrive-app")).toBe(false);
  expect(resetLocalBackupState).toHaveBeenCalledOnce();
  expect(forgetBackup).toHaveBeenCalledOnce();
  expect(invalidateBackupSessions).toHaveBeenCalledOnce();
  expect(reload).not.toHaveBeenCalled();
  expect(localStorage.getItem("wingman:backup-destination:alice")).toBe("onedrive-app");
  expect(await prepareBackupDestination("alice", "onedrive-app")).toBe(true);
  expect(resetLocalBackupState).toHaveBeenCalledOnce();
});

it("rebuilds tracking when switching OneDrive destinations", async () => {
  localStorage.setItem("wingman:backup-destination:alice", "onedrive-app");
  expect(await prepareBackupDestination("alice", "onedrive-other-app")).toBe(false);
  expect(resetLocalBackupState).toHaveBeenCalledOnce();
});

it("retries failed local migration without advancing the destination marker", async () => {
  vi.mocked(resetLocalBackupState).mockRejectedValueOnce(new Error("disk unavailable"));
  await expect(prepareBackupDestination("alice", "onedrive-app")).rejects.toThrow("disk unavailable");
  expect(localStorage.getItem("wingman:backup-destination:alice")).toBeNull();
  expect(invalidateBackupSessions).not.toHaveBeenCalled();
  expect(await prepareBackupDestination("alice", "onedrive-app")).toBe(false);
  expect(resetLocalBackupState).toHaveBeenCalledTimes(2);
});

it("blocks a different account while preserving local ownership", async () => {
  vi.mocked(readJson).mockResolvedValue({ userId: "bob" });
  await expect(prepareBackupDestination("alice", "onedrive-app")).rejects.toThrow(/another account/);
  expect(resetLocalBackupState).not.toHaveBeenCalled();
  expect(forgetBackup).not.toHaveBeenCalled();
});

it("never replays a pending remote reset against a new destination", async () => {
  localStorage.setItem(BACKUP_RESET_KEY, JSON.stringify({ userId: "alice", phase: "delete" }));
  await expect(prepareBackupDestination("alice", "onedrive-app")).rejects.toThrow("pending backup reset");
  expect(resetLocalBackupState).not.toHaveBeenCalled();
  expect(localStorage.getItem("wingman:backup-destination:alice")).toBeNull();
});

it("allows an already committed reset to finish local cleanup at the new destination", async () => {
  localStorage.setItem(BACKUP_RESET_KEY, JSON.stringify({ userId: "alice", phase: "local" }));
  expect(await prepareBackupDestination("alice", "onedrive-app")).toBe(false);
});

it("preserves local data and rebuilds tracking when email identity becomes a stable token identity", async () => {
  localStorage.setItem("wingman:backup-destination:stable-user", "server");
  vi.mocked(readJson).mockResolvedValue({ userId: "email-user" });
  expect(await prepareBackupDestination("stable-user", "server", "email-user")).toBe(false);
  expect(resetLocalBackupState).toHaveBeenCalledOnce();
  expect(forgetBackup).toHaveBeenCalledOnce();
  expect(invalidateBackupSessions).toHaveBeenCalledOnce();
});

it("does not rebuild stable-user tracking after another email change", async () => {
  localStorage.setItem("wingman:backup-destination:stable-user", "server");
  vi.mocked(readJson).mockResolvedValue({ userId: "stable-user" });
  expect(await prepareBackupDestination("stable-user", "server", "new-email-user")).toBe(true);
  expect(resetLocalBackupState).not.toHaveBeenCalled();
  expect(forgetBackup).not.toHaveBeenCalled();
});

it("blocks another account during the identity transition", async () => {
  vi.mocked(readJson).mockResolvedValue({ userId: "another-account" });
  await expect(prepareBackupDestination("stable-user", "server-new", "email-user")).rejects.toThrow(/another account/);
  expect(resetLocalBackupState).not.toHaveBeenCalled();
});

it("rebinds only completed resets to the stable identity", async () => {
  localStorage.setItem(BACKUP_RESET_KEY, JSON.stringify({ userId: "email-user", phase: "local" }));
  vi.mocked(readJson).mockResolvedValue({ userId: "email-user" });
  expect(await prepareBackupDestination("stable-user", "server-new", "email-user")).toBe(false);
  expect(JSON.parse(localStorage.getItem(BACKUP_RESET_KEY)!)).toEqual({ userId: "stable-user", phase: "local" });
});

it("blocks mixed ownership rather than clearing either account", async () => {
  vi.mocked(readJson).mockImplementation(async (path) => ({
    userId: path === "_sync/state.json" ? "email-user" : "another-account",
  }));
  await expect(prepareBackupDestination("stable-user", "server-new", "email-user")).rejects.toThrow(/another account/);
  expect(resetLocalBackupState).not.toHaveBeenCalled();
});

it("retains ownership even before sync tracking has been written", async () => {
  expect(await prepareBackupDestination("alice", "server")).toBe(true);
  await expect(prepareBackupDestination("bob", "server")).rejects.toThrow(/another account/);
  expect(localStorage.getItem("wingman:workspace-owner")).toBe("alice");
});
