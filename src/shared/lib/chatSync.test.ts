import { beginChatBackupPause, finishChatBackupPause } from "./chatBackupActivity";
import { beforeEach, expect, it, vi } from "vitest";
import { ChatSync, readLocalChat, readLocalMirror, resetLocalBackupState, stashPendingDeletion } from "./chatSync";
import { decryptEvent, encryptEvent, generateDEK, ZERO_HASH } from "./crypto";
import { userMessage } from "./messages";
import { extractChatBlobs } from "./opfs-chat";
import { readJson, readText, writeJson, writeText } from "./opfs-core";
import * as api from "./storeClient";
import { MemoryOpfs } from "./test-support/memoryOpfs";
import type { Chat } from "@/shared/types/chat";

vi.mock("./storeClient", () => ({
  listChats: vi.fn(),
  readEvents: vi.fn(),
  appendEvents: vi.fn(),
  headBlob: vi.fn(),
  deleteChat: vi.fn(),
  deleteBlob: vi.fn(),
}));
const memory = new MemoryOpfs();
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

it("promotes an old server transcript with a native snapshot before appending new messages", async () => {
  const dek = await generateDEK();
  const frame = await encryptEvent(
    dek,
    {
      prevHash: ZERO_HASH,
      body: [
        { type: "init", id: "chat", created: "2026-01-01", model: null },
        { type: "message", role: "user", content: [{ type: "text", text: "old message" }] },
      ],
    },
    "user",
    "chat",
    1,
  );
  vi.mocked(api.listChats).mockResolvedValue([{ id: "chat", headSeq: 1, updated: "2026-01-01" }]);
  vi.mocked(api.readEvents).mockResolvedValue([{ id: "event", seq: 1, frame }]);
  const sync = await ChatSync.create({ userId: "user", dek });
  const [old] = await sync.pull();
  await sync.saveChat({ ...old, messages: [...old.messages, userMessage("new message")] });
  await vi.waitFor(async () => {
    expect(api.appendEvents).toHaveBeenCalledOnce();
    expect(await readJson("chats/chat/target.json")).toBeUndefined();
  });
  const posted = vi.mocked(api.appendEvents).mock.calls[0][2][0];
  expect(await decryptEvent(dek, posted.frame, "user", "chat", 2)).toMatchObject({
    body: [{ type: "init", version: 2 }, {}, {}, {}],
  });
  expect((await readLocalChat("chat", false))?.messages.map((message) => message.parts[0])).toMatchObject([
    { type: "text", content: "old message" },
    { type: "text", content: "new message" },
  ]);
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
  await vi.waitFor(() => expect(api.appendEvents).toHaveBeenCalledTimes(2));
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
  expect(await readJson("_sync/state.json")).toMatchObject({ pendingDeletes: [{ id: "chat" }] });
});

it("keeps local chat deletion available before backup protection setup", async () => {
  memory.put("chats/chat/chat.json", JSON.stringify(await extractChatBlobs(chat())));
  await stashPendingDeletion("chat", "user");
  expect(await readLocalChat("chat")).toBeUndefined();
  expect(await readJson("_sync/state.json")).toMatchObject({ userId: "user", pendingDeletes: [{ id: "chat" }] });
  expect(api.appendEvents).not.toHaveBeenCalled();
  expect(api.deleteChat).not.toHaveBeenCalled();
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
