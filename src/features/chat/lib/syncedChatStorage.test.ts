import { beforeEach, expect, it, vi } from "vitest";
import { PersistenceQueue } from "@/shared/lib/persistence";
import { syncedChatStorage } from "./syncedChatStorage";

const { initSession, storeChat, removeChat, flushPending } = vi.hoisted(() => ({
  initSession: vi.fn(),
  storeChat: vi.fn(),
  removeChat: vi.fn(),
  flushPending: vi.fn(),
}));

vi.mock("@/shared/lib/storeSession", () => ({ initSession }));
vi.mock("./chatStorage", () => ({ storeChat, removeChat, loadChatIndex: vi.fn(), loadChat: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

it.each(["setup", "locked", "error", "disabled"])(
  "persists local deletions without blocking subsequent saves while backup is %s",
  async (status) => {
    const userId = status === "setup" || status === "locked" ? "user" : undefined;
    initSession.mockResolvedValue({ status, ...(userId ? { userId } : {}) });
    const queue = new PersistenceQueue(vi.fn(), 60_000);
    const save = vi.fn();
    try {
      queue.schedule("deleted", () => syncedChatStorage.remove("deleted"));
      queue.schedule("another", save);
      await queue.flush();
      expect(removeChat).toHaveBeenCalledWith("deleted");
      expect(save).toHaveBeenCalledOnce();
    } finally {
      await queue.stop();
    }
  },
);

it.each(["ready", "upload-only"])("backs up committed local deletions while backup is %s", async (status) => {
  initSession.mockResolvedValue({ status, sync: { flushPending } });
  await syncedChatStorage.remove("deleted");
  await vi.waitFor(() => expect(flushPending).toHaveBeenCalledOnce());
  expect(removeChat).toHaveBeenCalledWith("deleted");
});

it("commits saves and deletions without waiting for stalled initialization", async () => {
  initSession.mockReturnValue(new Promise(() => {}));
  const chat = { id: "chat", created: null, updated: null, model: null, messages: [] };
  const queue = new PersistenceQueue(vi.fn(), 60_000);
  try {
    queue.schedule(chat.id, () => syncedChatStorage.store(chat));
    queue.schedule("deleted", () => syncedChatStorage.remove("deleted"));
    await queue.flush();
    expect(storeChat).toHaveBeenCalledWith(chat);
    expect(removeChat).toHaveBeenCalledWith("deleted");
    expect(storeChat.mock.invocationCallOrder[0]).toBeLessThan(initSession.mock.invocationCallOrder[0]);
  } finally {
    await queue.stop();
  }
});

it("does not start an upload when the local commit fails", async () => {
  storeChat.mockRejectedValueOnce(new Error("disk full"));
  await expect(
    syncedChatStorage.store({ id: "chat", created: null, updated: null, model: null, messages: [] }),
  ).rejects.toThrow("disk full");
  expect(initSession).not.toHaveBeenCalled();
});
