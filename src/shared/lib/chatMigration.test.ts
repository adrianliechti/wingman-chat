import { afterEach, describe, expect, it, vi } from "vitest";
import { hashSchemaInput, normalizeApprovalSchema, type ToolResultPart } from "@tanstack/ai";
import { MemoryOpfs } from "@/shared/lib/test-support/memoryOpfs";
import { legacyChatPath, loadChat, storeChat } from "@/features/chat/lib/chatStorage";
import { createAttachmentLoader } from "@/features/chat/lib/chatAttachments";
import { isLegacyStoredChat, migrateLegacyChat, normalizeStoredChat, type LegacyStoredChat } from "./chatMigration";
import {
  assistantMessage,
  mediaFromDataUrl,
  messageMetadata,
  text,
  textMetadata,
  toolResultContent,
  toolResultFor,
  toolResultMetadata,
  uiResourceFor,
} from "./messages";
import { collectChatBlobIds, STORED_CHAT_VERSION } from "./opfs-chat";
import { readGatewayReasoning } from "./reasoning";
import * as opfs from "./opfs";

vi.mock("@/shared/config", () => ({ getConfig: () => ({ chat: {} }) }));

const signature = (value: object) => `@tanstack:${JSON.stringify(value)}`;
const inputSchema = { type: "object", properties: { path: { type: "string" } }, required: ["path"] };
const approvalSchema = normalizeApprovalSchema(undefined, inputSchema);
const approvalBinding = {
  kind: "tool-approval",
  interruptId: "approval-1",
  interruptedRunId: "run-3",
  generation: 0,
  toolCallId: "call-2",
  toolName: "delete",
  originalArgs: { path: "/chart.png" },
  inputSchemaHash: hashSchemaInput(inputSchema),
  approvalSchemaHash: approvalSchema.approvalSchemaHash,
  responseSchemaHash: approvalSchema.responseSchemaHash,
};
const BLOB = "blob:sha256-0123456789abcdef";
// OPFS caches its root handle, so every test that touches storage shares this store and resets it.
const memory = new MemoryOpfs();
function useMemoryStorage() {
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
}

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
          schema: approvalSchema.responseSchema,
          signature: signature({ "tanstack:interruptBinding": approvalBinding }),
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

  it("converts duplicate MIME and generated-file metadata once, preserving native values and the original", async () => {
    useMemoryStorage();
    const media = {
      type: "image" as const,
      source: { type: "url" as const, value: BLOB, mimeType: "image/webp" },
      metadata: { filename: "chart.png", contentType: "image/png" },
    };
    const message = assistantMessage([
      { type: "tool-call", id: "call", name: "execute_script", arguments: "{}", state: "complete", output: [media] },
      {
        type: "tool-result",
        toolCallId: "call",
        state: "complete",
        content: [media],
        metadata: { meta: { artifactFiles: ["/chart.webp"], status: "done" } },
      },
    ]);
    const record = { ...migrateLegacyChat(legacyChat()), messages: [message] };
    memory.put(`chats/${record.id}/chat.json`, JSON.stringify(record));
    const loaded = (await loadChat(record.id, false))!;
    expect(loaded.messages[0].parts[0]).toMatchObject({
      output: [{ source: { mimeType: "image/webp" }, metadata: { filename: "chart.png" } }],
    });
    expect(toolResultFor(loaded.messages[0], "call")).toMatchObject({
      content: [{ source: { mimeType: "image/webp" }, metadata: { filename: "chart.png" } }],
      metadata: { meta: { artifactDelta: { mutations: [{ operation: "create", path: "/chart.webp" }] } } },
    });
    expect(JSON.stringify(loaded.messages)).not.toMatch(/contentType|artifactFiles|status/);
    expect(await opfs.readJson(legacyChatPath(record.id))).toEqual(JSON.parse(JSON.stringify(record)));
    await storeChat(loaded);
    expect((await loadChat(record.id, false))!.messages).toEqual(loaded.messages);
    expect(normalizeStoredChat((await opfs.readJson<opfs.StoredChat>(`chats/${record.id}/chat.json`))!)).toEqual(
      await opfs.readJson(`chats/${record.id}/chat.json`),
    );
  });

  it("moves readable parts of damaged saved tool output into native content and preserves the recovery record", async () => {
    useMemoryStorage();
    const output = mediaFromDataUrl("data:image/png;base64,AQ==");
    const record = {
      ...migrateLegacyChat(legacyChat()),
      messages: [
        assistantMessage([
          {
            type: "tool-result",
            toolCallId: "damaged",
            content: "Old summary",
            state: "complete",
            metadata: { result: [output, { type: "image" }] },
          },
        ]),
      ],
    };
    memory.put(`chats/${record.id}/chat.json`, JSON.stringify(record));
    const loaded = (await loadChat(record.id, false))!;
    expect(toolResultFor(loaded.messages[0], "damaged")).toMatchObject({ content: [output] });
    expect(toolResultFor(loaded.messages[0], "damaged")).not.toHaveProperty("metadata");
    await storeChat(loaded);
    expect(await opfs.readJson(legacyChatPath(record.id))).toEqual(JSON.parse(JSON.stringify(record)));
    expect((await loadChat(record.id))!.messages).toEqual(loaded.messages);
  });

  it("converts saved create paths and interpreter file lists into artifact deltas", () => {
    const record = {
      ...migrateLegacyChat(legacyChat()),
      messages: [
        assistantMessage([
          { type: "tool-call", id: "create", name: "create_file", arguments: '{"path":"/old.txt"}', state: "complete" },
          { type: "tool-result", toolCallId: "create", content: '{"path":"/actual.txt"}', state: "complete" },
          { type: "tool-call", id: "script", name: "execute_python_code", arguments: "{}", state: "complete" },
          {
            type: "tool-result",
            toolCallId: "script",
            content: "Created",
            state: "complete",
            metadata: { meta: { artifactFiles: ["/generated.txt"] } },
          },
        ]),
      ],
    };
    const normalized = normalizeStoredChat(record);
    expect(toolResultFor(normalized.messages[0], "create")).toMatchObject({
      metadata: { meta: { artifactDelta: { mutations: [{ operation: "create", path: "/actual.txt" }] } } },
    });
    expect(toolResultFor(normalized.messages[0], "script")).toMatchObject({
      metadata: { meta: { artifactDelta: { mutations: [{ operation: "create", path: "/generated.txt" }] } } },
    });
    expect(JSON.stringify(normalized)).not.toContain("artifactFiles");
    expect(normalizeStoredChat(normalized)).toBe(normalized);
  });

  it("moves saved native text segments onto text parts, including nested conversations", () => {
    const old = assistantMessage("WorkingDone", {
      id: "phased",
      metadata: {
        runId: "run",
        textSegments: [
          { content: "Working", phase: "commentary" },
          { content: "Done", phase: "final_answer" },
        ],
      },
    });
    const stored = {
      ...migrateLegacyChat(legacyChat()),
      messages: [
        old,
        assistantMessage([
          {
            type: "subagent",
            subagent: { id: "child", name: "research", status: "finished", messages: [{ ...old, id: "nested" }] },
          },
        ]),
      ],
    };
    const normalized = normalizeStoredChat(stored);
    expect(normalized.messages[0]).toMatchObject({
      id: "phased",
      parts: [text("Working", { phase: "commentary" }), text("Done", { phase: "final_answer" })],
      metadata: { runId: "run" },
    });
    expect(JSON.stringify(normalized.messages)).not.toContain("textSegments");
    expect(JSON.stringify(normalized.messages)).toContain('"id":"nested"');
    expect(old.parts).toEqual([text("WorkingDone")]);
    expect(normalizeStoredChat(normalized)).toBe(normalized);
  });

  it("migrates legacy tool fields recursively while retaining the original MCP response", () => {
    const output = [text("Failed"), mediaFromDataUrl(BLOB, "report.png", "image")];
    const original = {
      content: [{ type: "resource_link", uri: "report://saved", name: "Report" }],
      structuredContent: { current: true },
      _meta: { private: "app-only" },
      isError: true,
    };
    const old: ToolResultPart = {
      type: "tool-result",
      toolCallId: "call",
      content: "Old summary",
      state: "complete",
      metadata: {
        result: output,
        error: { code: "MCP_TOOL_ERROR", message: "Failed" },
        content: { stale: true },
        meta: {
          toolProvider: "provider",
          toolResource: "ui://app",
          mcpResult: original,
          defaultDisplayMode: "fullscreen",
          appDisplayModes: ["fullscreen"],
          status: "done",
        },
        unrelated: "kept",
      },
    };
    const call = { type: "tool-call" as const, id: "call", name: "app", arguments: "{}", state: "complete" as const };
    const messages = [
      assistantMessage([call, old]),
      assistantMessage([
        {
          type: "subagent",
          subagent: { id: "child", name: "research", status: "finished", messages: [assistantMessage([call, old])] },
        },
      ]),
    ];
    const stored = { ...migrateLegacyChat(legacyChat()), messages };
    const normalized = normalizeStoredChat(stored);
    const expected = {
      type: "tool-result",
      toolCallId: "call",
      content: output,
      state: "error",
      error: "Failed",
      metadata: { unrelated: "kept" },
    };
    expect(toolResultFor(normalized.messages[0], "call")).toEqual(expected);
    const nested = normalized.messages[1].parts[0];
    if (nested.type !== "subagent") throw new Error("Expected subagent");
    expect(toolResultFor(nested.subagent.messages[0], "call")).toEqual(expected);
    const app = {
      type: "ui-resource",
      resource: { uri: "ui://app", mimeType: "text/html;profile=mcp-app" },
      serverId: "provider",
      toolCallId: "call",
      toolName: "app",
      meta: { appDisplayMode: "fullscreen", mcpResult: original },
    };
    expect(uiResourceFor(normalized.messages[0], "call")).toEqual(app);
    expect(uiResourceFor(nested.subagent.messages[0], "call")).toEqual(app);
    expect(collectChatBlobIds(normalized)).toEqual([BLOB.slice(5)]);
    expect(old.metadata).toHaveProperty("result", output);
    expect(normalizeStoredChat(normalized)).toBe(normalized);
  });

  it("retains legacy structured app data without duplicating it and omits unused copies", () => {
    const old: ToolResultPart = {
      type: "tool-result",
      toolCallId: "call",
      content: [text("Saved")],
      state: "complete",
      metadata: {
        content: { count: 2 },
        meta: {
          toolProvider: "provider",
          toolResource: "ui://app",
          appDisplayMode: "inline",
          defaultDisplayMode: "fullscreen",
        },
      },
    };
    const plain = { ...old, toolCallId: "plain", metadata: { content: { unused: true } } };
    const empty = { ...old, toolCallId: "empty", metadata: { result: [] } };
    const unreadable = { ...old, toolCallId: "unreadable", metadata: { result: [{ type: "image" }] } };
    const stored = {
      ...migrateLegacyChat(legacyChat()),
      messages: [assistantMessage([old, plain, empty, unreadable])],
    };
    const normalized = normalizeStoredChat(stored);
    expect(toolResultMetadata(toolResultFor(normalized.messages[0], "call")!)).toEqual({
      meta: {
        toolProvider: "provider",
        toolResource: "ui://app",
        appDisplayMode: "inline",
        mcpResult: { structuredContent: { count: 2 } },
      },
    });
    expect(toolResultFor(normalized.messages[0], "plain")!).not.toHaveProperty("metadata");
    expect(toolResultFor(normalized.messages[0], "empty")!).toMatchObject({ content: [] });
    expect(toolResultFor(normalized.messages[0], "unreadable")).toEqual({
      type: "tool-result",
      toolCallId: "unreadable",
      content: [text("Saved")],
      state: "complete",
    });
    expect(normalizeStoredChat(normalized)).toBe(normalized);
  });

  it("migrates structured app data from records saved before the native transcript", () => {
    const legacy = legacyChat();
    const old = legacy.messages[2].content[0];
    if (old.type !== "tool_result") throw new Error("Expected legacy result");
    old.meta = {
      toolProvider: "provider",
      toolResource: "ui://app",
      defaultDisplayMode: "inline",
      appDisplayModes: ["inline"],
    };
    const migrated = migrateLegacyChat(legacy);
    expect(toolResultFor(migrated.messages[1], "call-1")).not.toHaveProperty("metadata");
    expect(uiResourceFor(migrated.messages[1], "call-1")).toEqual({
      type: "ui-resource",
      resource: { uri: "ui://app", mimeType: "text/html;profile=mcp-app" },
      serverId: "provider",
      toolCallId: "call-1",
      toolName: "render",
      meta: { appDisplayMode: "inline", mcpResult: { structuredContent: { structured: true } } },
    });
    expect(normalizeStoredChat(migrated)).toBe(migrated);
  });

  it("moves legacy results onto existing native widgets while preserving native data", () => {
    const app = {
      type: "ui-resource" as const,
      resource: { uri: "ui://app", mimeType: "text/html;profile=mcp-app", text: "<p>Saved</p>" },
      serverId: "provider",
      toolCallId: "call",
      toolName: "app",
      meta: {
        ui: { permissions: { microphone: {} } },
        appDisplayMode: "inline",
        mcpResult: { content: [], structuredContent: { current: true } },
      },
    };
    const result: ToolResultPart = {
      type: "tool-result",
      toolCallId: "call",
      content: "Saved",
      state: "complete",
      metadata: { meta: { mcpResult: { structuredContent: { stale: true } }, appDisplayMode: "fullscreen" } },
    };
    const emptyApp = { ...app, toolCallId: "other", meta: undefined };
    const other = { ...result, toolCallId: "other" };
    const stored = { ...migrateLegacyChat(legacyChat()), messages: [assistantMessage([app, result, emptyApp, other])] };
    const normalized = normalizeStoredChat(stored);
    expect(uiResourceFor(normalized.messages[0], "call")).toEqual(app);
    expect(uiResourceFor(normalized.messages[0], "other")).toMatchObject({
      resource: app.resource,
      meta: { appDisplayMode: "fullscreen", mcpResult: { structuredContent: { stale: true } } },
    });
    expect(toolResultFor(normalized.messages[0], "call")).not.toHaveProperty("metadata");
    expect(toolResultFor(normalized.messages[0], "other")).not.toHaveProperty("metadata");
    expect(normalizeStoredChat(normalized)).toBe(normalized);
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
      content: [
        { type: "text", content: "Rendered" },
        {
          type: "image",
          source: { type: "url", value: BLOB, mimeType: "image/png" },
          metadata: { filename: "chart.png" },
        },
      ],
    });
    expect(toolResultMetadata(result)).toEqual({
      meta: { artifactDelta: { mutations: [{ operation: "create", path: "/chart.png" }] } },
    });

    expect(a2.parts).toEqual([
      { type: "text", content: "Here it is. ", metadata: { phase: "commentary" } },
      { type: "text", content: "Done.", metadata: { phase: "final_answer" } },
    ]);
    expect(a2.metadata).not.toHaveProperty("textSegments");

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
    expect(toolResultFor(card.subagent.messages[1], "inner")).toMatchObject({
      content: [{ type: "text", content: "Evidence" }],
    });

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
    expect(toolResultFor(a3, "delegate")).toMatchObject({
      state: "complete",
      content: [{ type: "text", content: "Checked." }],
    });
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
          responseSchema: approvalSchema.responseSchema,
          metadata: {
            toolName: "delete",
            input: { path: "/chart.png" },
            "tanstack:interruptBinding": approvalBinding,
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
    useMemoryStorage();
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
    expect(toolResultContent(toolResultFor(loaded[1], "call-1")!)[1]).toMatchObject({
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

describe("legacy chat migration of damaged records", () => {
  const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
  afterEach(() => {
    warnings.mockClear();
    vi.unstubAllGlobals();
  });
  /** The fixture with its JSON bent out of shape; the type says what the file claims, not what it holds. */
  const damaged = (mutate: (chat: Record<string, unknown>) => void): LegacyStoredChat => {
    const chat = JSON.parse(JSON.stringify(legacyChat())) as Record<string, unknown>;
    mutate(chat);
    return chat as unknown as LegacyStoredChat;
  };
  const warned = () => warnings.mock.calls.map((call) => String(call[0]));

  it("drops an unknown part with a warning and keeps the rest of the message", () => {
    const chat = damaged((raw) => {
      const messages = raw.messages as { content: unknown[] }[];
      messages[3].content.splice(1, 0, {
        type: "citation",
        url: "https://example.com",
      });
    });
    const migrated = migrateLegacyChat(chat);
    const a2 = migrated.messages.find((message) => message.id === "a2")!;
    expect(a2.parts.map((part) => part.type)).toEqual(["text", "text"]);
    expect(warned()).toEqual([expect.stringContaining("dropped citation part 1 of message a2")]);
  });

  it("drops null and primitive parts without losing readable turns or text phases", () => {
    const chat = damaged((raw) => {
      const messages = raw.messages as { content: unknown[] }[];
      messages[3].content.splice(1, 0, null, 42, "unreadable");
    });
    expect(migrateLegacyChat(chat)).toEqual(migrateLegacyChat(legacyChat()));
    expect(warned()).toEqual([
      expect.stringContaining("dropped unknown part 1 of message a2"),
      expect.stringContaining("dropped unknown part 2 of message a2"),
      expect.stringContaining("dropped unknown part 3 of message a2"),
    ]);
  });

  it("keeps a subagent conversation when one of its parts is null", () => {
    const chat = damaged((raw) => {
      const messages = raw.messages as { content: Record<string, unknown>[] }[];
      const child = messages[7].content[1].messages as { content: unknown[] }[];
      child[0].content.push(null);
    });
    expect(migrateLegacyChat(chat)).toEqual(migrateLegacyChat(legacyChat()));
    expect(warned()).toEqual([expect.stringContaining("dropped unknown part 1 of message legacy-child-0")]);
  });

  it.each(["text", "summary", "runtime_feedback", "reasoning"])("drops a %s part with unreadable text", (type) => {
    const chat = damaged((raw) => {
      const messages = raw.messages as { content: unknown[] }[];
      messages[0].content.push({ type, text: { damaged: true }, source: "verification" });
      messages[3].content.push({ type: "text", text: null, phase: "final_answer" });
    });
    expect(migrateLegacyChat(chat)).toEqual(migrateLegacyChat(legacyChat()));
    expect(warned()).toEqual([
      expect.stringContaining(`dropped ${type} part 1 of message u1`),
      expect.stringContaining("dropped text part 2 of message a2"),
    ]);
  });

  it("drops a tool result with unreadable text instead of passing it to the renderer", () => {
    const chat = damaged((raw) => {
      const messages = raw.messages as { content: Record<string, unknown>[] }[];
      (messages[2].content[0].result as Record<string, unknown>[])[0].text = { damaged: true };
    });
    const a1 = migrateLegacyChat(chat).messages.find((message) => message.id === "a1")!;
    expect(a1.parts.map((part) => part.type)).toEqual(["thinking", "tool-call"]);
    expect(warned()).toEqual([expect.stringContaining("dropped tool_result part 0")]);
  });

  it("drops a message without content and keeps the surrounding turns", () => {
    const chat = damaged((raw) => {
      const messages = raw.messages as Record<string, unknown>[];
      delete messages[0].content;
      messages.splice(1, 0, null as unknown as Record<string, unknown>, {
        role: "system",
        content: [],
      });
    });
    const migrated = migrateLegacyChat(chat);
    expect(migrated.messages.map((message) => message.id)).toEqual(
      migrateLegacyChat(legacyChat())
        .messages.map((message) => message.id)
        .filter((id) => id !== "u1"),
    );
    expect(warned()).toEqual([
      expect.stringContaining("dropped message 0"),
      expect.stringContaining("dropped message 1"),
      expect.stringContaining("dropped message 2"),
    ]);
  });

  it("drops media without data and tool results without output, leaving the call in place", () => {
    const chat = damaged((raw) => {
      const messages = raw.messages as { content: Record<string, unknown>[] }[];
      delete (messages[2].content[0].result as Record<string, unknown>[])[1].data;
    });
    const migrated = migrateLegacyChat(chat);
    const a1 = migrated.messages.find((message) => message.id === "a1")!;
    expect(a1.parts.map((part) => part.type)).toEqual(["thinking", "tool-call"]);
    expect(a1.parts[1]).toMatchObject({
      type: "tool-call",
      id: "call-1",
      state: "complete",
    });
    expect(warned()).toEqual([expect.stringContaining("dropped tool_result part 0")]);

    const noOutput = damaged((raw) => {
      const messages = raw.messages as { content: Record<string, unknown>[] }[];
      messages[2].content[0].result = "Rendered";
    });
    expect(migrateLegacyChat(noOutput).messages.find((message) => message.id === "a1")!.parts).toHaveLength(2);
  });

  it("replaces unreadable dates so the migrated chat can be saved", async () => {
    useMemoryStorage();
    const chat = damaged((raw) => {
      raw.created = "yesterday";
      raw.updated = 1735776000000;
      (raw.messages as Record<string, unknown>[])[0].createdAt = "not a date";
    });
    const migrated = migrateLegacyChat(chat);
    expect(migrated.created).toBeNull();
    expect(migrated.updated).toBe("2025-01-02T00:00:00.000Z");
    expect(migrated.messages[0].createdAt).toEqual(new Date(0));
    expect(warned()).toEqual([expect.stringContaining('unreadable created date "yesterday"')]);

    memory.put(`chats/${chat.id}/chat.json`, JSON.stringify(chat));
    const loaded = (await loadChat(chat.id, false))!;
    await expect(storeChat(loaded)).resolves.toBeUndefined();
    expect((await loadChat(chat.id, false))!.updated).toEqual(new Date("2025-01-02T00:00:00.000Z"));
  });

  it("tolerates missing or malformed runtime state", () => {
    const chat = damaged((raw) => {
      delete raw.messages;
      raw.pendingRun = { id: "run", interrupts: "none" };
      raw.compactions = { signature: "@tanstack:{}" };
      raw.model = "gpt";
      raw.title = 42;
    });
    const migrated = migrateLegacyChat(chat);
    expect(migrated).toMatchObject({
      version: STORED_CHAT_VERSION,
      id: "legacy-chat",
      messages: [],
      model: null,
    });
    expect(migrated).not.toHaveProperty("resume");
    expect(migrated).not.toHaveProperty("metadata");
    expect(migrated.title).toBeUndefined();
    expect(warned()).toEqual([expect.stringContaining("messages that are not a list")]);
  });

  it("migrates every unversioned record and leaves unknown versions alone", () => {
    expect(isLegacyStoredChat({ messages: "nope" as unknown as unknown[] })).toBe(true);
    expect(isLegacyStoredChat({ version: 3, messages: [] })).toBe(false);
    const future = {
      version: 3,
      id: "x",
      messages: [],
    } as unknown as LegacyStoredChat;
    expect(normalizeStoredChat(future)).toBe(future);
  });

  it("keeps the original record beside the first native save", async () => {
    useMemoryStorage();
    const chat = damaged((raw) => {
      (raw.messages as { content: unknown[] }[])[3].content.push({
        type: "citation",
      });
    });
    memory.put(`chats/${chat.id}/chat.json`, JSON.stringify(chat));

    const loaded = (await loadChat(chat.id, false))!;
    expect(await opfs.readJson(legacyChatPath(chat.id))).toEqual(JSON.parse(JSON.stringify(chat)));
    expect(await opfs.fileExists(legacyChatPath(chat.id))).toBe(true);

    await storeChat({ ...loaded, title: "Renamed" });
    expect((await opfs.readJson<{ version: number }>(`chats/${chat.id}/chat.json`))?.version).toBe(STORED_CHAT_VERSION);
    // The copy is the untouched original, even after the migrated chat was loaded and saved again.
    await loadChat(chat.id, false);
    expect(await opfs.readJson(legacyChatPath(chat.id))).toEqual(JSON.parse(JSON.stringify(chat)));
    expect(JSON.stringify(await opfs.readJson(legacyChatPath(chat.id)))).toContain("citation");
  });

  it("retains recovery attachments from dropped results and unknown nested parts across saves", async () => {
    useMemoryStorage();
    const childBlob = "sha256-child";
    const chat = damaged((raw) => {
      const messages = raw.messages as { content: Record<string, unknown>[] }[];
      (messages[2].content[0].result as unknown[]).push({ type: "image" });
      const child = messages[7].content[1].messages as { content: unknown[] }[];
      child[0].content.push({ type: "unknown", payload: [null, { data: `blob:${childBlob}` }] });
    });
    const blobId = opfs.parseBlobRef(BLOB)!;
    memory.put(`chats/${chat.id}/chat.json`, JSON.stringify(chat));
    memory.put(`chats/${chat.id}/blobs/${blobId}.bin`, "original image");
    memory.put(`chats/${chat.id}/blobs/${childBlob}.bin`, "child image");
    memory.put(`chats/${chat.id}/blobs/unused.bin`, "unused image");

    const loaded = (await loadChat(chat.id, false))!;
    expect(collectChatBlobIds({ messages: loaded.messages })).toEqual([]);
    await storeChat(loaded);
    expect(await opfs.listChatBlobs(chat.id)).toEqual(expect.arrayContaining([blobId, childBlob]));
    expect(await opfs.fileExists(`chats/${chat.id}/blobs/unused.bin`)).toBe(false);

    await storeChat({ ...(await loadChat(chat.id, false))!, title: "Renamed" });
    expect(await (await opfs.getChatBlob(chat.id, blobId))?.text()).toBe("original image");
    expect(await (await opfs.getChatBlob(chat.id, childBlob))?.text()).toBe("child image");
    expect(await opfs.readJson(legacyChatPath(chat.id))).toEqual(JSON.parse(JSON.stringify(chat)));
  });

  it("skips blob cleanup when the recovery record cannot be read", async () => {
    useMemoryStorage();
    const chat = legacyChat();
    memory.put(`chats/${chat.id}/chat.json`, JSON.stringify(chat));
    const loaded = (await loadChat(chat.id, false))!;
    memory.put(`chats/${chat.id}/blobs/recovery.bin`, "recovery bytes");
    memory.put(legacyChatPath(chat.id), "invalid JSON");

    await expect(storeChat(loaded)).resolves.toBeUndefined();
    expect(await opfs.fileExists(`chats/${chat.id}/blobs/recovery.bin`)).toBe(true);
    expect(warned()).toEqual(["Chat blob cleanup failed:"]);
    expect((await loadChat(chat.id, false))?.messages).toEqual(loaded.messages);
  });

  it("still opens the chat when the original record cannot be kept", async () => {
    useMemoryStorage();
    const chat = legacyChat();
    memory.put(`chats/${chat.id}/chat.json`, JSON.stringify(chat));
    // A directory squatting on the copy's path makes the write fail the way a full or locked store would.
    memory.put(`${legacyChatPath(chat.id)}/blocker`, "");
    expect((await loadChat(chat.id, false))?.messages.length).toBeGreaterThan(0);
    expect(warned()).toEqual([expect.stringContaining("Could not keep the pre-migration record")]);
  });
});
