import { describe, expect, it, vi } from "vitest";
import { MemoryOpfs } from "@/shared/lib/test-support/memoryOpfs";
import { loadChat, storeChat } from "@/features/chat/lib/chatStorage";
import { createAttachmentLoader } from "@/features/chat/lib/chatAttachments";
import { isLegacyStoredChat, migrateLegacyChat, normalizeStoredChat, type LegacyStoredChat } from "./chatMigration";
import { messageMetadata, textMetadata, toolResultFor, toolResultMetadata } from "./messages";
import { collectChatBlobIds, STORED_CHAT_VERSION } from "./opfs-chat";
import { readGatewayReasoning } from "./reasoning";
import * as opfs from "./opfs";

vi.mock("@/shared/config", () => ({ getConfig: () => ({ chat: {} }) }));

const signature = (value: object) => `@tanstack:${JSON.stringify(value)}`;
const BLOB = "blob:sha256-0123456789abcdef";

function legacyChat(): LegacyStoredChat {
  return {
    id: "legacy-chat",
    title: "Legacy",
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-02T00:00:00.000Z",
    model: { id: "model", name: "Model" },
    messages: [
      {
        id: "u1",
        runId: "run-1",
        createdAt: "2026-01-01T00:00:01.000Z",
        role: "user",
        content: [{ type: "text", text: "Draw a chart" }],
      },
      {
        id: "a1",
        runId: "run-1",
        role: "assistant",
        usage: { outputTokens: 4 },
        content: [
          {
            type: "reasoning",
            id: "rs_1",
            text: "Plan the chart",
            summary: "Planning",
            encryptedContent: "cipher",
            model: "model",
          },
          { type: "tool_call", id: "call-1", name: "render", arguments: '{"kind":"bar"}' },
        ],
      },
      {
        id: "result-call-1",
        runId: "run-1",
        role: "user",
        content: [
          {
            type: "tool_result",
            id: "call-1",
            name: "render",
            arguments: '{"kind":"bar"}',
            meta: { artifactDelta: { mutations: [{ operation: "create", path: "/chart.png" }] } },
            content: { structured: true },
            result: [
              { type: "text", text: "Rendered" },
              { type: "image", name: "chart.png", data: BLOB, contentType: "image/png" },
            ],
          },
        ],
      },
      {
        id: "a2",
        runId: "run-1",
        role: "assistant",
        content: [
          { type: "text", phase: "commentary", text: "Here it is. " },
          { type: "text", phase: "final_answer", text: "Done." },
        ],
      },
      { id: "s1", role: "assistant", content: [{ type: "summary", text: "Earlier the user asked for a chart." }] },
      {
        id: "f1",
        role: "user",
        content: [{ type: "runtime_feedback", source: "verification", text: "Fix the title." }],
      },
      {
        id: "u2",
        role: "user",
        content: [
          { type: "text", text: "Edit this" },
          { type: "artifact_ref", path: "/chart.png", revision: "r2", displayName: "chart.png" },
          { type: "artifact_selection", path: "/notes.md", text: "Chart title", startLine: 3, endLine: 3 },
        ],
      },
      {
        id: "a3",
        role: "assistant",
        content: [
          { type: "tool_call", id: "delegate", name: "research", arguments: '{"prompt":"Check"}' },
          {
            type: "subagent",
            id: "child",
            name: "research",
            runId: "run-2",
            toolCallId: "delegate",
            status: "finished",
            signature: signature({ interruptIds: [], metadata: { tanstack: { subagentPlan: { agent: "research" } } } }),
            messages: [
              { role: "user", content: [{ type: "text", text: "Check" }] },
              {
                id: "c1",
                role: "assistant",
                content: [{ type: "tool_call", id: "inner", name: "read", arguments: "{}" }],
              },
              {
                id: "result-inner",
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    id: "inner",
                    name: "read",
                    arguments: "{}",
                    result: [{ type: "text", text: "Evidence" }],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "result-delegate",
        role: "user",
        content: [
          {
            type: "tool_result",
            id: "delegate",
            name: "research",
            arguments: '{"prompt":"Check"}',
            result: [{ type: "text", text: "Checked." }],
          },
        ],
      },
      { id: "e1", role: "assistant", content: [], error: { code: "SERVER_ERROR", message: "Server error." } },
      { id: "u3", role: "user", content: [{ type: "text", text: "Delete it" }] },
      {
        id: "a4",
        role: "assistant",
        content: [{ type: "tool_call", id: "call-2", name: "delete", arguments: '{"path":"/chart.png"}' }],
      },
      // An orphan result and an empty turn cannot be placed and leave no trace.
      { role: "user", content: [{ type: "tool_result", id: "nowhere", name: "x", arguments: "{}", result: [] }] },
      { role: "user", content: [] },
    ],
    pendingRun: {
      id: "run-3",
      signature: signature({ threadId: "legacy-chat" }),
      interrupts: [
        {
          id: "approval-1",
          reason: "tool_call",
          toolCallId: "call-2",
          metadata: { toolName: "delete", input: { path: "/chart.png" } },
          signature: signature({ "tanstack:interruptBinding": { generation: 0 } }),
        },
      ],
    },
    compactions: [
      {
        text: "Earlier the user asked for a chart.",
        signature: signature({
          compactedMessages: [
            {
              role: "assistant",
              content:
                "<untrusted-conversation-summary>\nEarlier the user asked for a chart.\n</untrusted-conversation-summary>",
            },
          ],
        }),
      },
      { subagentId: "child", signature: signature({ compactedMessages: [] }) },
      { subagentId: "broken", signature: "not-a-signature" },
    ],
  };
}

describe("legacy chat migration", () => {
  it("detects the old record and leaves the current one alone", () => {
    expect(isLegacyStoredChat(legacyChat())).toBe(true);
    const migrated = migrateLegacyChat(legacyChat());
    expect(isLegacyStoredChat(migrated)).toBe(false);
    expect(normalizeStoredChat(migrated)).toBe(migrated);
    expect(isLegacyStoredChat({ messages: [] })).toBe(true);
    expect(isLegacyStoredChat({ version: STORED_CHAT_VERSION, messages: [] })).toBe(false);
  });

  it("is deterministic and idempotent", () => {
    const first = migrateLegacyChat(legacyChat());
    const second = migrateLegacyChat(legacyChat());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(normalizeStoredChat(JSON.parse(JSON.stringify(first)))).toEqual(JSON.parse(JSON.stringify(first)));
  });

  it("rebuilds the native transcript with ids, metadata and folded tool rounds", () => {
    const stored = migrateLegacyChat(legacyChat());
    expect(stored.version).toBe(STORED_CHAT_VERSION);
    expect(stored.messages.map((message) => message.id)).toEqual([
      "u1",
      "a1",
      "a2",
      "s1",
      "f1",
      "u2",
      "a3",
      "e1",
      "u3",
      "a4",
    ]);
    const [u1, a1, a2, s1, f1, u2, a3, e1, , a4] = stored.messages;
    expect(u1).toMatchObject({ role: "user", parts: [{ type: "text", content: "Draw a chart" }] });
    expect(u1.createdAt).toEqual(new Date("2026-01-01T00:00:01.000Z"));
    expect(messageMetadata(u1)).toEqual({ runId: "run-1" });

    expect(messageMetadata(a1)).toEqual({ runId: "run-1", usage: { outputTokens: 4 } });
    expect(a1.parts.map((part) => part.type)).toEqual(["thinking", "tool-call", "tool-result"]);
    const thinking = a1.parts[0];
    if (thinking.type !== "thinking") throw new Error("Expected thinking");
    expect(thinking).toMatchObject({ content: "Planning", stepId: "rs_1" });
    expect(readGatewayReasoning(thinking.signature)).toEqual({
      id: "rs_1",
      text: "Plan the chart",
      summary: "Planning",
      encryptedContent: "cipher",
      model: "model",
    });
    expect(a1.parts[1]).toMatchObject({ type: "tool-call", id: "call-1", name: "render", state: "complete" });
    const result = toolResultFor(a1, "call-1")!;
    expect(result).toMatchObject({
      state: "complete",
      content: "Rendered\n[Image: chart.png - displayed to user]",
    });
    expect(toolResultMetadata(result)).toEqual({
      result: [
        { type: "text", content: "Rendered" },
        {
          type: "image",
          source: { type: "url", value: BLOB },
          metadata: { filename: "chart.png", contentType: "image/png" },
        },
      ],
      meta: { artifactDelta: { mutations: [{ operation: "create", path: "/chart.png" }] } },
      content: { structured: true },
    });

    expect(a2.parts).toEqual([
      { type: "text", content: "Here it is. ", metadata: { phase: "commentary" } },
      { type: "text", content: "Done.", metadata: { phase: "final_answer" } },
    ]);
    expect(messageMetadata(a2).textSegments).toEqual([
      { content: "Here it is. ", phase: "commentary" },
      { content: "Done.", phase: "final_answer" },
    ]);

    expect(messageMetadata(s1)).toEqual({ kind: "summary" });
    expect(s1.parts).toEqual([{ type: "text", content: "Earlier the user asked for a chart." }]);
    expect(messageMetadata(f1)).toEqual({ kind: "runtime_feedback" });
    expect(f1.parts).toEqual([{ type: "text", content: "Fix the title.", metadata: { source: "verification" } }]);

    expect(u2.parts[0]).toEqual({ type: "text", content: "Edit this" });
    expect(textMetadata(u2.parts[1] as never)).toEqual({
      artifactRef: { path: "/chart.png", revision: "r2", displayName: "chart.png" },
    });
    expect(textMetadata(u2.parts[2] as never)).toEqual({
      artifactSelection: { path: "/notes.md", text: "Chart title", startLine: 3, endLine: 3 },
    });

    const card = a3.parts[1];
    if (card.type !== "subagent") throw new Error("Expected the subagent card");
    expect(card.subagent).toMatchObject({
      id: "child",
      name: "research",
      status: "finished",
      parentRunId: "run-2",
      parentToolCallId: "delegate",
      interruptIds: [],
      metadata: { tanstack: { subagentPlan: { agent: "research" } } },
    });
    expect(card.subagent.messages.map((message) => message.id)).toEqual(["legacy-child-0", "c1"]);
    expect(toolResultFor(card.subagent.messages[1], "inner")).toMatchObject({ content: "Evidence" });

    expect(e1.parts).toEqual([]);
    expect(messageMetadata(e1)).toEqual({ error: { code: "SERVER_ERROR", message: "Server error." } });

    expect(a4.parts[0]).toMatchObject({
      type: "tool-call",
      id: "call-2",
      state: "approval-requested",
      approval: { id: "approval-1", needsApproval: true },
    });
    // The delegate call keeps the result its child produced; the card renders the work.
    expect(a3.parts[0]).toMatchObject({ type: "tool-call", id: "delegate", state: "complete" });
    expect(toolResultFor(a3, "delegate")).toMatchObject({ state: "complete", content: "Checked." });
  });

  it("restores the resume snapshot and compaction checkpoints", () => {
    const stored = migrateLegacyChat(legacyChat());
    expect(stored.resume).toEqual({
      resumeState: { threadId: "legacy-chat", runId: "run-3" },
      pendingInterrupts: [
        {
          id: "approval-1",
          reason: "tool_call",
          toolCallId: "call-2",
          metadata: {
            toolName: "delete",
            input: { path: "/chart.png" },
            "tanstack:interruptBinding": { generation: 0 },
          },
        },
      ],
    });
    expect(stored.metadata).toEqual({
      "@tanstack/ai-compaction": {
        "legacy-chat": {
          compactedMessages: [
            {
              role: "assistant",
              content:
                "<untrusted-conversation-summary>\nEarlier the user asked for a chart.\n</untrusted-conversation-summary>",
            },
          ],
        },
        "legacy-chat/child": { compactedMessages: [] },
      },
    });
    const bare = migrateLegacyChat({ ...legacyChat(), pendingRun: undefined, compactions: [] });
    expect(bare).not.toHaveProperty("resume");
    expect(bare).not.toHaveProperty("metadata");
  });

  it("keeps blob references so the migrated chat can be saved and loaded with its media", async () => {
    const memory = new MemoryOpfs();
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
    const legacy = legacyChat();
    const blobId = await opfs.storeChatBlob(
      legacy.id,
      new Blob([Buffer.from("YWJj", "base64")], { type: "image/png" }),
    );
    const image = legacy.messages[2].content[0];
    if (image.type !== "tool_result") throw new Error("Expected the tool result");
    (image.result[1] as { data: string }).data = `blob:${blobId}`;
    memory.put(`chats/${legacy.id}/chat.json`, JSON.stringify(legacy));

    const manifest = (await loadChat(legacy.id, false))!;
    expect(manifest.messages.map((message) => message.id)).toEqual(migrateLegacyChat(legacy).messages.map((m) => m.id));
    expect(collectChatBlobIds({ messages: manifest.messages })).toEqual([blobId]);
    expect(manifest.resume?.pendingInterrupts).toHaveLength(1);
    const loaded = await createAttachmentLoader(legacy.id)(manifest.messages);
    expect(toolResultMetadata(toolResultFor(loaded[1], "call-1")!).result?.[1]).toMatchObject({
      type: "image",
      source: { type: "data", value: "YWJj", mimeType: "image/png" },
    });

    await storeChat(manifest);
    const stored = await opfs.readJson<{ version: number; pendingRun?: unknown; messages: unknown[] }>(
      `chats/${legacy.id}/chat.json`,
    );
    expect(stored?.version).toBe(STORED_CHAT_VERSION);
    expect(stored).not.toHaveProperty("pendingRun");
    expect(JSON.stringify(stored)).not.toContain("@tanstack:");
    expect((await loadChat(legacy.id))!.messages).toMatchObject(loaded);
    vi.unstubAllGlobals();
  });
});
