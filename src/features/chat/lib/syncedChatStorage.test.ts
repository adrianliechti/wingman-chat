import { beforeEach, expect, it, vi } from "vitest";
import { PersistenceQueue } from "@/shared/lib/persistence";
import { syncedChatStorage } from "./syncedChatStorage";

const { initSession, stashPendingDeletion, deleteChat } = vi.hoisted(() => ({
  initSession: vi.fn(),
  stashPendingDeletion: vi.fn(),
  deleteChat: vi.fn(),
}));

vi.mock("@/shared/lib/storeSession", () => ({ initSession }));
vi.mock("@/shared/lib/chatSync", () => ({ stashPendingDeletion }));

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
      expect(stashPendingDeletion).toHaveBeenCalledWith("deleted", userId);
      expect(save).toHaveBeenCalledOnce();
    } finally {
      await queue.stop();
    }
  },
);

it.each(["ready", "upload-only"])("uses the active sync engine while backup is %s", async (status) => {
  initSession.mockResolvedValue({ status, sync: { deleteChat } });
  await syncedChatStorage.remove("deleted");
  expect(deleteChat).toHaveBeenCalledWith("deleted");
  expect(stashPendingDeletion).not.toHaveBeenCalled();
});
