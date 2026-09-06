import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryOpfs } from "@/shared/lib/test-support/memoryOpfs";
import { PersistenceQueue } from "@/shared/lib/persistence";
import * as opfs from "@/shared/lib/opfs";
import type { Chat } from "@/shared/types/chat";
import { loadChat, loadChatIndex, removeChat, storeChat } from "./chatStorage";
import { createAttachmentLoader } from "./chatAttachments";

const config = vi.hoisted(() => ({ chat: { retentionDays: 0 } }));
vi.mock("@/shared/config", () => ({ getConfig: () => config }));
const memory = new MemoryOpfs();
const chat = (id = "chat"): Chat => ({
  id,
  created: new Date("2026-01-01"),
  updated: new Date(),
  model: null,
  messages: [],
});

beforeEach(() => {
  memory.reset();
  config.chat.retentionDays = 0;
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => memory.root } });
  vi.stubGlobal(
    "FileReader",
    class {
      result = "";
      onload = () => {};
      readAsDataURL(blob: Blob) {
        void blob.arrayBuffer().then((bytes) => {
          this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString("base64")}`;
          this.onload();
        });
      }
    },
  );
});

describe("chat persistence", () => {
  it("reads only the index at startup and resolves attachment copies when requested", async () => {
    const value = chat();
    value.messages = [{ role: "user", content: [{ type: "image", data: "data:image/jpeg;base64,YWJj" }] }];
    await storeChat(value);
    const reads: string[] = [];
    memory.beforeRead = async (path) => {
      reads.push(path);
    };
    expect(await loadChatIndex()).toHaveLength(1);
    expect(reads).toEqual(["chats/index.json"]);
    const manifest = (await loadChat(value.id, false))!;
    expect(reads).toEqual(["chats/index.json", "chats/chat/chat.json"]);
    expect(JSON.stringify(manifest.messages)).toContain("blob:sha256-");
    const load = createAttachmentLoader(value.id);
    expect(await load(manifest.messages)).toMatchObject(value.messages);
    expect(JSON.stringify(manifest.messages)).toContain("blob:sha256-");
    const readCount = reads.length;
    await load(manifest.messages);
    expect(reads).toHaveLength(readCount);
  });
  it("round-trips message identity, usage, phases, nested media MIME and tool metadata", async () => {
    const value = chat();
    value.messages = [
      {
        id: "message",
        runId: "run",
        createdAt: "2026-01-01",
        role: "assistant",
        usage: { outputTokens: 3 },
        content: [
          { type: "text", phase: "commentary", text: "Working" },
          {
            type: "tool_result",
            id: "call",
            name: "vision",
            arguments: "{}",
            meta: { revision: 2 },
            result: [{ type: "image", data: "data:image/jpeg;base64,YWJj" }],
          },
        ],
      },
    ];
    await storeChat(value);
    expect(await loadChat(value.id)).toMatchObject(value);
    const stored = await opfs.readJson<opfs.StoredChat>("chats/chat/chat.json");
    expect(JSON.stringify(stored)).not.toContain("base64");
    expect(JSON.stringify(stored)).toContain("image/jpeg");
  });

  it("a failed manifest save keeps the last committed attachments readable", async () => {
    const value = chat();
    value.messages = [{ role: "user", content: [{ type: "image", data: "data:image/png;base64,YWJj" }] }];
    await storeChat(value);
    memory.beforeWrite = async (path) => {
      if (path.endsWith("chat.json")) throw new Error("disk full");
    };
    await expect(storeChat({ ...value, messages: [] })).rejects.toThrow("disk full");
    expect((await loadChat(value.id))!.messages[0].content[0]).toMatchObject({ data: "data:image/png;base64,YWJj" });
  });

  it("finishes sibling blob writes before a failed save releases the lock to deletion", async () => {
    let release!: () => void;
    let held = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    memory.beforeWrite = async (path, blob) => {
      if (!path.includes("/blobs/")) return;
      if ((await blob.text()) === "slow") {
        held = true;
        await gate;
      } else throw new Error("failed blob");
    };
    const value = chat();
    value.messages = [
      {
        role: "user",
        content: [
          { type: "image", data: "data:image/png;base64,c2xvdw==" },
          { type: "image", data: "data:image/png;base64,ZmFpbA==" },
        ],
      },
    ];
    const saving = storeChat(value).catch(() => {});
    await vi.waitFor(() => expect(held).toBe(true));
    let deleted = false;
    const deleting = removeChat(value.id).then(() => {
      deleted = true;
    });
    await Promise.resolve();
    expect(deleted).toBe(false);
    release();
    await Promise.all([saving, deleting]);
    expect([...memory.files.keys()].filter((path) => path.startsWith("chats/chat/"))).toEqual([]);
  });

  it("keeps a missing attachment reference available for a later partial restore", async () => {
    memory.put(
      "chats/chat/chat.json",
      JSON.stringify({
        ...chat(),
        messages: [{ role: "user", content: [{ type: "file", name: "x.pdf", data: "blob:missing" }] }],
      }),
    );
    const loaded = (await loadChat("chat"))!;
    await storeChat(loaded);
    expect(JSON.stringify(await opfs.readJson("chats/chat/chat.json"))).toContain("blob:missing");
  });

  it("retention uses the saved chat date rather than a stale index date", async () => {
    config.chat.retentionDays = 1;
    await storeChat(chat());
    await opfs.upsertIndexEntry("chats", { id: "chat", updated: "2000-01-01" });
    expect((await loadChatIndex()).map((item) => item.id)).toEqual(["chat"]);
    expect(await opfs.fileExists("chats/chat/chat.json")).toBe(true);
  });

  it("failed saves remain retryable with the newest snapshot", async () => {
    const queue = new PersistenceQueue(vi.fn());
    await storeChat(chat());
    memory.beforeWrite = async () => {
      throw new Error("quota");
    };
    queue.schedule("chat", () => storeChat({ ...chat(), title: "unsaved" }));
    await expect(queue.flush()).rejects.toThrow();
    memory.beforeWrite = undefined;
    queue.schedule("chat", () => storeChat({ ...chat(), title: "latest" }));
    await queue.flush();
    expect((await loadChat("chat"))!.title).toBe("latest");
  });

  it("repairs an incomplete content-addressed blob when the same attachment is saved again", async () => {
    const value = chat();
    value.messages = [{ role: "user", content: [{ type: "image", data: "data:image/png;base64,YWJj" }] }];
    await storeChat(value);
    const [path] = [...memory.files.keys()].filter((path) => path.includes("/blobs/"));
    memory.put(path, "");
    await storeChat(value);
    expect((await loadChat("chat"))!.messages[0].content[0]).toMatchObject({ data: "data:image/png;base64,YWJj" });
  });
});
