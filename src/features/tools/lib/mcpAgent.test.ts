import { expect, it, vi } from "vitest";
import { z } from "zod";
import type { ToolContext } from "@/shared/types/chat";
import type { ChatMiddleware } from "@tanstack/ai";
import { assistant, calls, output, testClient } from "@/shared/lib/test-support/ai";
import { boundInterrupt, chatSession } from "@/shared/lib/test-support/chatSession";
import type { Tool } from "@/shared/types/chat";
import { createMcpAgentChat, mcpAgentToolName } from "./mcpAgent";

const createAgent = (tools: Tool[]) => createMcpAgentChat({ id: "internet", name: "Web Search", tools }).tools[0];

it("reviews a prompt once and isolates all subsequent searches and reads", async () => {
  const contexts: ToolContext[] = [];
  const execute = vi.fn(async (_args, execution) => {
    contexts.push(execution.context);
    return output("Public evidence");
  });
  const research = createAgent([
    { name: "search", description: "Search", inputSchema: z.looseObject({}), execute },
    { name: "fetch", description: "Read", inputSchema: z.looseObject({}), execute },
  ]);
  const complete = vi
    .fn()
    .mockResolvedValueOnce(calls(["research", research.name, { prompt: "Research public regulations" }]))
    .mockResolvedValueOnce(calls(["search", "search", { query: "Public regulations" }]))
    .mockResolvedValueOnce(calls(["fetch", "fetch", { url: "https://example.test/rules" }]))
    .mockResolvedValueOnce(assistant("Public report"))
    .mockResolvedValueOnce(assistant("Final answer"));
  const content = vi.fn(() => []);
  const elicit = vi.fn();
  const shared = vi.fn<NonNullable<ChatMiddleware["onStart"]>>();
  const session = chatSession(
    testClient(complete),
    [research],
    {},
    {
      createToolContext: () => ({ content, elicit, chatId: "PRIVATE_CHAT" }),
      sharedMiddleware: () => [{ onStart: shared }],
      prepareMessages: (messages) => [...messages, { role: "user", content: "PRIVATE_MEMORY_AND_ATTACHMENT" }],
    },
  );
  try {
    await session.ai.sendMessage("Original CLIENT_SECRET");
    expect(complete).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
    const approval = boundInterrupt(session.ai.getInterruptState().interrupts[0]);
    expect(approval.kind).toBe("tool-approval");
    approval.resolveInterrupt(true);
    await expect.poll(() => session.finished.at(-1)?.status).toBe("completed");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(session.ai.getInterruptState().interrupts).toHaveLength(0);
    for (const [request] of complete.mock.calls.slice(1, 4)) {
      const child = JSON.stringify(request);
      expect(child).toContain("Research public regulations");
      expect(child).not.toContain("CLIENT_SECRET");
      expect(child).not.toContain("PRIVATE_MEMORY_AND_ATTACHMENT");
    }
    for (const context of contexts) {
      expect(context).not.toHaveProperty("content");
      expect(context).not.toHaveProperty("elicit");
      expect(context.chatId).toBeUndefined();
    }
    expect(content).not.toHaveBeenCalled();
    expect(elicit).not.toHaveBeenCalled();
    expect(shared).toHaveBeenCalledTimes(2);
  } finally {
    session.ai.dispose();
  }
});

it("requires a fresh approval when the parent proposes another prompt", async () => {
  const research = createAgent([]);
  const complete = vi
    .fn()
    .mockResolvedValueOnce(calls(["first", research.name, { prompt: "Public rules" }]))
    .mockResolvedValueOnce(assistant("Public findings"))
    .mockResolvedValueOnce(calls(["second", research.name, { prompt: "Additional context" }]))
    .mockResolvedValueOnce(assistant("More findings"))
    .mockResolvedValueOnce(assistant("Final answer"));
  const session = chatSession(testClient(complete), [research]);
  try {
    await session.ai.sendMessage("Research");
    const first = session.ai.getInterruptState().interrupts[0];
    boundInterrupt(first).resolveInterrupt(true);
    await expect.poll(() => session.ai.getInterruptState().interrupts[0]?.id).not.toBe(first.id);
    await expect.poll(() => session.ai.getInterruptState().interrupts.length).toBe(1);
    expect(complete).toHaveBeenCalledTimes(3);
    boundInterrupt(session.ai.getInterruptState().interrupts[0]).resolveInterrupt(true);
    await expect.poll(() => session.finished.at(-1)?.status).toBe("completed");
    expect(complete).toHaveBeenCalledTimes(5);
    expect(JSON.stringify(complete.mock.calls[3][0].messages)).not.toContain("Public findings");
  } finally {
    session.ai.dispose();
  }
});

it("Stop aborts an approved worker without accepting late findings or starting another web call", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const execute = vi.fn(async (_args, execution) => {
    await pending;
    execution.context.signal.throwIfAborted();
    return output("Late findings");
  });
  const research = createAgent([{ name: "search", description: "Search", inputSchema: z.looseObject({}), execute }]);
  const complete = vi
    .fn()
    .mockResolvedValueOnce(calls(["research", research.name, { prompt: "Public rules" }]))
    .mockResolvedValueOnce(calls(["search", "search", { query: "Public rules" }]));
  const session = chatSession(testClient(complete), [research]);
  try {
    await session.ai.sendMessage("Research");
    boundInterrupt(session.ai.getInterruptState().interrupts[0]).resolveInterrupt(true);
    await expect.poll(() => execute.mock.calls.length).toBe(1);
    session.ai.stop();
    release();
    await expect.poll(() => session.finished.at(-1)?.status).toBe("aborted");
    expect(complete).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(session.ai.getMessages())).not.toContain("Late findings");
  } finally {
    release();
    session.ai.dispose();
  }
});

it("declining never starts the worker", async () => {
  const research = createAgent([]);
  const complete = vi
    .fn()
    .mockResolvedValueOnce(calls(["research", mcpAgentToolName("internet"), { prompt: "Find public rules" }]))
    .mockResolvedValueOnce(assistant("Research declined"));
  const session = chatSession(testClient(complete), [research]);
  try {
    await session.ai.sendMessage("Research");
    boundInterrupt(session.ai.getInterruptState().interrupts[0]).resolveInterrupt(false);
    await expect.poll(() => session.finished.at(-1)?.status).toBe("completed");
    expect(complete).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(session.ai.getMessages())).not.toContain('"type":"subagent"');
  } finally {
    session.ai.dispose();
  }
});
