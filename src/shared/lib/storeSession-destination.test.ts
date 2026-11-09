import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Chat } from "@/shared/types/chat";

const mocks = vi.hoisted(() => ({
  stash: vi.fn(),
  stashDeletion: vi.fn(),
  notifyError: vi.fn(),
  reload: vi.fn(),
}));
vi.mock("@/shared/config", () => ({ getConfig: () => ({ store: true }) }));
vi.mock("./backupDestination", () => ({ prepareBackupDestination: vi.fn().mockResolvedValue(false) }));
vi.mock("./backupReset", () => ({ completePendingBackupReset: vi.fn() }));
vi.mock("./storeClient", () => ({
  fetchMe: vi.fn().mockResolvedValue({ id: "alice", backupDestination: "onedrive-app", previousId: "email-user" }),
}));
vi.mock("./chatSync", () => ({
  ChatSync: vi.fn(),
  readLocalChat: vi.fn(),
  readLocalMirror: vi.fn(),
  stashPendingTarget: mocks.stash,
  stashPendingDeletion: mocks.stashDeletion,
}));
vi.mock("./notify", () => ({ notify: { error: mocks.notifyError } }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.stash.mockReset();
  vi.stubGlobal("window", { location: { reload: mocks.reload } });
});
afterEach(() => vi.unstubAllGlobals());

it("lets a queued save waiting on initialization persist before reloading for a changed destination", async () => {
  const { PersistenceQueue, registerPersistenceQueue } = await import("./persistence");
  const { syncedChatStorage } = await import("@/features/chat/lib/syncedChatStorage");
  const queue = new PersistenceQueue(vi.fn(), 60_000);
  const unregister = registerPersistenceQueue(queue);
  const chat = { id: "local-chat" } as Chat;
  try {
    queue.schedule(chat.id, () => syncedChatStorage.store(chat));
    await queue.flush();
    await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalledOnce());
    expect(mocks.stash).toHaveBeenCalledWith(chat);
    const { prepareBackupDestination } = await import("./backupDestination");
    expect(prepareBackupDestination).toHaveBeenCalledWith("alice", "onedrive-app", "email-user");
    expect(mocks.stash.mock.invocationCallOrder[0]).toBeLessThan(mocks.reload.mock.invocationCallOrder[0]);
  } finally {
    unregister();
    await queue.stop();
  }
});

it("keeps the page open if a queued local edit cannot be saved before destination reload", async () => {
  const { PersistenceQueue, registerPersistenceQueue } = await import("./persistence");
  const { syncedChatStorage } = await import("@/features/chat/lib/syncedChatStorage");
  const queue = new PersistenceQueue(vi.fn(), 60_000);
  const unregister = registerPersistenceQueue(queue);
  mocks.stash.mockRejectedValue(new Error("disk full"));
  try {
    queue.schedule("local-chat", () => syncedChatStorage.store({ id: "local-chat" } as Chat));
    await expect(queue.flush()).rejects.toThrow("Some changes could not be saved");
    await vi.waitFor(() => expect(mocks.notifyError).toHaveBeenCalled());
    expect(mocks.reload).not.toHaveBeenCalled();
  } finally {
    unregister();
    await queue.stop();
  }
});

it("keeps deletion ownership available while resolving initialization before a destination reload", async () => {
  const { PersistenceQueue, registerPersistenceQueue } = await import("./persistence");
  const { syncedChatStorage } = await import("@/features/chat/lib/syncedChatStorage");
  const queue = new PersistenceQueue(vi.fn(), 60_000);
  const unregister = registerPersistenceQueue(queue);
  try {
    queue.schedule("removed-chat", () => syncedChatStorage.remove("removed-chat"));
    await queue.flush();
    await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalledOnce());
    expect(mocks.stashDeletion).toHaveBeenCalledWith("removed-chat", "alice");
  } finally {
    unregister();
    await queue.stop();
  }
});
