import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersistenceQueue } from "@/shared/lib/persistence";
import type { Chat } from "@/shared/types/chat";
import { ChatStore } from "./chatStore";
import { chatEntry } from "./chatStorage";

const chat = (id: string): Chat => ({
  id,
  title: id,
  created: null,
  updated: null,
  model: null,
  messages: [{ role: "user", content: [{ type: "text", text: `Body of ${id}` }] }],
});
const storage = {
  index: vi.fn(async () => [chatEntry(chat("one")), chatEntry(chat("two"))]),
  load: vi.fn(async (id: string) => chat(id)),
  store: vi.fn(async (_chat: Chat) => {}),
  remove: vi.fn(async (_id: string) => {}),
};
let queue: PersistenceQueue;
let store: ChatStore;
beforeEach(() => {
  vi.clearAllMocks();
  storage.index.mockReset().mockImplementation(async () => [chatEntry(chat("one")), chatEntry(chat("two"))]);
  storage.store.mockReset().mockResolvedValue();
  storage.load.mockReset().mockImplementation(async (id) => chat(id));
  queue = new PersistenceQueue(vi.fn(), 60_000);
  store = new ChatStore(queue, storage);
});
afterEach(async () => {
  await queue.stop();
});

describe("lazy chat collection", () => {
  it("loads just the index and coalesces selection reads", async () => {
    await Promise.all([store.initialize(), store.initialize()]);
    expect(storage.index).toHaveBeenCalledOnce();
    expect(storage.load).not.toHaveBeenCalled();
    expect(store.getSnapshot().chats[0]).not.toHaveProperty("messages");
    const first = store.loadChat("one");
    expect(store.loadChat("one")).toBe(first);
    await first;
    expect(await store.loadChat("one")).toBe(store.getChat("one"));
    expect(storage.load).toHaveBeenCalledOnce();
    expect(store.getChat("two")).toBeUndefined();
  });

  it("same-event edits see fresh immutable records", async () => {
    const original = await store.loadChat("one");
    store.updateChat("one", () => ({ title: "First" }));
    store.updateChat("one", (current) => ({ customTitle: `${current.title} + second` }));
    await queue.flush();
    expect(original.title).toBe("one");
    expect(store.getChat("one")).toMatchObject({ title: "First", customTitle: "First + second" });
    expect(storage.store).toHaveBeenCalledOnce();
    expect(storage.store).toHaveBeenCalledWith(store.getChat("one"));
  });

  it("edits an unloaded conversation without overwriting its body, and flush waits for that load", async () => {
    let release!: (value: Chat) => void;
    storage.load.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    await store.initialize();
    store.updateChat("one", () => ({ title: "Renamed" }));
    let flushed = false;
    const flushing = queue.flush().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);
    store.updateChat("one", (current) => ({ customTitle: current.title }));
    release(chat("one"));
    await flushing;
    expect(store.getChat("one")).toMatchObject({
      title: "Renamed",
      customTitle: "Renamed",
      messages: chat("one").messages,
    });
    expect(storage.store.mock.lastCall?.[0]).toEqual(store.getChat("one"));
  });

  it("does not resurrect a deleted record when its pending read finishes", async () => {
    let release!: (value: Chat) => void;
    storage.load.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    await store.initialize();
    const loading = store.loadChat("one").catch((error: unknown) => error);
    await store.deleteChat("one");
    release(chat("one"));
    expect(await loading).toBeInstanceOf(Error);
    expect(store.getChat("one")).toBeUndefined();
    expect(store.getSnapshot().chats.map((entry) => entry.id)).toEqual(["two"]);
    expect(storage.store).not.toHaveBeenCalled();
  });

  it("searches unloaded text without filling the conversation cache and includes unsaved edits", async () => {
    await store.initialize();
    expect(await store.searchChats("Body of two", new AbortController().signal)).toEqual(new Set(["two"]));
    expect(store.getChat("two")).toBeUndefined();
    await store.loadChat("one");
    store.updateChat("one", () => ({
      messages: [{ role: "user", content: [{ type: "text", text: "unsaved needle" }] }],
    }));
    expect(await store.searchChats("needle", new AbortController().signal)).toEqual(new Set(["one"]));
    expect(storage.store).not.toHaveBeenCalled();
  });

  it("cancels an obsolete search between manifest reads", async () => {
    await store.initialize();
    const controller = new AbortController();
    storage.load.mockImplementationOnce(async (id) => {
      controller.abort();
      return chat(id);
    });
    await expect(store.searchChats("Body", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(storage.load).toHaveBeenCalledOnce();
  });
  it("does not return a newly created chat that was deleted while its initial write was pending", async () => {
    let release!: () => void;
    storage.store.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const creating = store.createChat();
    const rejected = expect(creating).rejects.toThrow("was deleted");
    const id = store.getSnapshot().chats[0].id;
    await vi.waitFor(() => expect(storage.store).toHaveBeenCalledOnce());
    const deleting = store.deleteChat(id);
    release();
    await Promise.all([rejected, deleting]);
    expect(store.getChat(id)).toBeUndefined();
    expect(store.getSnapshot().chats).toEqual([]);
    expect(storage.remove).toHaveBeenCalledWith(id);
  });

  it("merges a delayed index with local creations, deletions and edits still waiting for their first read", async () => {
    let release!: (entries: ReturnType<typeof chatEntry>[]) => void;
    storage.index.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const initializing = store.initialize();
    const created = await store.createChat();
    await store.deleteChat("two");
    store.updateChat("one", () => ({ title: "renamed" }));
    release([chatEntry(chat("one")), chatEntry(chat("two"))]);
    await initializing;
    expect(store.getSnapshot().chats.map((entry) => entry.id)).toEqual([created.id, "one"]);
    await queue.flush();
    expect(store.getChat("one")).toMatchObject({ title: "renamed", messages: chat("one").messages });
  });

  it("removes earlier matches if a chat is deleted while a later search read is pending", async () => {
    await store.initialize();
    storage.load.mockImplementationOnce(async (id) => {
      await store.deleteChat("one");
      return chat(id);
    });
    expect(await store.searchChats("one", new AbortController().signal)).toEqual(new Set());
  });

  it("retries a failed lazy read without losing queued edits", async () => {
    storage.load.mockRejectedValueOnce(new Error("temporary read error"));
    store.updateChat("one", () => ({ title: "pending rename" }));
    await expect(store.loadChat("one")).rejects.toThrow("temporary read error");
    await queue.flush();
    expect(store.getChat("one")).toMatchObject({ title: "pending rename", messages: chat("one").messages });
    expect(storage.store).toHaveBeenCalledWith(store.getChat("one"));
  });
});
