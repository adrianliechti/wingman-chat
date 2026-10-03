import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryOpfs } from "@/shared/lib/test-support/memoryOpfs";
import { assistantMessage, mediaFromDataUrl, text, userMessage } from "./messages";
import {
  collectChatBlobIds,
  deleteUnreferencedChatBlobs,
  extractChatBlobs,
  hasStoredMedia,
  listChatBlobs,
  rehydrateChatBlobs,
  rehydrateContentParts,
  restoreChatManifest,
} from "./opfs-chat";
import type { Chat } from "@/shared/types/chat";

const memory = new MemoryOpfs();
const image = (value = "YWJj", name?: string) => mediaFromDataUrl(`data:image/jpeg;base64,${value}`, name);
const chat = (messages: Chat["messages"]): Chat => ({
  id: "chat",
  created: new Date("2026-01-01"),
  updated: new Date("2026-01-02"),
  model: null,
  messages,
});

beforeEach(() => {
  memory.reset();
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

describe("chat blobs", () => {
  it.each([false, true])(
    "stores and retains media in native multimodal tool results (data URL=%s)",
    async (dataUrl) => {
      const media = image();
      if (dataUrl) media.source = { type: "url", value: "data:image/jpeg;base64,YWJj" };
      const value = chat([
        assistantMessage([
          { type: "tool-call", id: "call", name: "render", arguments: "{}", state: "complete" },
          { type: "tool-result", toolCallId: "call", content: [text("Look"), media], state: "complete" },
        ]),
      ]);
      const stored = await extractChatBlobs(value);
      expect(collectChatBlobIds(stored)).toHaveLength(1);
      expect(hasStoredMedia(stored.messages[0].parts)).toBe(true);
      await deleteUnreferencedChatBlobs(stored);
      expect(await listChatBlobs("chat")).toHaveLength(1);
      const loaded = await rehydrateChatBlobs(JSON.parse(JSON.stringify(stored)));
      expect(loaded.messages[0].parts[1]).toMatchObject({ content: [text("Look"), image()] });
    },
  );

  it("moves media bytes in user parts, tool outputs and subagent conversations into blobs and back", async () => {
    const value = chat([
      userMessage([text("Look"), image("YWJj", "photo.jpg")]),
      assistantMessage([
        { type: "tool-call", id: "call", name: "render", arguments: "{}", state: "complete" },
        {
          type: "tool-result",
          toolCallId: "call",
          content: "[Image - displayed to user]",
          state: "complete",
          metadata: { result: [image("ZGVm")], meta: { file: "/a.png" } },
        },
        {
          type: "subagent",
          subagent: {
            id: "child",
            name: "research",
            status: "finished",
            messages: [userMessage([mediaFromDataUrl("data:text/plain;base64,bm90ZXM=", "notes.txt")])],
          },
        },
      ]),
    ]);
    const stored = await extractChatBlobs(value);
    const json = JSON.stringify(stored);
    expect(stored.version).toBe(2);
    expect(json).not.toContain("base64");
    expect(json).not.toMatch(/"value":"(YWJj|ZGVm|bm90ZXM=)"/);
    expect(json).toContain('"contentType":"image/jpeg"');
    expect(json).toContain('"filename":"photo.jpg"');
    expect(stored.created).toBe("2026-01-01T00:00:00.000Z");
    const ids = collectChatBlobIds(stored);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(await listChatBlobs("chat")).toEqual(expect.arrayContaining(ids));
    expect(hasStoredMedia(stored.messages[0].parts)).toBe(true);
    expect(hasStoredMedia(stored.messages[1].parts)).toBe(true);
    expect(hasStoredMedia(value.messages[0].parts)).toBe(false);

    const manifest = restoreChatManifest(stored);
    expect(manifest.created).toEqual(value.created);
    expect(manifest.messages[0].createdAt).toBeInstanceOf(Date);
    expect(JSON.stringify(manifest.messages)).toContain("blob:sha256-");

    const loaded = await rehydrateChatBlobs(stored);
    expect(loaded.messages).toMatchObject(value.messages);
    expect(loaded.messages[0].createdAt).toEqual(value.messages[0].createdAt);
    expect(await rehydrateContentParts("chat", stored.messages[0].parts)).toMatchObject(value.messages[0].parts);
  });

  it("keeps a reference whose blob is missing and deletes blobs nothing references", async () => {
    const stored = await extractChatBlobs(chat([userMessage([image("YWJj"), image("ZGVm")])]));
    const [kept, dropped] = collectChatBlobIds(stored);
    const trimmed = {
      ...stored,
      messages: [{ ...stored.messages[0], parts: [stored.messages[0].parts[0]] }],
    };
    await deleteUnreferencedChatBlobs(trimmed);
    expect(await listChatBlobs("chat")).toEqual([kept]);
    const loaded = await rehydrateChatBlobs(stored);
    expect(loaded.messages[0].parts[0]).toMatchObject({ source: { type: "data", value: "YWJj" } });
    expect(loaded.messages[0].parts[1]).toMatchObject({ source: { type: "url", value: `blob:${dropped}` } });
  });

  it("omits empty runtime state and keeps resume and metadata when present", async () => {
    const empty = await extractChatBlobs(chat([]));
    expect(empty).not.toHaveProperty("resume");
    expect(empty).not.toHaveProperty("metadata");
    const resume = { resumeState: { threadId: "chat", runId: "run" }, pendingInterrupts: [] };
    const stored = await extractChatBlobs({ ...chat([]), resume, metadata: { ns: { key: 1 } } });
    expect(stored).toMatchObject({ resume, metadata: { ns: { key: 1 } } });
    expect(restoreChatManifest(stored)).toMatchObject({ resume, metadata: { ns: { key: 1 } } });
  });
});
