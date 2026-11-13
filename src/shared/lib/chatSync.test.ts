import { readLocalChat, readLocalMirror } from "./localChats";
import { beginChatBackupPause, finishChatBackupPause } from "./chatBackupActivity";
import { beforeEach, expect, it, vi } from "vitest";
import {
  ChatSync,
  type SyncActivity,
  resetLocalBackupState,
  stashPendingDeletion,
  stashPendingTarget,
} from "./chatSync";
import { decryptEvent, encryptBlob, encryptEvent, generateDEK, hashFrame, ZERO_HASH } from "./crypto";
import { mediaFromDataUrl, userMessage } from "./messages";
import { collectChatBlobIds, extractChatBlobs } from "./opfs-chat";
import { readJson, readText, writeJson, writeText } from "./opfs-core";
import * as opfs from "./opfs-core";
import * as api from "./storeClient";
import { MemoryOpfs } from "./test-support/memoryOpfs";
import { diffChat, encodeLines } from "./chatLog";
import { encodeHistory, readChatHistory } from "./chatHistoryStorage";
import type { Chat } from "@/shared/types/chat";

vi.mock("./storeClient", () => ({
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

/** Web Locks with real exclusion; shared requests (the reset fence) run concurrently. */
function stubWebLocks(): void {
  const locks = new Map<string, Promise<unknown>>();
  const request = (name: string, options: unknown, callback?: () => Promise<unknown>) => {
    const fn = typeof options === "function" ? (options as () => Promise<unknown>) : callback!;
    if (typeof options === "object" && options && "mode" in options && options.mode === "shared") return fn();
    const result = (locks.get(name) ?? Promise.resolve()).then(fn, fn);
    locks.set(
      name,
      result.catch(() => {}),
    );
    return result;
  };
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => memory.root }, locks: { request } });
}
const chat = (): Chat => ({
  id: "chat",
  created: new Date("2026-01-01"),
  updated: new Date("2026-01-02"),
  model: null,
  messages: [userMessage("hello")],
  resume: { resumeState: { threadId: "chat", runId: "run" } },
  metadata: { classification: { category: "coding" } },
});

beforeEach(() => {
  memory.reset();
  vi.resetAllMocks();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => memory.root } });
  vi.mocked(api.listChats).mockResolvedValue([]);
  vi.mocked(api.readEvents).mockResolvedValue([]);
  vi.mocked(api.appendEvents).mockImplementation(async (_id, seq, events) => ({ newSeq: seq + events.length }));
  vi.mocked(api.headBlob).mockResolvedValue(true);
});

it("expires an incoming old backup without reviving its chat or draft", async () => {
  const dek = await generateDEK();
  const old = { ...chat(), updated: new Date("2000-01-01") };
  const frame = await encryptEvent(
    dek,
    {
      prevHash: ZERO_HASH,
      body: diffChat(null, await extractChatBlobs(old)),
    },
    "user",
    old.id,
    1,
  );
  vi.mocked(api.listChats).mockResolvedValue([{ id: old.id, headSeq: 1, updated: "2000-01-01" }]);
  vi.mocked(api.readEvents).mockResolvedValue([{ seq: 1, id: "event", frame }]);
  await writeJson("drafts/chat-chat/draft.json", { content: "old draft" });
  const sync = await ChatSync.create({ userId: "user", dek, retentionDays: 1 });
  expect(await sync.pull()).toEqual([]);
  expect(await readLocalChat(old.id, false)).toBeUndefined();
  expect(await readJson("drafts/chat-chat/draft.json")).toBeUndefined();
  await vi.waitFor(() => expect(api.deleteChat).toHaveBeenCalledWith(old.id));
});

it("picks up another locally committed chat while an earlier upload is in flight", async () => {
  stubWebLocks();
  const sync = await ChatSync.create({ userId: "user", dek: await generateDEK() });
  let release!: () => void;
  vi.mocked(api.appendEvents).mockImplementationOnce(async (_id, seq, events) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { newSeq: seq + events.length };
  });
  await stashPendingTarget({ ...chat(), id: "first" });
  const posting = sync.flushPending();
  await vi.waitFor(() => expect(release).toBeDefined());
  await stashPendingTarget({ ...chat(), id: "second" });
  await sync.flushPending();
  release();
  await posting;
  await vi.waitFor(async () => {
    expect(await readJson("chats/second/target.json")).toBeUndefined();
    expect(api.appendEvents).toHaveBeenCalledWith("second", 0, expect.any(Array));
  });
});

it("reports completed chats during initial backup and clears progress afterwards", async () => {
  for (const id of ["first", "second"]) {
    await writeJson(`chats/${id}/chat.json`, await extractChatBlobs({ ...chat(), id }));
  }
  const sync = await ChatSync.create({ userId: "user", dek: await generateDEK() });
  const activity: SyncActivity[] = [];
  sync.subscribeActivity((value) => activity.push(value));
  await sync.flushPending();
  expect(
    activity.some((a) => a.progress.some((p) => p.direction === "backup" && p.total === 2 && p.completed === 0)),
  ).toBe(true);
  expect(
    activity.some((a) => a.progress.some((p) => p.direction === "backup" && p.total === 2 && p.completed === 1)),
  ).toBe(true);
  expect(activity.at(-1)).toMatchObject({ syncing: false, progress: [], pendingCount: 0 });
});

it("reports restored chats and clears progress when a remote read fails", async () => {
  const dek = await generateDEK();
  const frame = await encryptEvent(
    dek,
    { prevHash: ZERO_HASH, body: [{ type: "init", id: "first", created: "2026-01-01", model: null }] },
    "user",
    "first",
    1,
  );
  vi.mocked(api.listChats).mockResolvedValue([
    { id: "first", headSeq: 1, updated: "2026-01-01" },
    { id: "second", headSeq: 1, updated: "2026-01-01" },
  ]);
  let fail!: (reason: Error) => void;
  vi.mocked(api.readEvents).mockImplementation(async (id) =>
    id === "first"
      ? [{ id: "event", seq: 1, frame }]
      : new Promise((_, reject) => {
          fail = reject;
        }),
  );
  const sync = await ChatSync.create({ userId: "user", dek });
  const activity: SyncActivity[] = [];
  sync.subscribeActivity((value) => activity.push(value));
  const pull = sync.pull();
  await vi.waitFor(() =>
    expect(
      activity.some((a) => a.progress.some((p) => p.direction === "restore" && p.total === 2 && p.completed === 1)),
    ).toBe(true),
  );
  fail(new Error("download interrupted"));
  await expect(pull).rejects.toThrow("download interrupted");
  expect(activity.at(-1)).toMatchObject({ syncing: false, progress: [], lastError: "download interrupted" });
});

it("resets backup baselines while preserving chats, pending edits, attachments, and workspace files", async () => {
  const sync = await ChatSync.create({ userId: "user", dek: await generateDEK() });
  const value = chat();
  await sync.saveChat(value);
  await vi.waitFor(async () => expect(await readJson("chats/chat/target.json")).toBeUndefined());
  await writeText("chats/chat/blobs/attachment", "local attachment");
  await writeText("agents/local/AGENTS.md", "local file");
  await writeJson("_sync/upload-key.json", { publicKey: "old key" });
  await writeJson("_sync/files.json", { entries: { old: {} } });
  await resetLocalBackupState();
  expect(await readLocalChat("chat", false)).toMatchObject(value);
  expect(await readText("chats/chat/history.jsonl")).toBeUndefined();
  expect(await readText("chats/chat/blobs/attachment")).toBe("local attachment");
  expect(await readText("agents/local/AGENTS.md")).toBe("local file");
  expect(await readJson("_sync/upload-key.json")).toBeUndefined();
  expect(await readJson("_sync/files.json")).toBeUndefined();
  vi.mocked(api.appendEvents).mockClear();
  const fresh = await ChatSync.create({ userId: "user", dek: await generateDEK() });
  await fresh.flushPending();
  expect(api.appendEvents).toHaveBeenCalledWith("chat", 0, expect.any(Array));
});

it("saves and reloads the native transcript, resume pointer and metadata through the encrypted log", async () => {
  const dek = await generateDEK();
  const sync = await ChatSync.create({ userId: "user", dek });
  const value = chat();
  value.projectId = "project";
  value.agentId = "agent";
  await sync.saveChat(value);
  await vi.waitFor(async () => {
    expect(api.appendEvents).toHaveBeenCalledOnce();
    expect(await readJson("chats/chat/target.json")).toBeUndefined();
  });
  expect(await readLocalChat("chat", false)).toMatchObject(value);
  const fresh = await ChatSync.create({ userId: "user", dek });
  vi.mocked(api.listChats).mockResolvedValue([{ id: "chat", headSeq: 1, updated: "2026-01-02" }]);
  expect(await fresh.pull()).toMatchObject([value]);
});

for (const reload of [false, true]) {
  it.each(["_sync/state.json", "chats/chat/chat.json", "chats/index.json"])(
    `recovers a downloaded delta exactly once after a failed %s write ${reload ? "and reload" : "on retry"}`,
    async (failedPath) => {
      const dek = await generateDEK();
      const original = await extractChatBlobs(chat());
      const updated = { ...original, title: "remote update", messages: [...original.messages, userMessage("two")] };
      const first = await encryptEvent(dek, { prevHash: ZERO_HASH, body: diffChat(null, original) }, "user", "chat", 1);
      const second = await encryptEvent(
        dek,
        { prevHash: await hashFrame(first), body: diffChat(original, updated) },
        "user",
        "chat",
        2,
      );
      vi.mocked(api.listChats).mockResolvedValue([{ id: "chat", headSeq: 1, updated: "2026-01-02" }]);
      vi.mocked(api.readEvents).mockResolvedValue([{ seq: 1, id: "first", frame: first }]);
      const sync = await ChatSync.create({ userId: "user", dek });
      await sync.pull();

      vi.mocked(api.listChats).mockResolvedValue([{ id: "chat", headSeq: 2, updated: "2026-01-02" }]);
      vi.mocked(api.readEvents).mockResolvedValue([{ seq: 2, id: "second", frame: second }]);
      memory.beforeWrite = async (path) => {
        if (path === failedPath) throw new Error("disk failure");
      };
      await expect(sync.pull()).rejects.toThrow("disk failure");
      memory.beforeWrite = undefined;

      const fresh = reload ? await ChatSync.create({ userId: "user", dek }) : sync;
      expect(await fresh.pull()).toMatchObject([{ title: updated.title, messages: updated.messages }]);
      expect((await readLocalChat("chat", false))?.messages).toHaveLength(2);
      expect(await readJson("_sync/state.json")).toMatchObject({ heads: { chat: 2 } });
      expect(await opfs.readIndex("chats")).toMatchObject([{ id: "chat", title: updated.title }]);
    },
  );
}

it("reads older histories whose final message is larger than the checkpoint read window", async () => {
  const value = { ...chat(), messages: [userMessage("large older message ".repeat(1000))] };
  const entries = diffChat(null, await extractChatBlobs(value));
  await writeText("chats/chat/history.jsonl", encodeLines(entries));
  await writeJson("_sync/state.json", { userId: "user", heads: { chat: 1 }, lastFrameHash: { chat: ZERO_HASH } });
  vi.mocked(api.listChats).mockResolvedValue([{ id: "chat", headSeq: 1, updated: "2026-01-02" }]);
  const sync = await ChatSync.create({ userId: "user", dek: await generateDEK() });
  expect(await sync.pull()).toMatchObject([value]);
  expect(await readLocalChat("chat", false)).toMatchObject(value);
});

it("recovers an acknowledged upload after its checkpoint cache fails without appending the message twice", async () => {
  const dek = await generateDEK();
  const sync = await ChatSync.create({ userId: "user", dek });
  await stashPendingTarget(chat());
  await sync.flushPending();
  const updated = { ...chat(), messages: [...chat().messages, userMessage("two")] };
  await stashPendingTarget(updated);
  memory.beforeWrite = async (path) => {
    if (path === "_sync/state.json") throw new Error("disk failure");
  };
  await sync.flushPending();
  expect(await readJson("chats/chat/target.json")).toBeDefined();
  memory.beforeWrite = undefined;
  const fresh = await ChatSync.create({ userId: "user", dek });
  await fresh.flushPending();
  expect(api.appendEvents).toHaveBeenCalledTimes(2);
  expect((await readLocalChat("chat", false))?.messages).toEqual(updated.messages);
  expect(await readJson("chats/chat/target.json")).toBeUndefined();
});

it("promotes a flat local chat into the backup outbox and keeps its original bytes recoverable", async () => {
  const value = chat();
  const stored = await extractChatBlobs(value);
  memory.put("chats/chat.json", JSON.stringify(stored));
  await opfs.upsertIndexEntry("chats", { id: "chat", updated: "2026-01-02" });
  const sync = await ChatSync.create({ userId: "user", dek: await generateDEK() });
  expect(await readLocalChat("chat", false)).toMatchObject(value);
  expect(await readText("chats/chat/chat.legacy.json")).toBe(JSON.stringify(stored));
  expect(await readText("chats/chat.json")).toBeUndefined();
  await sync.flushPending();
  expect(api.appendEvents).toHaveBeenCalledWith("chat", 0, expect.any(Array));
});

it("keeps a pending edit when promoting a local-only chat", async () => {
  const stored = await extractChatBlobs(chat());
  memory.put("chats/chat/chat.json", JSON.stringify({ ...stored, title: "older" }));
  memory.put("chats/chat/target.json", JSON.stringify({ ...stored, title: "pending" }));
  const sync = await ChatSync.create({ userId: "user", dek: await generateDEK() });
  expect(await sync.pull()).toMatchObject([{ title: "pending", resume: chat().resume }]);
  expect(await readLocalMirror(false)).toMatchObject([{ title: "pending" }]);
});

it("uploads a chat with only its public key and defers conflicting server changes until restore", async () => {
  const { generateBackupKeys } = await import("./backupCrypto");
  const pair = await generateBackupKeys();
  const key = { kid: 1, backup: { publicKey: pair.publicKey } };
  const sync = await ChatSync.create({ userId: "user", dek: key });
  await sync.saveChat(chat());
  await vi.waitFor(async () => expect(await readJson("chats/chat/target.json")).toBeUndefined());
  const posted = vi.mocked(api.appendEvents).mock.calls[0][2][0];
  const restoreKey = { ...(await generateDEK()), backup: { publicKey: pair.publicKey, privateKey: pair.privateKey } };
  expect(await decryptEvent(restoreKey, posted.frame, "user", "chat", 1)).toMatchObject({
    body: [{ type: "init" }, {}, {}],
  });
  await expect(sync.pull()).rejects.toThrow(/Unlock/);
  vi.mocked(api.appendEvents).mockResolvedValue(null);
  await sync.saveChat({ ...chat(), title: "offline edit" });
  await vi.waitFor(() => expect(api.appendEvents).toHaveBeenCalledTimes(2), { timeout: 30_000 });
  expect(api.readEvents).not.toHaveBeenCalled();
  expect(api.listChats).not.toHaveBeenCalled();
  expect(await readJson("chats/chat/target.json")).toMatchObject({ title: "offline edit" });
  expect((await readLocalChat("chat", false))?.title).toBe("offline edit");
});

it("journals local chat deletions without deleting server backups while restore is locked", async () => {
  const { generateBackupKeys } = await import("./backupCrypto");
  const pair = await generateBackupKeys();
  const sync = await ChatSync.create({ userId: "user", dek: { kid: 1, backup: { publicKey: pair.publicKey } } });
  await sync.saveChat(chat());
  await vi.waitFor(async () => expect(await readJson("chats/chat/target.json")).toBeUndefined());
  await sync.deleteChat("chat");
  await sync.flushPending();
  expect(api.deleteChat).not.toHaveBeenCalled();
  expect(await readJson("_sync/deletes/u-user/chat.json")).toMatchObject({ id: "chat", token: expect.any(String) });
});

it("keeps local chat deletion available before backup protection setup", async () => {
  memory.put("chats/chat/chat.json", JSON.stringify(await extractChatBlobs(chat())));
  await stashPendingDeletion("chat", "user");
  expect(await readLocalChat("chat")).toBeUndefined();
  expect(await readJson("_sync/deletes/u-user/chat.json")).toMatchObject({ id: "chat", token: expect.any(String) });
  expect(api.appendEvents).not.toHaveBeenCalled();
  expect(api.deleteChat).not.toHaveBeenCalled();
});

it("journals offline deletions under the persisted owner when session initialization fails", async () => {
  memory.put("chats/chat/chat.json", JSON.stringify(await extractChatBlobs(chat())));
  await writeJson("_sync/state.json", { userId: "user", heads: { chat: 1 }, lastFrameHash: { chat: "hash" } });
  await stashPendingDeletion("chat");
  expect(await readLocalChat("chat")).toBeUndefined();
  expect(await readJson("_sync/state.json")).toMatchObject({
    userId: "user",
    heads: {},
    lastFrameHash: {},
  });
  expect(await readJson("_sync/deletes/u-user/chat.json")).toMatchObject({ id: "chat", token: expect.any(String) });
});

it("deletes a never-synced local chat without inventing an account owner", async () => {
  memory.put("chats/chat/chat.json", JSON.stringify(await extractChatBlobs(chat())));
  await stashPendingDeletion("chat");
  expect(await readLocalChat("chat")).toBeUndefined();
  expect(await readJson("_sync/state.json")).toBeUndefined();
});

it("retains deletions made by stale tabs offline for a later session", async () => {
  const dek = await generateDEK();
  const first = await ChatSync.create({ userId: "user", dek });
  const second = await ChatSync.create({ userId: "user", dek });
  vi.mocked(api.deleteChat).mockRejectedValue(new Error("offline"));
  await first.deleteChat("first");
  await second.deleteChat("second");
  await vi.waitFor(async () => {
    expect(await readJson("_sync/deletes/u-user/first.json")).toBeDefined();
    expect(await readJson("_sync/deletes/u-user/second.json")).toBeDefined();
  });
  vi.mocked(api.deleteChat).mockResolvedValue(undefined);
  const fresh = await ChatSync.create({ userId: "user", dek });
  await fresh.flushPending();
  expect(api.deleteChat).toHaveBeenCalledWith("first");
  expect(api.deleteChat).toHaveBeenCalledWith("second");
  expect(await readJson("_sync/deletes/u-user/first.json")).toBeUndefined();
  expect(await readJson("_sync/deletes/u-user/second.json")).toBeUndefined();
});

it("journals concurrent deletions with a shared backup lock", async () => {
  stubWebLocks();
  await Promise.all([stashPendingDeletion("first", "user"), stashPendingDeletion("second", "user")]);
  expect(await readJson("_sync/deletes/u-user/first.json")).toMatchObject({ id: "first" });
  expect(await readJson("_sync/deletes/u-user/second.json")).toMatchObject({ id: "second" });
});

it("keeps a replacement deletion when an earlier request is acknowledged", async () => {
  const sync = await ChatSync.create({ userId: "user", dek: await generateDEK() });
  await stashPendingDeletion("chat", "user");
  let release!: () => void;
  vi.mocked(api.deleteChat)
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    )
    .mockRejectedValue(new Error("offline"));
  const flushing = sync.flushPending();
  await vi.waitFor(() => expect(release).toBeDefined());
  const old = await readJson<{ token: string }>("_sync/deletes/u-user/chat.json");
  await writeJson("_sync/deletes/u-user/chat.json", { id: "chat", token: "replacement" });
  const replacement = await readJson<{ token: string }>("_sync/deletes/u-user/chat.json");
  expect(replacement?.token).not.toBe(old?.token);
  release();
  await flushing;
  expect(await readJson("_sync/deletes/u-user/chat.json")).toEqual(replacement);
});

it("keeps streaming snapshots local and uploads only the final transcript after request completion", async () => {
  const sync = await ChatSync.create({ userId: "user", dek: await generateDEK() });
  const release = beginChatBackupPause("chat");
  try {
    for (const text of ["one", "one two", "one two three"]) {
      await sync.saveChat({ ...chat(), messages: [userMessage(text)] });
      await sync.flushPending(); // periodic/manual flushes must also respect the active stream.
    }
    expect(api.appendEvents).not.toHaveBeenCalled();
    expect((await readLocalChat("chat", false))?.messages[0].parts[0]).toMatchObject({ content: "one two three" });
  } finally {
    await finishChatBackupPause(release);
  }
  await sync.flushPending();
  expect(api.appendEvents).toHaveBeenCalledOnce();
});

it("defers an upload if streaming starts while event encryption is still pending", async () => {
  const cryptoModule = await import("./crypto");
  const encrypt = cryptoModule.encryptEvent;
  let release: (() => void) | undefined;
  const spy = vi.spyOn(cryptoModule, "encryptEvent").mockImplementationOnce(async (...args) => {
    release = beginChatBackupPause("chat");
    return encrypt(...args);
  });
  const sync = await ChatSync.create({ userId: "user", dek: await generateDEK() });
  let syncing = false;
  const unsubscribe = sync.subscribeActivity((activity) => {
    syncing = activity.syncing;
  });
  try {
    await sync.saveChat(chat());
    await vi.waitFor(() => {
      expect(spy).toHaveBeenCalled();
      expect(syncing).toBe(false);
    });
    expect(api.appendEvents).not.toHaveBeenCalled();
    expect(await readJson("chats/chat/target.json")).toBeDefined();
  } finally {
    spy.mockRestore();
    unsubscribe();
    if (release) await finishChatBackupPause(release);
  }
  await sync.flushPending();
  expect(api.appendEvents).toHaveBeenCalledOnce();
});

it("preserves offline edits and attachments when another device deletes the server chat", async () => {
  const dek = await generateDEK();
  const sync = await ChatSync.create({ userId: "user", dek });
  await sync.saveChat(chat());
  await vi.waitFor(async () => expect(await readJson("chats/chat/target.json")).toBeUndefined());
  memory.put("chats/chat/blobs/attachment.bin", "local attachment");
  const release = beginChatBackupPause("chat");
  try {
    await sync.saveChat({ ...chat(), title: "offline edit" });
    expect(await sync.pull()).toMatchObject([{ title: "offline edit" }]);
    expect(await readText("chats/chat/history.jsonl")).toBeUndefined();
    expect(await readText("chats/chat/blobs/attachment.bin")).toBe("local attachment");
    expect(await readJson("_sync/state.json")).toMatchObject({ heads: {}, lastFrameHash: {} });
  } finally {
    await finishChatBackupPause(release);
  }
  // Pending data must also survive a reload before it reaches the server.
  const fresh = await ChatSync.create({ userId: "user", dek });
  vi.mocked(api.appendEvents).mockClear();
  await fresh.flushPending();
  expect(api.appendEvents).toHaveBeenCalledWith("chat", 0, expect.any(Array));
  const posted = vi.mocked(api.appendEvents).mock.calls[0][2][0];
  expect(await decryptEvent(dek, posted.frame, "user", "chat", 1)).toMatchObject({
    body: [{ type: "init" }, { title: "offline edit" }, { type: "message" }],
  });
});

it("applies remote deletion to an unchanged local chat without resurrecting it", async () => {
  const sync = await ChatSync.create({ userId: "user", dek: await generateDEK() });
  await sync.saveChat(chat());
  await vi.waitFor(async () => expect(await readJson("chats/chat/target.json")).toBeUndefined());
  vi.mocked(api.appendEvents).mockClear();
  expect(await sync.pull()).toEqual([]);
  expect(await readLocalChat("chat")).toBeUndefined();
  await sync.flushPending();
  expect(api.appendEvents).not.toHaveBeenCalled();
});

it("recovers a pending target after a crash between history deletion and baseline persistence", async () => {
  const value = { ...chat(), title: "durable offline edit" };
  memory.put("chats/chat/target.json", JSON.stringify(await extractChatBlobs(value)));
  await writeJson("_sync/state.json", {
    userId: "user",
    heads: { chat: 17 },
    lastFrameHash: { chat: "deleted-server-frame" },
    entriesSinceCompact: { chat: 100 },
  });
  const sync = await ChatSync.create({ userId: "user", dek: await generateDEK() });
  await sync.flushPending();
  expect(api.appendEvents).toHaveBeenCalledWith("chat", 0, expect.any(Array));
  expect((await readLocalChat("chat", false))?.title).toBe("durable offline edit");
});

it("waits for a pending target to become durable before applying remote deletion", async () => {
  // Browser backup operations hold shared reset locks and may run concurrently.
  stubWebLocks();
  const sync = await ChatSync.create({ userId: "user", dek: await generateDEK() });
  await sync.saveChat(chat());
  await vi.waitFor(async () => expect(await readJson("chats/chat/target.json")).toBeUndefined());
  const release = beginChatBackupPause("chat");
  let unblockWrite!: () => void;
  let writeStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    writeStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    unblockWrite = resolve;
  });
  memory.beforeWrite = async (path) => {
    if (path !== "chats/chat/target.json") return;
    writeStarted();
    await blocked;
  };
  try {
    const saving = sync.saveChat({ ...chat(), title: "pending write" });
    await started;
    const pulling = sync.pull();
    // The old log remains until the replacement target commits.
    expect(await readText("chats/chat/history.jsonl")).toBeDefined();
    unblockWrite();
    await saving;
    expect(await pulling).toMatchObject([{ title: "pending write" }]);
    expect(await readJson("chats/chat/target.json")).toMatchObject({ title: "pending write" });
    expect(await readText("chats/chat/history.jsonl")).toBeUndefined();
  } finally {
    unblockWrite();
    memory.beforeWrite = undefined;
    await finishChatBackupPause(release);
  }
});

it("finishes an active upload before a local storage deletion without resurrecting its mirror", async () => {
  stubWebLocks();
  let finishAppend!: () => void;
  let appendStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    appendStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    finishAppend = resolve;
  });
  vi.mocked(api.appendEvents).mockImplementationOnce(async (_id, seq, events) => {
    appendStarted();
    await blocked;
    return { newSeq: seq + events.length };
  });
  const sync = await ChatSync.create({ userId: "user", dek: await generateDEK() });
  await sync.saveChat(chat());
  await started;
  const deleting = stashPendingDeletion("chat", "user");
  try {
    expect(await readJson("chats/chat/target.json")).toBeDefined();
    finishAppend();
    await deleting;
    await sync.flushPending();
    await vi.waitFor(() => expect(api.deleteChat).toHaveBeenCalledWith("chat"));
    expect(await readLocalChat("chat")).toBeUndefined();
    expect(await readLocalMirror(false)).toEqual([]);
    expect(await readJson("_sync/state.json")).toMatchObject({ heads: {}, lastFrameHash: {} });
  } finally {
    finishAppend();
  }
});

it.each(["missing", "corrupt", "network"])(
  "retries a %s attachment without advancing the restored chat head",
  async (failure) => {
    const dek = await generateDEK();
    const value = { ...chat(), messages: [userMessage([mediaFromDataUrl("data:image/png;base64,YWJj")])] };
    const stored = await extractChatBlobs(value);
    const [blobId] = collectChatBlobIds(stored);
    const frame = await encryptEvent(dek, { prevHash: ZERO_HASH, body: diffChat(null, stored) }, "user", "chat", 1);
    memory.reset(); // Fresh device has neither the manifest nor its attachment.
    vi.mocked(api.listChats).mockResolvedValue([{ id: "chat", headSeq: 1, updated: "2026-01-02" }]);
    vi.mocked(api.readEvents).mockResolvedValue([{ id: "event", seq: 1, frame }]);
    if (failure === "network") vi.mocked(api.getBlob).mockRejectedValue(new Error("download interrupted"));
    else vi.mocked(api.getBlob).mockResolvedValue(failure === "missing" ? null : new Uint8Array([1, 2, 3]));
    const sync = await ChatSync.create({ userId: "user", dek });
    await expect(sync.pull()).rejects.toThrow();
    expect(await readText("chats/chat/history.jsonl")).toBeUndefined();
    expect((await readJson<{ heads: Record<string, number> }>("_sync/state.json"))?.heads.chat).toBeUndefined();
    vi.mocked(api.getBlob).mockResolvedValue(await encryptBlob(dek, new TextEncoder().encode("abc"), "user", blobId));
    expect(await sync.pull()).toMatchObject([{ id: "chat" }]);
    expect(await readText(`chats/chat/blobs/${blobId}.bin`)).toBe("abc");
    expect(api.readEvents).toHaveBeenLastCalledWith("chat", 0);
    expect(await readJson("_sync/state.json")).toMatchObject({ heads: { chat: 1 } });
  },
);

it("keeps a chat pending when a referenced attachment is missing locally and remotely", async () => {
  const value = { ...chat(), messages: [userMessage([mediaFromDataUrl("data:image/png;base64,YWJj")])] };
  const stored = await extractChatBlobs(value);
  memory.reset();
  await writeJson("chats/chat/target.json", stored);
  vi.mocked(api.headBlob).mockResolvedValue(false);
  const sync = await ChatSync.create({ userId: "user", dek: await generateDEK() });
  await sync.flushPending();
  expect(api.appendEvents).not.toHaveBeenCalled();
  expect(await readJson("chats/chat/target.json")).toEqual(JSON.parse(JSON.stringify(stored)));
});

it("retains shared server attachments when one of their chats is deleted", async () => {
  const sync = await ChatSync.create({ userId: "user", dek: await generateDEK() });
  const messages = [userMessage([mediaFromDataUrl("data:image/png;base64,YWJj")])];
  for (const id of ["first", "second"]) await sync.saveChat({ ...chat(), id, messages });
  await sync.flushPending();
  await vi.waitFor(async () => expect(await readJson("chats/second/target.json")).toBeUndefined());
  await sync.deleteChat("first");
  await sync.flushPending();
  await vi.waitFor(() => expect(api.deleteChat).toHaveBeenCalledWith("first"));
  expect(await readLocalChat("second", false)).toMatchObject({ id: "second" });
});

it.each(["decryption", "chain", "gap"])(
  "rejects a %s failure without committing earlier frames from the batch",
  async (failure) => {
    const dek = await generateDEK();
    const frame = await encryptEvent(
      dek,
      { prevHash: ZERO_HASH, body: diffChat(null, await extractChatBlobs(chat())) },
      "user",
      "chat",
      1,
    );
    const seq = failure === "gap" ? 3 : 2;
    const second =
      failure === "decryption"
        ? "invalid"
        : await encryptEvent(
            dek,
            {
              prevHash: failure === "chain" ? "wrong" : await hashFrame(frame),
              body: [{ type: "meta", title: "updated" }],
            },
            "user",
            "chat",
            seq,
          );
    vi.mocked(api.listChats).mockResolvedValue([{ id: "chat", headSeq: seq, updated: "2026-01-02" }]);
    vi.mocked(api.readEvents).mockResolvedValue([
      { id: "first", seq: 1, frame },
      { id: "second", seq, frame: second },
    ]);
    const sync = await ChatSync.create({ userId: "user", dek });
    await expect(sync.pull()).rejects.toThrow();
    expect(await readText("chats/chat/history.jsonl")).toBeUndefined();
    expect((await readJson<{ heads: Record<string, number> }>("_sync/state.json"))?.heads.chat).toBeUndefined();
    vi.mocked(api.listChats).mockResolvedValue([{ id: "chat", headSeq: 1, updated: "2026-01-02" }]);
    vi.mocked(api.readEvents).mockResolvedValue([{ id: "first", seq: 1, frame }]);
    expect(await sync.pull()).toMatchObject([{ id: "chat" }]);
  },
);

it("rejects a complete HTTP response that omits the advertised final chat frames", async () => {
  const dek = await generateDEK();
  const frame = await encryptEvent(
    dek,
    { prevHash: ZERO_HASH, body: diffChat(null, await extractChatBlobs(chat())) },
    "user",
    "chat",
    1,
  );
  vi.mocked(api.listChats).mockResolvedValue([{ id: "chat", headSeq: 2, updated: "2026-01-02" }]);
  vi.mocked(api.readEvents).mockResolvedValue([{ id: "first", seq: 1, frame }]);
  const sync = await ChatSync.create({ userId: "user", dek });
  await expect(sync.pull()).rejects.toThrow("Incomplete backup");
  expect(await readText("chats/chat/history.jsonl")).toBeUndefined();
  vi.mocked(api.readEvents).mockResolvedValue([]);
  await expect(sync.pull()).rejects.toThrow("Incomplete backup");
});

it("shares one baseline between tabs so events are neither re-applied nor diffed against stale state", async () => {
  stubWebLocks();
  const dek = await generateDEK();
  const frames: { seq: number; id: string; frame: string }[] = [];
  vi.mocked(api.appendEvents).mockImplementation(async (_id, seq, events) => {
    if (seq !== frames.length) return null;
    events.forEach((event, index) => frames.push({ seq: seq + index + 1, ...event }));
    return { newSeq: frames.length };
  });
  vi.mocked(api.readEvents).mockImplementation(async (_id, from) => frames.filter((frame) => frame.seq > from));
  const first = await ChatSync.create({ userId: "user", dek });
  const second = await ChatSync.create({ userId: "user", dek });
  const firstChanged = vi.fn();
  const secondChanged = vi.fn();
  first.subscribeRemoteChanges(firstChanged);
  second.subscribeRemoteChanges(secondChanged);

  await first.saveChat(chat());
  await vi.waitFor(async () => expect(await readJson("chats/chat/target.json")).toBeUndefined());
  vi.mocked(api.listChats).mockResolvedValue([{ id: "chat", headSeq: frames.length, updated: "2026-01-02" }]);
  await second.pull();
  expect(secondChanged).toHaveBeenCalledWith([expect.objectContaining({ id: "chat" })]);
  expect(api.readEvents).not.toHaveBeenCalled();
  expect((await readLocalChat("chat", false))?.messages).toHaveLength(1);

  const posted = frames.length;
  await second.saveChat({ ...chat(), messages: [...chat().messages, userMessage("from the second tab")] });
  await vi.waitFor(async () => expect(await readJson("chats/chat/target.json")).toBeUndefined());
  expect(vi.mocked(api.appendEvents).mock.calls.at(-1)?.[1]).toBe(posted);
  expect(await readJson<{ heads: Record<string, number> }>("_sync/state.json")).toMatchObject({
    heads: { chat: frames.length },
  });
  expect((await readLocalChat("chat", false))?.messages).toHaveLength(2);
  vi.mocked(api.listChats).mockResolvedValue([{ id: "chat", headSeq: frames.length, updated: "2026-01-02" }]);
  await first.pull();
  expect(firstChanged).toHaveBeenCalledWith([expect.objectContaining({ messages: expect.any(Array) })]);
  expect(firstChanged.mock.calls.at(-1)?.[0][0].messages).toHaveLength(2);
  expect(api.readEvents).not.toHaveBeenCalled();
});

it("keeps a locked tab's save while an unlocked tab clears its acknowledged target", async () => {
  stubWebLocks();
  await stashPendingTarget(chat());
  const sync = await ChatSync.create({ userId: "user", dek: await generateDEK() });
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = opfs.readJson;
  let clearing = false;
  const read = vi.spyOn(opfs, "readJson").mockImplementation(async (path) => {
    const value = await original(path);
    if (!clearing && path === "chats/chat/target.json" && vi.mocked(api.appendEvents).mock.calls.length > 0) {
      clearing = true;
      await blocked;
    }
    return value;
  });
  try {
    const flushing = sync.flushPending();
    await vi.waitFor(() => expect(clearing).toBe(true));
    const saving = stashPendingTarget({ ...chat(), title: "saved by locked tab" });
    // Let the competing save reach storage if it does not share the target lock.
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await Promise.all([flushing, saving]);
    expect(await readJson("chats/chat/target.json")).toMatchObject({ title: "saved by locked tab" });
  } finally {
    release();
    read.mockRestore();
  }
});

it("splits a large upload across append requests and commits each accepted part", { timeout: 60_000 }, async () => {
  const dek = await generateDEK();
  const big = "x".repeat(4_500_000);
  const messages = Array.from({ length: 12 }, () => userMessage(big));
  const sync = await ChatSync.create({ userId: "user", dek });
  vi.mocked(api.appendEvents)
    .mockImplementationOnce(async (_id, seq, events) => ({ newSeq: seq + events.length }))
    .mockRejectedValueOnce(new Error("offline"));
  await sync.saveChat({ ...chat(), messages });
  await vi.waitFor(() => expect(api.appendEvents).toHaveBeenCalledTimes(2), { timeout: 30_000 });
  const [first, second] = vi.mocked(api.appendEvents).mock.calls;
  expect(first[1]).toBe(0);
  expect(second[1]).toBe(first[2].length);
  const bytes = (events: { frame: string }[]) => events.reduce((sum, event) => sum + event.frame.length, 0);
  expect(bytes(first[2])).toBeLessThan(64 * 1024 * 1024);
  expect(await readJson<{ heads: Record<string, number> }>("_sync/state.json")).toMatchObject({
    heads: { chat: first[2].length },
  });

  // The retry resumes after the accepted part instead of starting over.
  vi.mocked(api.appendEvents).mockImplementation(async (_id, seq, events) => ({ newSeq: seq + events.length }));
  await sync.flushPending();
  const retry = vi.mocked(api.appendEvents).mock.calls[2];
  expect(retry[1]).toBe(first[2].length);
  expect(await readJson("chats/chat/target.json")).toBeUndefined();
  expect((await readLocalChat("chat", false))?.messages).toHaveLength(12);
});

it.each([
  { messageCount: 1, compacts: true },
  { messageCount: 12, compacts: false },
])(
  "compacts only snapshots that fit one append request ($messageCount messages)",
  { timeout: 60_000 },
  async ({ messageCount, compacts }) => {
    const dek = await generateDEK();
    const value = {
      ...chat(),
      messages: Array.from({ length: messageCount }, () => userMessage("x".repeat(4_500_000))),
    };
    const stored = await extractChatBlobs(value);
    await writeText(
      "chats/chat/history.jsonl",
      encodeHistory(diffChat(null, stored), { head: 1, hash: ZERO_HASH, count: 49 }),
    );
    await writeJson("chats/chat/chat.json", stored);
    await writeJson("_sync/state.json", {
      userId: "user",
      heads: { chat: 1 },
      lastFrameHash: { chat: ZERO_HASH },
      entriesSinceCompact: { chat: 49 },
    });
    await stashPendingTarget({ ...value, title: "updated title" });
    const sync = await ChatSync.create({ userId: "user", dek });
    vi.mocked(api.appendEvents)
      .mockImplementationOnce(async (_id, seq, events) => ({ newSeq: seq + events.length }))
      .mockImplementationOnce(async (_id, seq, events) => ({ newSeq: seq + events.length }))
      .mockRejectedValueOnce(new Error("connection lost during compaction"));

    await sync.flushPending();

    const baseline = (await readChatHistory("chat"))?.chat;
    expect(baseline?.messages).toHaveLength(value.messages.length);
    expect(baseline).toEqual(JSON.parse(JSON.stringify({ ...stored, title: "updated title" })));
    expect(await readJson("chats/chat/target.json")).toBeUndefined();
    if (compacts) {
      expect(api.appendEvents).toHaveBeenCalledTimes(2);
      expect(vi.mocked(api.appendEvents).mock.calls[1][2].length).toBeGreaterThan(1);
      expect(api.compactChat).toHaveBeenCalledWith("chat", 3);
    } else {
      expect(api.appendEvents).toHaveBeenCalledOnce(); // Only the title delta is published.
      expect(api.compactChat).not.toHaveBeenCalled();
    }
  },
);

it("skips compaction when its snapshot conflicts instead of compacting before a delta", async () => {
  const dek = await generateDEK();
  const sync = await ChatSync.create({ userId: "user", dek });
  const value = chat();
  // The 50th logged entry triggers compaction.
  for (let index = 0; index < 49; index++) {
    await sync.saveChat({ ...value, title: `title ${index}` });
    await sync.flushPending();
  }
  vi.mocked(api.appendEvents).mockReset();
  vi.mocked(api.appendEvents).mockImplementation(async (_id, seq, events) => {
    const payload = await decryptEvent<{ body: { type: string }[] }>(dek, events[0].frame, "user", "chat", seq + 1);
    return payload.body[0].type === "init" ? null : { newSeq: seq + events.length };
  });
  await sync.saveChat({ ...value, title: "final" });
  await sync.flushPending();
  await vi.waitFor(async () => expect(await readJson("chats/chat/target.json")).toBeUndefined());
  expect(api.compactChat).not.toHaveBeenCalled();
});
