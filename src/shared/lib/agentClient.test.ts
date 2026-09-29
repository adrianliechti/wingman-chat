import { expect, it, vi } from "vitest";
import { testClient } from "./test-support/ai";
import { chatSession, boundInterrupt } from "./test-support/chatSession";
import { ASK_QUESTIONS_TOOL } from "@/features/chat/lib/questionsTool";
import type { Message, Tool } from "../types/chat";

const answer = (text: string): Message => ({ role: "assistant", content: [{ type: "text", text }] });
const calls = (...tools: Array<[string, string, object?]>): Message => ({
  role: "assistant",
  content: tools.map(([id, name, args = {}]) => ({ type: "tool_call", id, name, arguments: JSON.stringify(args) })),
});
const question = { questions: [{ id: "choice", label: "Which one?", type: "text", required: true }] };
const response = { action: "accept", content: { choice: "A" } };

const session = (
  complete: Parameters<typeof testClient>[0],
  tools: Tool[],
  store?: Parameters<typeof chatSession>[2],
) => chatSession(testClient(complete), tools, store);

it("does not replay an abandoned tool on a new send or let its late result replace the new answer", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const execute = vi.fn<Tool["function"]>().mockImplementation(async () => {
    await pending;
    return [{ type: "text", text: "Late result" }];
  });
  const complete = vi
    .fn()
    .mockResolvedValueOnce(calls(["abandoned", "write"]))
    .mockResolvedValueOnce(answer("New answer"));
  const { ai } = session(complete, [
    { name: "write", parameters: { type: "object", properties: {} }, function: execute },
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
  const write = vi.fn<Tool["function"]>().mockResolvedValue([{ type: "text", text: "Written once" }]);
  const tools = [
    ASK_QUESTIONS_TOOL,
    { name: "write", parameters: { type: "object", properties: {} }, function: write },
  ];
  const complete = vi
    .fn()
    .mockResolvedValueOnce(calls(["write-1", "write"], ["question-1", "ask_questions", question]))
    .mockResolvedValueOnce(answer("Done"));
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
    .mockResolvedValueOnce(answer("Done"));
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
  const execute = vi.fn<Tool["function"]>().mockResolvedValue([{ type: "text", text: "Written" }]);
  const tools = [
    { name: "write", needsApproval: true, parameters: { type: "object", properties: {} }, function: execute },
  ];
  const complete = vi
    .fn()
    .mockResolvedValueOnce(calls(["approved-write", "write"]))
    .mockResolvedValueOnce(answer("Done"));
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
  const write = vi.fn<Tool["function"]>().mockImplementation(async (_args, ctx) => {
    ctx?.setMeta?.({ artifactDelta: { mutations: [{ operation: "create", path: "/child.txt" }] } });
    return [{ type: "text", text: "Child wrote once" }];
  });
  const childTools = [
    ASK_QUESTIONS_TOOL,
    { name: "write", parameters: { type: "object", properties: {} }, function: write },
  ];
  const agent: Tool = {
    name: "agent",
    description: "Delegate work",
    parameters: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] },
    subagent: {
      model: "child-model",
      inheritHistory,
      tools: childTools,
      instructions: "Child instructions",
      runtimeContext: "Workspace: /",
      middleware: [],
    },
    function: async () => {
      throw new Error("Chat must use defineAgent");
    },
  };
  const complete = vi
    .fn()
    .mockResolvedValueOnce(calls(["delegate", "agent", { prompt: "Build a report" }]))
    .mockResolvedValueOnce(calls(["child-write", "write"], ["child-question", "ask_questions", question]))
    .mockResolvedValueOnce(answer("Child finished"))
    .mockResolvedValueOnce(answer("Parent finished"));
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
  expect(write.mock.calls[0][1]?.model).toBe("child-model");
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
  expect(restored.metadata.toolMeta("delegate")).toMatchObject({
    artifactDelta: { mutations: [{ operation: "create", path: "/child.txt" }] },
  });
  restored.ai.dispose();
});
