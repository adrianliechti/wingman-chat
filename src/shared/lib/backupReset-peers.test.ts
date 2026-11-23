import { beforeEach, expect, it, vi } from "vitest";
import { BACKUP_GENERATION_KEY, invalidateBackupSessions } from "./backupLifecycle";
import { fenceStorage } from "./opfs-core";
import { flushPersistence, stopPersistence } from "./persistence";

vi.mock("./opfs-core", () => ({ fenceStorage: vi.fn(), readJson: vi.fn(), writeJson: vi.fn() }));
vi.mock("./persistence", () => ({
  flushPersistence: vi.fn(async () => {}),
  stopPersistence: vi.fn(async () => {}),
  withPersistenceLock: (_key: string, operation: () => Promise<void>) => operation(),
}));
vi.mock("./chatSync", () => ({ resetLocalBackupState: vi.fn() }));
vi.mock("./rememberedBackup", () => ({ forgetBackup: vi.fn() }));

const reload = vi.fn();
let onStorage: ((event: { key: string; oldValue: string | null; newValue: string | null }) => void) | undefined;

beforeEach(async () => {
  vi.clearAllMocks();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal("window", {
    addEventListener: (type: string, listener: typeof onStorage) => {
      if (type === "storage") onStorage = listener;
    },
    location: { reload },
  });
  vi.resetModules();
  await import("./backupReset");
});

const notifyPeer = () =>
  onStorage!({ key: BACKUP_GENERATION_KEY, oldValue: null, newValue: localStorage.getItem(BACKUP_GENERATION_KEY) });

it("drops a peer tab's pending saves instead of flushing them into a storage wipe", async () => {
  invalidateBackupSessions(true);
  notifyPeer();
  await vi.waitFor(() => expect(reload).toHaveBeenCalled());
  expect(vi.mocked(fenceStorage)).toHaveBeenCalled();
  expect(vi.mocked(stopPersistence)).toHaveBeenCalled();
  expect(vi.mocked(flushPersistence)).not.toHaveBeenCalled();
});

it("still saves a peer tab's pending edits when backup settings change", async () => {
  invalidateBackupSessions(true);
  invalidateBackupSessions();
  notifyPeer();
  await vi.waitFor(() => expect(reload).toHaveBeenCalled());
  expect(vi.mocked(flushPersistence)).toHaveBeenCalled();
  expect(vi.mocked(fenceStorage)).not.toHaveBeenCalled();
});
