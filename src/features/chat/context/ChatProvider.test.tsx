import { useContext } from "react";
import { renderToString } from "react-dom/server";
import { testClient } from "@/shared/lib/test-support/ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chat, Message, Tool, ToolContext } from "@/shared/types/chat";
import { ChatContext, type ChatContextType } from "./ChatContext";
import { ChatProvider } from "./ChatProvider";
import type { verifyArtifacts } from "@/features/artifacts/lib/artifact-verifier";
import { MemoryManager } from "@/features/agent/lib/memoryManager";
import { memoryRevision } from "@/features/agent/lib/memoryDocument";
import { MemoryOpfs } from "@/shared/lib/test-support/memoryOpfs";

const fixture = vi.hoisted(() => ({
  chats: [] as Chat[],
  tools: [] as Tool[],
  model: { id: "model", name: "Model", compactThreshold: 1000 },
  chat: {} as { compaction?: { threshold?: number } },
  complete: vi.fn<Parameters<typeof testClient>[0]>(),
  classify: vi.fn(),
  artifacts: false,
  verify: vi.fn<typeof verifyArtifacts>(),
  memory: undefined as MemoryManager | undefined,
}));
vi.mock("@/shared/config", () => ({
  getConfig: () => ({
    client: Object.assign(testClient(fixture.complete), {
      classifyChat: fixture.classify,
    }),
    chat: fixture.chat,
  }),
  categorySlug: (name: string) => name,
  riskSlug: (name: string) => name,
}));
vi.mock("@/features/agent/hooks/useAgents", () => ({ useAgents: () => ({ currentAgent: null }) }));
vi.mock("@/features/artifacts/hooks/useArtifacts", () => ({
  useArtifacts: () => ({ isAvailable: fixture.artifacts, setFileSystem: vi.fn(), setEditRequestHandler: vi.fn() }),
}));
vi.mock("@/features/artifacts/lib/artifact-verifier", () => ({ verifyArtifacts: fixture.verify }));
vi.mock("@/features/artifacts/lib/fs", () => ({
  FileSystemManager: class {
    chatId: string;
    constructor(chatId: string) {
      this.chatId = chatId;
    }
  },
  resolveArtifactFileSystem: (_fs: unknown, chatId: string) => ({ chatId }),
}));
vi.mock("@/features/chat/hooks/useChatContext", () => ({
  useChatContext: () => ({
    tools: async () => fixture.tools,
    instructions: () => "Instructions",
    middleware: () => [],
    runtimeContext: () => "",
    memory: () => fixture.memory,
  }),
}));
vi.mock("@/features/chat/hooks/useModels", () => ({
  useModels: () => ({
    models: [fixture.model],
    selectedModel: fixture.model,
    setSelectedModel: vi.fn(),
    getSavedModelId: () => "model",
  }),
}));
vi.mock("@/features/chat/hooks/useChats", () => ({
  useChats: () => ({
    chats: fixture.chats,
    getChat: (id: string) => fixture.chats.find((chat) => chat.id === id),
    loadChat: async (id: string) => fixture.chats.find((chat) => chat.id === id)!,
    searchChats: vi.fn(),
    isLoaded: true,
    createChat: async () => {
      const chat: Chat = {
        id: "chat",
        title: "Test",
        model: fixture.model,
        messages: [],
        created: null,
        updated: null,
      };
      fixture.chats.push(chat);
      return chat;
    },
    updateChat: (id: string, updater: (chat: Chat) => Partial<Chat>) => {
      const chat = fixture.chats.find((item) => item.id === id)!;
      fixture.chats = fixture.chats.map((item) => (item.id === id ? { ...chat, ...updater(chat) } : item));
    },
    deleteChat: vi.fn(),
  }),
}));
vi.mock("@/features/tools/lib/llmCommand", () => ({ setModel: vi.fn() }));
vi.mock("@/shared/lib/notify", () => ({ notify: { error: vi.fn() } }));
vi.mock("@/shell/hooks/useApp", () => ({ useApp: () => ({ closeApp: vi.fn() }) }));

const user = (text: string): Message => ({ role: "user", content: [{ type: "text", text }] });
const assistant = (text: string): Message => ({ role: "assistant", content: [{ type: "text", text }] });
const call: Message = {
  role: "assistant",
  content: [{ type: "tool_call", id: "call", name: "work", arguments: "{}" }],
};
const overflow = () =>
  Object.assign(new Error("Context is too large"), { status: 400, code: "context_length_exceeded" });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function harness() {
  let context!: ChatContextType;
  function Capture() {
    context = useContext(ChatContext)!;
    return null;
  }
  renderToString(
    <ChatProvider>
      <Capture />
    </ChatProvider>,
  );
  return context;
}
beforeEach(() => {
  fixture.chats.length = 0;
  fixture.tools = [];
  fixture.chat = {};
  fixture.artifacts = false;
  fixture.memory = undefined;
  fixture.verify.mockReset().mockResolvedValue([]);
  fixture.complete.mockReset();
  fixture.classify.mockReset().mockResolvedValue({ title: "Test", categories: [], risks: [] });
  vi.stubGlobal("window", { setTimeout, clearTimeout });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("chat run integration", () => {
  it("loads memory before the first request and keeps one snapshot throughout the tool loop", async () => {
    vi.useFakeTimers();
    const disk = new MemoryOpfs();
    vi.stubGlobal("navigator", { storage: { getDirectory: async () => disk.root } });
    disk.put("agents/agent/AGENTS.md", "---\nname: Agent\nmemory: true\n---\n");
    const manager = new MemoryManager("agent");
    fixture.memory = manager;
    await manager.write("/.memory/preference.md", "---\ntype: Preference\ncore: true\n---\nPrefer concise answers.");
    fixture.tools = [
      {
        name: "work",
        parameters: { type: "object" },
        function: async () => {
          const before = (await manager.snapshot()).files.get("preference.md")!;
          await manager.write("/.memory/preference.md", "A different preference.", await memoryRevision(before));
          return [{ type: "text", text: "Done" }];
        },
      },
    ];
    fixture.complete.mockResolvedValueOnce(call).mockResolvedValueOnce(assistant("Finished"));
    await harness().sendMessage(user("Please work on this task."));
    expect(fixture.complete).toHaveBeenCalledTimes(2);
    for (const request of fixture.complete.mock.calls) {
      expect(JSON.stringify(request[0].messages)).toContain("Prefer concise answers.");
      expect(JSON.stringify(request[0].messages)).not.toContain("A different preference.");
    }
    expect(JSON.stringify(fixture.chats[0].messages)).not.toContain("<memory>");
    expect((await manager.snapshot()).state.jobs).toHaveLength(1);
  });

  it("gives workspace findings to the next native model turn", async () => {
    fixture.artifacts = true;
    fixture.tools = [
      {
        name: "work",
        parameters: { type: "object" },
        function: async (_args, context) => {
          context?.setMeta?.({ artifactDelta: { mutations: [{ operation: "create", path: "/game.html" }] } });
          return [{ type: "text", text: "Saved" }];
        },
      },
    ];
    fixture.verify.mockResolvedValue([
      { id: "html.local-ref", scope: "/game.html", status: "fail", message: "Fix the missing local script." },
    ]);
    fixture.complete
      .mockResolvedValueOnce(call)
      .mockResolvedValueOnce(assistant("The local script still needs fixing."));
    await harness().sendMessage(user("Build a game"));
    expect(fixture.verify).toHaveBeenCalledOnce();
    expect(fixture.verify).toHaveBeenCalledWith({ chatId: "chat" }, new Set(["/game.html"]), expect.any(AbortSignal));
    expect(fixture.complete).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(fixture.complete.mock.calls[1][0].messages)).toContain("Fix the missing local script.");
    expect(JSON.stringify(fixture.chats[0].messages)).not.toContain("Workspace verification findings");
  });

  it("retains late tool metadata across later history commits", async () => {
    let toolContext: ToolContext | undefined;
    fixture.tools = [
      {
        name: "work",
        parameters: { type: "object" },
        function: async (_args, context) => {
          toolContext = context;
          context?.setMeta?.({ progress: "running", obsolete: true });
          return [{ type: "text", text: "Done" }];
        },
      },
    ];
    fixture.complete.mockResolvedValueOnce(call).mockImplementationOnce(async () => {
      toolContext?.setMeta?.({ progress: "finished" });
      toolContext?.updateMeta?.({ link: "/result" });
      return assistant("Final answer");
    });
    await harness().sendMessage(user("Work"));
    const result = fixture.chats[0].messages
      .flatMap((message) => message.content)
      .find((part) => part.type === "tool_result");
    expect(result).toMatchObject({ meta: { progress: "finished", link: "/result" } });
    expect(result && "meta" in result && result.meta).not.toHaveProperty("obsolete");
  });

  it("ignores a late classification from an older run", async () => {
    const old = deferred();
    fixture.classify
      .mockImplementationOnce(async () => {
        await old.promise;
        return { title: "Stale title", categories: [], risks: [] };
      })
      .mockResolvedValueOnce({ title: "Current title", categories: [], risks: [] });
    fixture.complete.mockResolvedValue(assistant("Done"));
    const context = harness();
    await context.sendMessage(user("First"));
    await context.sendMessage(user("Second"));
    old.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fixture.chats[0].title).not.toBe("Stale title");
  });
  it("compacts provider context natively while preserving the full saved transcript", async () => {
    fixture.complete.mockResolvedValueOnce(assistant("Earlier evidence ".repeat(1000)));
    const context = harness();
    await context.sendMessage(user("Remember the evidence"));
    fixture.chat.compaction = {};
    fixture.complete
      .mockResolvedValueOnce(assistant("The evidence was checked."))
      .mockImplementationOnce(async ({ messages }) => {
        expect(JSON.stringify(messages)).toContain("untrusted-conversation-summary");
        expect(JSON.stringify(messages)).toContain("The evidence was checked.");
        expect(JSON.stringify(messages)).toContain("Current request");
        return assistant("Done");
      });
    await context.sendMessage(user("Current request"));
    expect(fixture.complete).toHaveBeenCalledTimes(3);
    expect(fixture.chats[0].messages.at(-1)?.content).toEqual(assistant("Done").content);
    expect(JSON.stringify(fixture.chats[0].messages)).toContain("Earlier evidence ".repeat(1000));
    expect(JSON.stringify(fixture.chats[0].messages)).not.toContain("untrusted-conversation-summary");
  });

  it("honors disabled compaction on overflow and preserves the actionable error", async () => {
    fixture.complete.mockRejectedValueOnce(overflow());
    await harness().sendMessage(user("Work"));
    expect(fixture.chats[0].messages.at(-1)?.error).toEqual({
      code: "CONTEXT_EXHAUSTED",
      message: "Context is too large",
    });
  });

  it("ignores a stopped run settling after the next run starts", async () => {
    const first = deferred();
    const second = deferred();
    fixture.complete
      .mockImplementationOnce(async (_options, onStream) => {
        onStream?.(assistant("First partial").content);
        await first.promise;
        onStream?.(assistant("Stale late update").content);
        return assistant("Stale final answer");
      })
      .mockImplementationOnce(async (_options, onStream) => {
        onStream?.(assistant("Second partial").content);
        await second.promise;
        return assistant("Second final");
      });
    const context = harness();
    const firstRun = context.sendMessage(user("First request"));
    await vi.waitFor(() => expect(fixture.complete).toHaveBeenCalledTimes(1));
    context.stopStreaming();
    const secondRun = context.sendMessage(user("Second request"));
    await vi.waitFor(() => expect(fixture.complete).toHaveBeenCalledTimes(2));
    first.resolve();
    await firstRun;
    context.stopStreaming();
    expect(fixture.complete.mock.calls[1][0].request?.signal?.aborted).toBe(true);
    second.resolve();
    await secondRun;
    const content = JSON.stringify(fixture.chats[0].messages);
    expect(content).toContain("First partial");
    expect(content).toContain("Second partial");
    expect(content).not.toContain("Stale");
  });

  it("settles a pending elicitation when stopped", async () => {
    const elicited = vi.fn();
    fixture.tools = [
      {
        name: "work",
        parameters: { type: "object" },
        function: async (_args, context) => {
          elicited();
          const result = await context!.elicit!({
            mode: "form",
            message: "Choose",
            requestedSchema: { type: "object", properties: {} },
          });
          expect(result.action).toBe("cancel");
          return [];
        },
      },
    ];
    fixture.complete.mockResolvedValueOnce(call);
    const context = harness();
    const pending = context.sendMessage(user("Start"));
    await vi.waitFor(() => expect(elicited).toHaveBeenCalled());
    context.stopStreaming();
    await pending;
    expect(fixture.complete).toHaveBeenCalledTimes(1);
  });

  it("queues tool-originated follow-ups until the current tool exchange finishes", async () => {
    fixture.tools = [
      {
        name: "work",
        parameters: { type: "object" },
        function: async (_args, context) => {
          await context!.sendMessage!(user("Follow-up"));
          return [{ type: "text", text: "Tool finished" }];
        },
      },
    ];
    fixture.complete
      .mockResolvedValueOnce(call)
      .mockResolvedValueOnce(assistant("First done"))
      .mockResolvedValueOnce(assistant("Follow-up done"));
    await harness().sendMessage(user("Start"));
    const messages = fixture.chats[0].messages;
    expect(messages.map((message) => message.content[0].type)).toEqual([
      "text",
      "tool_call",
      "tool_result",
      "text",
      "text",
      "text",
    ]);
    expect(messages.at(-1)?.content).toEqual(assistant("Follow-up done").content);
    expect(fixture.complete.mock.calls[2][0].messages.some((message) => message.role === "tool")).toBe(true);
  });
});
