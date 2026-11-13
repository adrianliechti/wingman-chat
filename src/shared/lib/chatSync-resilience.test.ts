import { beforeEach, expect, it, vi } from "vitest";
import type { Chat } from "@/shared/types/chat";
import { ChatSync, stashPendingTarget, type SyncActivity } from "./chatSync";
import { generateDEK } from "./crypto";
import { readLocalChat } from "./localChats";
import { mediaFromDataUrl, userMessage } from "./messages";
import { readJson, readText } from "./opfs-core";
import * as api from "./storeClient";
import { MemoryOpfs } from "./test-support/memoryOpfs";

vi.mock("./storeClient", async (original) => ({
  ServerError: (await original<typeof import("./storeClient")>()).ServerError,
  listChats: vi.fn(),
  readEvents: vi.fn(),
  appendEvents: vi.fn(),
  headBlob: vi.fn(),
  getBlob: vi.fn(),
  putBlob: vi.fn(),
  deleteChat: vi.fn(),
  compactChat: vi.fn(),
}));

const memory = new MemoryOpfs();
const frames: { id: string; seq: number; frame: string }[] = [];
const blobs = new Map<string, Uint8Array>();
const chat = (): Chat => ({
  id: "chat",
  created: new Date("2026-01-01"),
  updated: new Date("2026-01-02"),
  model: null,
  messages: [userMessage("first message")],
});

beforeEach(() => {
  vi.resetAllMocks();
  memory.reset();
  frames.length = 0;
  blobs.clear();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => memory.root } });
  vi.mocked(api.listChats).mockImplementation(async () =>
    frames.length ? [{ id: "chat", headSeq: frames.length, updated: "2026-01-02" }] : [],
  );
  vi.mocked(api.readEvents).mockImplementation(async (_id, after) => frames.filter((frame) => frame.seq > after));
  vi.mocked(api.appendEvents).mockImplementation(async (_id, expected, events) => {
    if (expected !== frames.length) return null;
    events.forEach((event) => frames.push({ ...event, seq: frames.length + 1 }));
    return { newSeq: frames.length };
  });
  vi.mocked(api.headBlob).mockImplementation(async (id) => blobs.has(id));
  vi.mocked(api.putBlob).mockImplementation(async (id, bytes) => {
    blobs.set(id, bytes instanceof Blob ? new Uint8Array(await bytes.arrayBuffer()) : bytes);
  });
  vi.mocked(api.getBlob).mockImplementation(async (id) => blobs.get(id) ?? null);
});

it.each(["restore", "backup"] as const)(
  "keeps a failed %s visible until that direction succeeds, even if the other direction succeeds",
  async (direction) => {
    const sync = await ChatSync.create({ userId: "alice", dek: await generateDEK() });
    let activity!: SyncActivity;
    sync.subscribeActivity((value) => (activity = value));
    const message = `${direction} interrupted`;
    if (direction === "restore") {
      vi.mocked(api.listChats).mockRejectedValueOnce(new Error(message));
      await expect(sync.pull()).rejects.toThrow(message);
      await sync.flushPending();
    } else {
      await stashPendingTarget(chat());
      vi.mocked(api.appendEvents).mockRejectedValueOnce(new Error(message));
      await sync.flushPending();
      await sync.pull();
    }
    expect(activity).toMatchObject({ lastError: message, syncing: false, progress: [] });
    if (direction === "restore") await sync.pull();
    else await sync.flushPending();
    expect(activity.lastError).toBeNull();
  },
);

for (const updating of [false, true]) {
  it.each(["before commit", "lost acknowledgement", "history write", "state write", "snapshot write", "index write"])(
    `recovers ${updating ? "an update" : "an initial upload"} after %s and restart without duplicating messages`,
    async (failure) => {
      const dek = await generateDEK();
      const sync = await ChatSync.create({ userId: "alice", dek });
      const original = chat();
      if (updating) {
        await stashPendingTarget(original);
        await sync.flushPending();
      }
      const value = updating
        ? { ...original, title: "edited offline", messages: [...original.messages, userMessage("second message")] }
        : original;
      await stashPendingTarget(value);
      const previousHead = frames.length;
      const append = vi.mocked(api.appendEvents).getMockImplementation()!;
      if (failure === "before commit" || failure === "lost acknowledgement") {
        vi.mocked(api.appendEvents).mockImplementationOnce(async (...args) => {
          if (failure === "lost acknowledgement") await append(...args);
          throw new Error("connection reset");
        });
      } else {
        const failedPath = {
          "history write": "chats/chat/history.jsonl",
          "state write": "_sync/state.json",
          "snapshot write": "chats/chat/chat.json",
          "index write": "chats/index.json",
        }[failure];
        memory.beforeWrite = async (path) => {
          if (path === failedPath) throw new DOMException("Disk full", "QuotaExceededError");
        };
      }
      let activity!: SyncActivity;
      sync.subscribeActivity((value) => (activity = value));
      // Projection failures reject; transport and checkpoint failures are reported through activity.
      if (failure === "snapshot write" || failure === "index write")
        await expect(sync.flushPending()).rejects.toThrow("Disk full");
      else await sync.flushPending();
      expect(activity).toMatchObject({
        syncing: false,
        progress: [],
        lastError: failure === "before commit" || failure === "lost acknowledgement" ? "connection reset" : "Disk full",
      });
      expect(await readJson("chats/chat/target.json")).toBeDefined();
      expect(frames.length).toBe(previousHead + (failure === "before commit" ? 0 : 1));
      memory.beforeWrite = undefined;

      const restarted = await ChatSync.create({ userId: "alice", dek });
      await restarted.flushPending();
      await restarted.flushPending(); // A further retry must be a no-op.
      expect(frames).toHaveLength(previousHead + 1);
      expect(await readJson("chats/chat/target.json")).toBeUndefined();
      expect(await readLocalChat("chat", false)).toMatchObject(value);
      expect(await readJson("_sync/state.json")).toMatchObject({ heads: { chat: frames.length } });

      // Verify the encrypted remote log independently of the recovered local mirror.
      memory.reset();
      const restored = await ChatSync.create({ userId: "alice", dek });
      await restored.pull();
      expect(await readLocalChat("chat", false)).toMatchObject(value);
      expect((await readLocalChat("chat", false))?.messages).toHaveLength(value.messages.length);
    },
  );
}

it.each([false, true])(
  "restarts an interrupted attachment upload (server committed: %s) before publishing its chat",
  async (committed) => {
    const dek = await generateDEK();
    const value = { ...chat(), messages: [userMessage([mediaFromDataUrl("data:image/png;base64,YWJj")])] };
    await stashPendingTarget(value);
    const put = vi.mocked(api.putBlob).getMockImplementation()!;
    vi.mocked(api.putBlob).mockImplementationOnce(async (...args) => {
      if (committed) await put(...args);
      throw new Error("attachment upload interrupted");
    });
    const sync = await ChatSync.create({ userId: "alice", dek });
    await sync.flushPending();
    expect(api.appendEvents).not.toHaveBeenCalled();
    expect(blobs.size).toBe(committed ? 1 : 0);
    expect(await readJson("chats/chat/target.json")).toBeDefined();

    const restarted = await ChatSync.create({ userId: "alice", dek });
    await restarted.flushPending();
    expect(blobs.size).toBe(1);
    expect(api.putBlob).toHaveBeenCalledTimes(committed ? 1 : 2);
    expect(frames).toHaveLength(1);
    expect(await readJson("chats/chat/target.json")).toBeUndefined();
    memory.reset();
    await (await ChatSync.create({ userId: "alice", dek })).pull();
    expect(await readText(`chats/chat/blobs/${[...blobs.keys()][0]}.bin`)).toBe("abc");
    expect((await readLocalChat("chat", false))?.messages).toHaveLength(1);
  },
);
