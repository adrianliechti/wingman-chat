// @vitest-environment happy-dom
import { EventType, type AGUIEvent } from "@ag-ui/core";
import { StreamProcessor, type UIMessage } from "@tanstack/ai";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { RunSidecar, type AgentRunResult } from "@/shared/lib/agent";
import { assistantMessage, userMessage } from "@/shared/lib/messages";
import { calls, output, testClient } from "@/shared/lib/test-support/ai";
import { InlineUiRuntime } from "@/shared/lib/inlineUi/runtime";
import { extractUiFences } from "@/shared/lib/inlineUi/protocol";
import fixtures from "@/shared/lib/inlineUi/fixtures/components.json";
import type { Tool } from "@/shared/types/chat";
import { streamChatWithUiRepair } from "./inlineUiRepair";

const prompt = userMessage("Show the pairing result");
const valid = structuredClone(fixtures.Callout);
valid.createSurface.components[0].text = "Pairing succeeded";
const invalid = structuredClone(valid);
Object.assign(invalid.createSurface.components[0], { tone: { "@path": "/tone" } });
const ui = (message: unknown) => assistantMessage("```ui\n" + JSON.stringify(message) + "\n```");

async function execute(
  complete: Parameters<typeof testClient>[0],
  messages: UIMessage[] = [prompt],
  tools: Tool[] = [],
  signal?: AbortSignal,
) {
  const onComplete = vi.fn();
  const chunks: AGUIEvent[] = [];
  const processor = new StreamProcessor({ initialMessages: messages });
  const stream = streamChatWithUiRepair(testClient(complete), "model", "", messages, tools, {
    threadId: "ui-chat",
    runId: "ui-test",
    sidecar: new RunSidecar(),
    options: { signal },
    onComplete,
  });
  await processor.process(
    (async function* () {
      for await (const chunk of stream) {
        chunks.push(chunk);
        yield chunk;
      }
    })(),
  );
  return {
    chunks,
    messages: processor.getMessages(),
    result: onComplete.mock.calls[0]?.[0] as AgentRunResult,
    onComplete,
  };
}

it("automatically repairs a Callout tone error and replaces the failed reply in the saved transcript", async () => {
  const complete = vi.fn().mockResolvedValueOnce(ui(invalid)).mockResolvedValue(ui(valid));
  const { chunks, messages, result, onComplete } = await execute(complete);
  expect(complete).toHaveBeenCalledTimes(2);
  const repairRequest = JSON.stringify(complete.mock.calls[1][0].messages);
  expect(repairRequest).toContain("tone: Expected");
  expect(repairRequest).toContain("Regenerate the complete reply");
  expect(messages.filter((message) => message.role === "user")).toMatchObject([prompt]);
  expect(messages.filter((message) => message.role === "assistant")).toHaveLength(1);
  expect(JSON.stringify(messages)).not.toContain("Regenerate the complete reply");
  expect(JSON.stringify(messages)).not.toContain('\\"@path\\"');
  expect(result.status).toBe("completed");
  expect(onComplete).toHaveBeenCalledOnce();
  expect(chunks.filter((chunk) => chunk.type === EventType.RUN_STARTED)).toHaveLength(1);
  expect(chunks.filter((chunk) => chunk.type === EventType.RUN_FINISHED)).toHaveLength(1);
  const runtime = new InlineUiRuntime();
  try {
    const source = messages.at(-1)!.parts.find((part) => part.type === "text")!.content;
    runtime.sync([{ key: "fixed", source: extractUiFences(source)[0] }]);
    expect([...runtime.errors]).toEqual([]);
  } finally {
    runtime.dispose();
  }
});

it("stops after two repair attempts when the model keeps returning invalid UI", async () => {
  const complete = vi.fn().mockResolvedValue(ui(invalid));
  const { messages, onComplete } = await execute(complete);
  expect(complete).toHaveBeenCalledTimes(3);
  expect(messages.filter((message) => message.role === "assistant")).toHaveLength(1);
  expect(onComplete).toHaveBeenCalledOnce();
});

it("does not retry valid output or an unrelated reply after an older invalid UI", async () => {
  const complete = vi.fn().mockResolvedValue(ui(valid));
  await execute(complete);
  expect(complete).toHaveBeenCalledOnce();
  const followup = vi.fn().mockResolvedValue(assistantMessage("Hello"));
  await execute(followup, [prompt, ui(invalid), userMessage("Say hello")]);
  expect(followup).toHaveBeenCalledOnce();
});

it("retains completed tool work without repeating tools during repair", async () => {
  const executeTool = vi.fn().mockResolvedValue(output("Saved"));
  const tool: Tool = { name: "write", description: "Write", inputSchema: z.strictObject({}), execute: executeTool };
  const complete = vi
    .fn()
    .mockResolvedValueOnce(calls(["write-id", "write", {}]))
    .mockResolvedValueOnce(ui(invalid))
    .mockResolvedValue(ui(valid));
  const { messages } = await execute(complete, [prompt], [tool]);
  expect(executeTool).toHaveBeenCalledOnce();
  expect(complete.mock.calls[2][0].tools).toEqual([]);
  expect(messages.flatMap((message) => message.parts).filter((part) => part.type === "tool-result")).toHaveLength(1);
});

it("validates updates against earlier surfaces and replaces only the failed update", async () => {
  const update = {
    version: "v1.0",
    updateComponents: {
      surfaceId: valid.createSurface.surfaceId,
      components: invalid.createSurface.components,
    },
  };
  const fixed = structuredClone(update);
  fixed.updateComponents.components = valid.createSurface.components;
  const earlier = ui(valid);
  const complete = vi.fn().mockResolvedValueOnce(ui(update)).mockResolvedValue(ui(fixed));
  const { messages, result } = await execute(complete, [prompt, earlier, userMessage("Update the result")]);
  expect(complete).toHaveBeenCalledTimes(2);
  expect(messages.filter((message) => message.role === "assistant")).toHaveLength(2);
  expect(messages.find((message) => message.id === earlier.id)).toMatchObject(earlier);
  expect(result.status).toBe("completed");
});

it("does not repair an invalid interface while a tool is waiting for approval", async () => {
  const executeTool = vi.fn().mockResolvedValue(output("Saved"));
  const tool: Tool = {
    name: "write",
    description: "Write",
    inputSchema: z.strictObject({}),
    needsApproval: true,
    execute: executeTool,
  };
  const complete = vi
    .fn()
    .mockResolvedValue(assistantMessage([...ui(invalid).parts, ...calls(["write-id", "write", {}]).parts]));
  const { result, onComplete } = await execute(complete, [prompt], [tool]);
  expect(result.status).toBe("interrupted");
  expect(complete).toHaveBeenCalledOnce();
  expect(executeTool).not.toHaveBeenCalled();
  expect(onComplete).toHaveBeenCalledOnce();
});

it("does not begin a repair after the run is cancelled", async () => {
  const controller = new AbortController();
  const complete = vi.fn().mockImplementation(async () => {
    controller.abort();
    return ui(invalid);
  });
  const { result } = await execute(complete, [prompt], [], controller.signal);
  expect(complete).toHaveBeenCalledOnce();
  expect(result.status).toBe("aborted");
});
