import { beforeEach, expect, it, vi } from "vitest";
import type { Chat } from "@/shared/types/chat";
import { ChatSync, stashPendingTarget, type SyncActivity } from "./chatSync";
import { readLocalChat } from "./localChats";
import { mediaFromDataUrl, userMessage } from "./messages";
import { readJson, readText } from "./opfs-core";
import * as api from "./storeClient";
import { BackupBusyError } from "./backupBusy";
import { MemoryOpfs } from "./test-support/memoryOpfs";
import { generateStoreKey } from "./test-support/storeKey";

vi.mock("./storeClient", async (original) => ({
  ServerError: (await original<typeof import("./storeClient")>()).ServerError,
  listChats: vi.fn(),
  readEvents: vi.fn(),
  appendEvents: vi.fn(),
  appendChatBatch: vi.fn(),
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
  vi.mocked(api.appendChatBatch).mockResolvedValue(null);
  vi.mocked(api.headBlob).mockImplementation(async (id) => blobs.has(id));
  vi.mocked(api.putBlob).mockImplementation(async (id, bytes) => {
    blobs.set(id, bytes instanceof Blob ? new Uint8Array(await bytes.arrayBuffer()) : bytes);
  });
  vi.mocked(api.getBlob).mockImplementation(async (id) => blobs.get(id) ?? null);
});

it.each(["restore", "backup"] as const)(
  "keeps a failed %s visible until that direction succeeds, even if the other direction succeeds",
  async (direction) => {
    const sync = await ChatSync.create({ userId: "alice", accountId: "alice", dek: await generateStoreKey() });
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

it("keeps a chat pending without an error while the backend is busy, then retries", async () => {
  const sync = await ChatSync.create({ userId: "alice", accountId: "alice", dek: await generateStoreKey() });
  let activity!: SyncActivity;
  sync.subscribeActivity((value) => (activity = value));
  await stashPendingTarget(chat());
  vi.mocked(api.appendEvents).mockRejectedValueOnce(new BackupBusyError("Backup uploads are busy.", 20));

  await sync.flushPending();
  expect(activity.lastError ?? null).toBeNull();
  expect(frames).toHaveLength(0);
  expect(await readJson("chats/chat/target.json")).toBeDefined();

  await vi.waitFor(() => expect(frames).toHaveLength(1));
  await vi.waitFor(() => expect(activity).toMatchObject({ lastError: null, syncing: false }));
});

for (const updating of [false, true]) {
  it.each(["before commit", "lost acknowledgement", "history write", "state write", "snapshot write", "index write"])(
    `recovers ${updating ? "an update" : "an initial upload"} after %s and restart without duplicating messages`,
    async (failure) => {
      const dek = await generateStoreKey();
      const sync = await ChatSync.create({ userId: "alice", accountId: "alice", dek });
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

      const restarted = await ChatSync.create({ userId: "alice", accountId: "alice", dek });
      await restarted.flushPending();
      await restarted.flushPending(); // A further retry must be a no-op.
      expect(frames).toHaveLength(previousHead + 1);
      expect(await readJson("chats/chat/target.json")).toBeUndefined();
      expect(await readLocalChat("chat", false)).toMatchObject(value);
      expect(await readJson("_sync/state.json")).toMatchObject({ heads: { chat: frames.length } });

      // Verify the encrypted remote log independently of the recovered local mirror.
      memory.reset();
      const restored = await ChatSync.create({ userId: "alice", accountId: "alice", dek });
      await restored.pull();
      expect(await readLocalChat("chat", false)).toMatchObject(value);
      expect((await readLocalChat("chat", false))?.messages).toHaveLength(value.messages.length);
    },
  );
}

it("re-uploads a chat whose backup lost events this device already confirmed", async () => {
  const dek = await generateStoreKey();
  const sync = await ChatSync.create({ userId: "alice", accountId: "alice", dek });
  const original = chat();
  await stashPendingTarget(original);
  await sync.flushPending();
  await stashPendingTarget({ ...original, messages: [...original.messages, userMessage("second message")] });
  await sync.flushPending();
  expect(frames).toHaveLength(2);

  frames.length = 1;
  const value = { ...original, messages: [...original.messages, userMessage("second message"), userMessage("third")] };
  await stashPendingTarget(value);
  let activity!: SyncActivity;
  sync.subscribeActivity((next) => (activity = next));
  await sync.flushPending();
  expect(activity.lastError).toBeNull();
  expect(await readJson("chats/chat/target.json")).toBeUndefined();
  expect(frames).toHaveLength(2);

  memory.reset();
  await (await ChatSync.create({ userId: "alice", accountId: "alice", dek })).pull();
  expect(await readLocalChat("chat", false)).toMatchObject(value);
  expect((await readLocalChat("chat", false))?.messages).toHaveLength(3);
});

it("keeps another device's version as a conflicted copy when a behind backup diverged", async () => {
  const logs = new Map<string, { id: string; seq: number; frame: string }[]>();
  vi.mocked(api.listChats).mockImplementation(async () =>
    [...logs].map(([id, log]) => ({ id, headSeq: log.length, updated: "2026-01-02" })),
  );
  vi.mocked(api.readEvents).mockImplementation(async (id, after) =>
    (logs.get(id) ?? []).filter((frame) => frame.seq > after),
  );
  vi.mocked(api.appendEvents).mockImplementation(async (id, expected, events) => {
    const log = logs.get(id) ?? [];
    if (expected !== log.length) return null;
    events.forEach((event) => log.push({ ...event, seq: log.length + 1 }));
    logs.set(id, log);
    return { newSeq: log.length };
  });
  const dek = await generateStoreKey();

  const elsewhere = userMessage("other device");
  const other = await ChatSync.create({ userId: "alice", accountId: "alice", dek });
  await stashPendingTarget({ ...chat(), messages: [elsewhere] });
  await other.flushPending();
  const foreign = logs.get("chat")!;
  logs.clear();
  memory.reset();

  const sync = await ChatSync.create({ userId: "alice", accountId: "alice", dek });
  const [first, second, third] = [userMessage("first message"), userMessage("second"), userMessage("third")];
  await stashPendingTarget({ ...chat(), messages: [first] });
  await sync.flushPending();
  await stashPendingTarget({ ...chat(), messages: [first, second] });
  await sync.flushPending();
  expect(logs.get("chat")).toHaveLength(2);

  logs.set("chat", [...foreign]);
  const value = { ...chat(), messages: [first, second, third] };
  await stashPendingTarget(value);
  let activity!: SyncActivity;
  sync.subscribeActivity((next) => (activity = next));
  await sync.flushPending();
  expect(activity.lastError).toBeNull();
  expect(await readJson("chats/chat/target.json")).toBeUndefined();

  memory.reset();
  await (await ChatSync.create({ userId: "alice", accountId: "alice", dek })).pull();
  expect(await readLocalChat("chat", false)).toMatchObject(value);
  const copies = [...logs.keys()].filter((id) => id.startsWith("conflict-"));
  expect(copies).toHaveLength(1);
  expect((await readLocalChat(copies[0], false))?.messages).toMatchObject([elsewhere]);
});

it.each([false, true])(
  "restarts an interrupted attachment upload (server committed: %s) before publishing its chat",
  async (committed) => {
    const dek = await generateStoreKey();
    const value = { ...chat(), messages: [userMessage([mediaFromDataUrl("data:image/png;base64,YWJj")])] };
    await stashPendingTarget(value);
    const put = vi.mocked(api.putBlob).getMockImplementation()!;
    vi.mocked(api.putBlob).mockImplementationOnce(async (...args) => {
      if (committed) await put(...args);
      throw new Error("attachment upload interrupted");
    });
    const sync = await ChatSync.create({ userId: "alice", accountId: "alice", dek });
    await sync.flushPending();
    expect(api.appendEvents).not.toHaveBeenCalled();
    expect(blobs.size).toBe(committed ? 1 : 0);
    expect(await readJson("chats/chat/target.json")).toBeDefined();

    const restarted = await ChatSync.create({ userId: "alice", accountId: "alice", dek });
    await restarted.flushPending();
    expect(blobs.size).toBe(1);
    expect(api.putBlob).toHaveBeenCalledTimes(committed ? 1 : 2);
    expect(frames).toHaveLength(1);
    expect(await readJson("chats/chat/target.json")).toBeUndefined();
    memory.reset();
    await (await ChatSync.create({ userId: "alice", accountId: "alice", dek })).pull();
    expect(await readText(`chats/chat/blobs/${[...blobs.keys()][0]}.bin`)).toBe("abc");
    expect((await readLocalChat("chat", false))?.messages).toHaveLength(1);
  },
);
