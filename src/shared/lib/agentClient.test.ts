import { z } from "zod";
import { expect, it, vi } from "vitest";
import { assistant, calls, output, testClient } from "./test-support/ai";
import { chatSession, boundInterrupt } from "./test-support/chatSession";
import { ASK_QUESTIONS_TOOL } from "@/features/chat/lib/questionsTool";
import type { Tool } from "../types/chat";
import { migrateLegacyChat, type LegacyStoredChat } from "./chatMigration";

const question = { questions: [{ id: "choice", label: "Which one?", type: "text", required: true }] };
const response = { action: "accept", content: { choice: "A" } };

const session = (
  complete: Parameters<typeof testClient>[0],
  tools: Tool[],
  store?: Parameters<typeof chatSession>[2],
) => chatSession(testClient(complete), tools, store);

it("resumes questions migrated from the legacy transcript", async () => {
  const complete = vi
    .fn()
    .mockResolvedValueOnce(calls(["question-1", "ask_questions", question]))
    .mockResolvedValueOnce(assistant("Done"));
  const original = session(complete, [ASK_QUESTIONS_TOOL]);
  await original.ai.sendMessage("Do it");
  const resume = original.store.value!.resume!;
  original.ai.dispose();
  const legacy: LegacyStoredChat = {
    id: "test-chat",
    created: null,
    updated: null,
    model: null,
    messages: [
      { role: "user", content: [{ type: "text", text: "Do it" }] },
      {
        role: "assistant",
        content: [{ type: "tool_call", id: "question-1", name: "ask_questions", arguments: JSON.stringify(question) }],
      },
    ],
    pendingRun: {
      id: resume.resumeState.runId,
      signature: `@tanstack:${JSON.stringify({ threadId: resume.resumeState.threadId })}`,
      interrupts: resume.pendingInterrupts!.map(({ responseSchema, subagentRunId, metadata, ...interrupt }) => ({
        ...interrupt,
        schema: responseSchema,
        subagentId: subagentRunId,
        signature: `@tanstack:${JSON.stringify(metadata)}`,
      })),
    },
  };
  const restored = session(complete, [ASK_QUESTIONS_TOOL], { value: migrateLegacyChat(legacy) });
  try {
    const interrupt = restored.ai.getInterruptState().interrupts[0];
    boundInterrupt(interrupt).resolveInterrupt(response);
    await expect.poll(() => restored.finished.at(-1)?.status).toBe("completed");
    expect(JSON.stringify(complete.mock.calls[1][0].messages)).toContain('\\"choice\\":\\"A\\"');
  } finally {
    restored.ai.dispose();
  }
});

it("does not replay an abandoned tool on a new send or let its late result replace the new answer", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const execute = vi.fn<Tool["execute"]>().mockImplementation(async () => {
    await pending;
    return output("Late result");
  });
  const complete = vi
    .fn()
    .mockResolvedValueOnce(calls(["abandoned", "write"]))
    .mockResolvedValueOnce(assistant("New answer"));
  const { ai } = session(complete, [
    { name: "write", description: "Test tool", inputSchema: z.looseObject({}), execute: execute },
  ]);
  const first = ai.sendMessage("Start");
  await expect.poll(() => execute.mock.calls.length).toBe(1);
  ai.stop();
  await ai.sendMessage("Do something else");
  release();
  await first;
  expect(execute).toHaveBeenCalledOnce();
  expect(complete).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(complete.mock.calls[1][0].messages)).not.toContain("abandoned");
  expect(JSON.stringify(ai.getMessages())).toContain("New answer");
  expect(JSON.stringify(ai.getMessages())).not.toContain("Late result");
  ai.dispose();
});

it("persists paused questions and resumes without repeating completed sibling tools", async () => {
  const write = vi.fn<Tool["execute"]>().mockResolvedValue(output("Written once"));
  const tools = [
    ASK_QUESTIONS_TOOL,
    { name: "write", description: "Test tool", inputSchema: z.looseObject({}), execute: write },
  ];
  const complete = vi
    .fn()
    .mockResolvedValueOnce(calls(["write-1", "write"], ["question-1", "ask_questions", question]))
    .mockResolvedValueOnce(assistant("Done"));
  const original = session(complete, tools);
  await original.ai.sendMessage("Do it");
  expect(original.finished.at(-1)?.status).toBe("interrupted");
  expect(original.ai.getInterruptState().interrupts).toHaveLength(1);
  await expect.poll(() => original.store.value?.resume?.pendingInterrupts?.length).toBe(1);
  original.ai.dispose();
  const restored = session(complete, tools, original.store);
  await expect.poll(() => restored.ai.getInterruptState().interrupts.length).toBe(1);
  boundInterrupt(restored.ai.getInterruptState().interrupts[0]).resolveInterrupt(response);
  await expect.poll(() => restored.finished.at(-1)?.status).toBe("completed");
  expect(write).toHaveBeenCalledOnce();
  expect(complete).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(complete.mock.calls[1][0].messages)).toContain("Written once");
  expect(JSON.stringify(complete.mock.calls[1][0].messages)).toContain('\\"choice\\":\\"A\\"');
  expect(restored.ai.getInterruptState().interrupts).toHaveLength(0);
  restored.ai.dispose();
});

it("waits for all questions in a native interrupt batch before resuming", async () => {
  const complete = vi
    .fn()
    .mockResolvedValueOnce(calls(["q1", "ask_questions", question], ["q2", "ask_questions", question]))
    .mockResolvedValueOnce(assistant("Done"));
  const { ai } = session(complete, [ASK_QUESTIONS_TOOL]);
  await ai.sendMessage("Two questions");
  expect(ai.getInterruptState().interrupts).toHaveLength(2);
  boundInterrupt(ai.getInterruptState().interrupts[0]).resolveInterrupt(response);
  expect(complete).toHaveBeenCalledOnce();
  boundInterrupt(ai.getInterruptState().interrupts[1]).cancel();
  await expect.poll(() => complete.mock.calls.length).toBe(2);
  expect(JSON.stringify(complete.mock.calls[1][0].messages)).toContain('\\"action\\":\\"cancel\\"');
  ai.dispose();
});

it.each([true, false])("restores native tool approval and executes only when approved: %s", async (approved) => {
  const execute = vi.fn<Tool["execute"]>().mockResolvedValue(output("Written"));
  const tools = [
    { name: "write", description: "Test tool", needsApproval: true, inputSchema: z.looseObject({}), execute: execute },
  ];
  const complete = vi
    .fn()
    .mockResolvedValueOnce(calls(["approved-write", "write"]))
    .mockResolvedValueOnce(assistant("Done"));
  const original = session(complete, tools);
  await original.ai.sendMessage("Write");
  expect(execute).not.toHaveBeenCalled();
  await expect.poll(() => original.store.value?.resume?.pendingInterrupts?.length).toBe(1);
  original.ai.dispose();
  const restored = session(complete, tools, original.store);
  await expect.poll(() => restored.ai.getInterruptState().interrupts.length).toBe(1);
  const approval = restored.ai.getInterruptState().interrupts[0];
  expect(approval.kind).toBe("tool-approval");
  expect(approval.canResolve).toBe(true);
  boundInterrupt(approval).resolveInterrupt(approved);
  await expect.poll(() => restored.finished.at(-1)?.status).toBe("completed");
  expect(execute).toHaveBeenCalledTimes(approved ? 1 : 0);
  restored.ai.dispose();
});

it.each([true, false])("resumes a child with its completed work intact (inheritHistory=%s)", async (inheritHistory) => {
  const write = vi.fn<Tool["execute"]>().mockImplementation(async (_args, execution) => {
    const ctx = execution?.context;
    ctx?.setMeta?.({ artifactDelta: { mutations: [{ operation: "create", path: "/child.txt" }] } });
    return output("Child wrote once");
  });
  const childTools = [
    ASK_QUESTIONS_TOOL,
    { name: "write", description: "Test tool", inputSchema: z.looseObject({}), execute: write },
  ];
  const agent: Tool = {
    name: "agent",
    description: "Delegate work",
    inputSchema: z.looseObject({ prompt: z.string() }),
    subagent: {
      model: "child-model",
      inheritHistory,
      tools: childTools,
      instructions: "Child instructions",
      runtimeContext: "Workspace: /",
      middleware: [],
    },
    execute: async () => {
      throw new Error("Chat must use defineAgent");
    },
  };
  const complete = vi
    .fn()
    .mockResolvedValueOnce(calls(["delegate", "agent", { prompt: "Build a report" }]))
    .mockResolvedValueOnce(calls(["child-write", "write"], ["child-question", "ask_questions", question]))
    .mockResolvedValueOnce(assistant("Child finished"))
    .mockResolvedValueOnce(assistant("Parent finished"));
  const original = session(complete, [agent]);
  await original.ai.sendMessage("Please delegate this task");
  expect(original.finished.at(-1)?.status).toBe("interrupted");
  expect(original.ai.getInterruptState().interrupts).toHaveLength(1);
  await expect.poll(() => original.store.value?.resume?.pendingInterrupts?.length).toBe(1);
  original.ai.dispose();
  const restored = session(complete, [agent], original.store);
  await expect.poll(() => restored.ai.getInterruptState().interrupts.length).toBe(1);
  boundInterrupt(restored.ai.getInterruptState().interrupts[0]).resolveInterrupt(response);
  await expect.poll(() => restored.finished.at(-1)?.status).toBe("completed");
  expect(write).toHaveBeenCalledOnce();
  expect(write.mock.calls[0][1]?.context?.model).toBe("child-model");
  expect(JSON.stringify(complete.mock.calls[1][0].messages).includes("Please delegate this task")).toBe(inheritHistory);
  expect(JSON.stringify(complete.mock.calls[2][0].messages).includes("Please delegate this task")).toBe(inheritHistory);
  expect(complete).toHaveBeenCalledTimes(4);
  expect(JSON.stringify(complete.mock.calls[2][0].messages)).toContain("Child wrote once");
  expect(JSON.stringify(complete.mock.calls[2][0].messages)).toContain("Build a report");
  const children = restored.ai
    .getMessages()
    .flatMap((message) => message.parts)
    .filter((part) => part.type === "subagent");
  expect(children).toHaveLength(1);
  expect(children[0].subagent.status).toBe("finished");
  expect(JSON.stringify(children[0].subagent.messages)).toContain("Child finished");
  expect(restored.sidecar.toolMeta("delegate")).toMatchObject({
    artifactDelta: { mutations: [{ operation: "create", path: "/child.txt" }] },
  });
  restored.ai.dispose();
});
