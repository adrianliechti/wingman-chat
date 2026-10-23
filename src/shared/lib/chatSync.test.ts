import { beforeEach, expect, it, vi } from "vitest";
import { ChatSync, readLocalChat, readLocalMirror } from "./chatSync";
import { decryptEvent, encryptEvent, generateDEK, ZERO_HASH } from "./crypto";
import { userMessage } from "./messages";
import { extractChatBlobs } from "./opfs-chat";
import { readJson } from "./opfs-core";
import * as api from "./storeClient";
import { MemoryOpfs } from "./test-support/memoryOpfs";
import type { Chat } from "@/shared/types/chat";

vi.mock("./storeClient", () => ({
  listChats: vi.fn(),
  readEvents: vi.fn(),
  appendEvents: vi.fn(),
  headBlob: vi.fn(),
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
