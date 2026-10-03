import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryOpfs } from "@/shared/lib/test-support/memoryOpfs";
import { PersistenceQueue } from "@/shared/lib/persistence";
import * as opfs from "@/shared/lib/opfs";
import { assistantMessage, mediaFromDataUrl, text, userMessage } from "@/shared/lib/messages";
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
const image = (value = "YWJj", name?: string) => mediaFromDataUrl(`data:image/jpeg;base64,${value}`, name);

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
    value.messages = [userMessage([image()])];
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

  it("round-trips the native record: identities, usage, phases, resume, metadata and rich tool output", async () => {
    const value = chat();
    value.resume = {
      resumeState: { threadId: "chat", runId: "run" },
      pendingInterrupts: [
        { id: "approval", reason: "tool_call", toolCallId: "call", metadata: { toolName: "vision" } },
      ],
    };
    value.metadata = { "@tanstack/ai-compaction": { "chat/child": { compactedMessages: [] } } };
    value.messages = [
      assistantMessage(
        [
          text("Working", { phase: "commentary" }),
          { type: "tool-call", id: "call", name: "vision", arguments: "{}", state: "complete" },
          {
            type: "tool-result",
            toolCallId: "call",
            content: "[Image - displayed to user]",
            state: "complete",
            metadata: { result: [image()], meta: { revision: 2 } },
          },
        ],
        {
          id: "message",
          createdAt: new Date("2026-01-01"),
          metadata: {
            runId: "run",
            usage: { outputTokens: 3 },
            textSegments: [{ content: "Working", phase: "commentary" }],
          },
        },
      ),
    ];
    await storeChat(value);
    expect(await loadChat(value.id)).toMatchObject(value);
    expect(await loadChat(value.id, false)).toMatchObject({ resume: value.resume, metadata: value.metadata });
    const stored = await opfs.readJson<opfs.StoredChat>("chats/chat/chat.json");
    expect(stored?.version).toBe(2);
    expect(JSON.stringify(stored)).not.toContain("base64");
    expect(JSON.stringify(stored)).toContain("image/jpeg");
    expect(stored).toMatchObject({ resume: value.resume, metadata: value.metadata });
  });

  it("a failed manifest save keeps the last committed attachments readable", async () => {
    const value = chat();
    value.messages = [userMessage([image()])];
    await storeChat(value);
    memory.beforeWrite = async (path) => {
      if (path.endsWith("chat.json")) throw new Error("disk full");
    };
    await expect(storeChat({ ...value, messages: [] })).rejects.toThrow();
    expect((await loadChat(value.id))!.messages[0].parts[0]).toMatchObject({
      source: { type: "data", value: "YWJj", mimeType: "image/jpeg" },
    });
  });

  it("stores subagent conversations and attachments using the native message format", async () => {
    const value = chat();
    value.messages = [
      assistantMessage(
        [
          {
            type: "subagent",
            subagent: {
              id: "child",
              name: "research",
              status: "finished",
              messages: [
                assistantMessage(
                  [
                    {
                      type: "subagent",
                      subagent: {
                        id: "nested",
                        name: "inspect",
                        status: "finished",
                        messages: [
                          assistantMessage(
                            [
                              { type: "tool-call", id: "call", name: "read", arguments: "{}", state: "complete" },
                              {
                                type: "tool-result",
                                toolCallId: "call",
                                content: "[Image - displayed to user]",
                                state: "complete",
                                metadata: {
                                  result: [image(), mediaFromDataUrl("data:text/plain;base64,bm90ZXM=", "notes.txt")],
                                },
                              },
                            ],
                            { id: "result" },
                          ),
                        ],
                      },
                    },
                  ],
                  { id: "child-message" },
                ),
              ],
            },
          },
        ],
        { id: "parent" },
      ),
    ];
    await storeChat(value);
    const manifest = (await loadChat(value.id, false))!;
    expect(JSON.stringify(manifest.messages)).not.toContain("base64");
    expect(JSON.stringify(manifest.messages)).toContain('"parts"');
    const loaded = await createAttachmentLoader(value.id)(manifest.messages);
    expect(loaded).toMatchObject(value.messages);
    // Saving references must keep blobs owned by a nested child.
    await storeChat(manifest);
    expect(await opfs.listChatBlobs(value.id)).toHaveLength(2);
    expect((await loadChat(value.id))?.messages).toMatchObject(value.messages);
    await storeChat({ ...manifest, messages: [] });
    expect(await opfs.listChatBlobs(value.id)).toHaveLength(0);
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
    value.messages = [userMessage([image("c2xvdw=="), image("ZmFpbA==")])];
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
        version: 2,
        messages: [
          userMessage([
            { type: "document", source: { type: "url", value: "blob:missing" }, metadata: { filename: "x.pdf" } },
          ]),
        ],
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
    value.messages = [userMessage([image()])];
    await storeChat(value);
    const [path] = [...memory.files.keys()].filter((path) => path.includes("/blobs/"));
    memory.put(path, "");
    await storeChat(value);
    expect((await loadChat("chat"))!.messages[0].parts[0]).toMatchObject({
      source: { type: "data", value: "YWJj", mimeType: "image/jpeg" },
    });
  });
});
