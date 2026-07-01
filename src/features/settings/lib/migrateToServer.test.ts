import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSync } from "@/shared/lib/chatSync";
import * as api from "@/shared/lib/storeClient";
import { migrateLocalChatsToServer } from "./migrateToServer";

vi.mock("@/shared/lib/storeClient", () => ({
  listChats: vi.fn(),
}));

const listChats = vi.mocked(api.listChats);

function fakeSync(unsynced: { id: string; updated: string | null }[]) {
  const sync = {
    unsyncedChats: vi.fn(() => unsynced),
    dropUnsyncedChat: vi.fn(async () => {}),
    ensureBlobsUploaded: vi.fn(async () => {}),
    flushPending: vi.fn(async () => {}),
  };
  return { sync, asChatSync: sync as unknown as ChatSync };
}

beforeEach(() => {
  listChats.mockReset();
});

describe("migrateLocalChatsToServer", () => {
  it("does nothing but flush when there are no unsynced chats", async () => {
    const { sync, asChatSync } = fakeSync([]);
    const result = await migrateLocalChatsToServer(asChatSync);
    expect(result).toEqual({ uploaded: 0, dropped: 0 });
    expect(listChats).not.toHaveBeenCalled();
    expect(sync.flushPending).toHaveBeenCalled();
  });

  it("uploads chats the server does not know (union by id)", async () => {
    listChats.mockResolvedValue([{ id: "srv1", headSeq: 3, updated: "2026-06-01T00:00:00Z" }]);
    const { sync, asChatSync } = fakeSync([{ id: "loc1", updated: "2026-01-01T00:00:00Z" }]);

    const result = await migrateLocalChatsToServer(asChatSync);

    expect(result).toEqual({ uploaded: 1, dropped: 0 });
    expect(sync.ensureBlobsUploaded).toHaveBeenCalledWith("loc1");
    expect(sync.dropUnsyncedChat).not.toHaveBeenCalled();
    expect(sync.flushPending).toHaveBeenCalled();
  });

  it("drops the local copy when the server version is newer", async () => {
    listChats.mockResolvedValue([{ id: "c1", headSeq: 5, updated: "2026-06-01T00:00:00Z" }]);
    const { sync, asChatSync } = fakeSync([{ id: "c1", updated: "2026-01-01T00:00:00Z" }]);

    const result = await migrateLocalChatsToServer(asChatSync);

    expect(result).toEqual({ uploaded: 0, dropped: 1 });
    expect(sync.dropUnsyncedChat).toHaveBeenCalledWith("c1");
    expect(sync.ensureBlobsUploaded).not.toHaveBeenCalled();
  });

  it("uploads the local copy when it is newer than the server version", async () => {
    listChats.mockResolvedValue([{ id: "c1", headSeq: 5, updated: "2026-01-01T00:00:00Z" }]);
    const { sync, asChatSync } = fakeSync([{ id: "c1", updated: "2026-06-01T00:00:00Z" }]);

    const result = await migrateLocalChatsToServer(asChatSync);

    expect(result).toEqual({ uploaded: 1, dropped: 0 });
    expect(sync.ensureBlobsUploaded).toHaveBeenCalledWith("c1");
    expect(sync.dropUnsyncedChat).not.toHaveBeenCalled();
  });

  it("drops a local copy with no updated timestamp on collision", async () => {
    listChats.mockResolvedValue([{ id: "c1", headSeq: 5, updated: "2026-01-01T00:00:00Z" }]);
    const { asChatSync } = fakeSync([{ id: "c1", updated: null }]);

    const result = await migrateLocalChatsToServer(asChatSync);

    expect(result).toEqual({ uploaded: 0, dropped: 1 });
  });

  it("handles a mix of union, keep-newer, and drop-older", async () => {
    listChats.mockResolvedValue([
      { id: "older-on-server", headSeq: 1, updated: "2026-01-01T00:00:00Z" },
      { id: "newer-on-server", headSeq: 9, updated: "2026-06-01T00:00:00Z" },
    ]);
    const { sync, asChatSync } = fakeSync([
      { id: "local-only", updated: "2026-03-01T00:00:00Z" },
      { id: "older-on-server", updated: "2026-03-01T00:00:00Z" },
      { id: "newer-on-server", updated: "2026-03-01T00:00:00Z" },
    ]);

    const result = await migrateLocalChatsToServer(asChatSync);

    expect(result).toEqual({ uploaded: 2, dropped: 1 });
    expect(sync.dropUnsyncedChat).toHaveBeenCalledWith("newer-on-server");
  });
});
