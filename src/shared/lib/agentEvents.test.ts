import { EventType, type AGUIEvent } from "@ag-ui/core";
import { EventSchema } from "@ag-ui/core/schemas";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { RunSidecar, streamRun, type StreamRunHooks } from "./agent";
import type { Client } from "./client";
import type { Tool } from "../types/chat";
import { assistant, calls, testClient, user } from "./test-support/ai";

async function collectEvents(client: Client, tools: Tool[] = [], hooks: Partial<StreamRunHooks> = {}) {
  const events: AGUIEvent[] = [];
  for await (const event of streamRun(client, "model", "", [user("Go")], tools, {
    sidecar: new RunSidecar(),
    threadId: "thread",
    runId: "run",
    ...hooks,
  })) {
    // Validate the actual public stream against the SDK, including events
    // synthesized by Wingman rather than supplied by the model adapter.
    EventSchema.parse(event);
    events.push(event);
  }
  return events;
}

it.each(["Retrieved result", ""])("emits SDK-valid direct subagent replies: %j", async (answer) => {
  const complete = vi
    .fn()
    .mockResolvedValueOnce(calls(["lookup-call", "lookup", { prompt: "Find the answer" }]))
    .mockResolvedValueOnce(assistant("Done"));
  const direct = vi.fn().mockResolvedValue(answer);
  const events = await collectEvents(testClient(complete), [
    {
      name: "lookup",
      description: "Retrieve an answer",
      inputSchema: z.object({ prompt: z.string() }),
      execute: vi.fn(),
      subagent: { instructions: "", tools: [], direct },
    },
  ]);

  expect(direct).toHaveBeenCalledOnce();
  expect(complete).toHaveBeenCalledTimes(2);
  const child = events.find((event) => event.type === EventType.SUBAGENT_STARTED)!;
  const messageId = `${child.subagentRunId}-direct`;
  expect(events.filter((event) => "messageId" in event && event.messageId === messageId)).toMatchObject([
    { type: EventType.TEXT_MESSAGE_START, subagentRunId: child.subagentRunId },
    ...(answer ? [{ type: EventType.TEXT_MESSAGE_CONTENT, delta: answer, subagentRunId: child.subagentRunId }] : []),
    { type: EventType.TEXT_MESSAGE_END, subagentRunId: child.subagentRunId },
  ]);
  expect(events).toContainEqual(
    expect.objectContaining({ type: EventType.SUBAGENT_FINISHED, subagentRunId: child.subagentRunId, result: answer }),
  );
  expect(events[0]).toMatchObject({ type: EventType.RUN_STARTED, threadId: "thread", runId: "run" });
  expect(events.at(-1)).toMatchObject({
    type: EventType.RUN_FINISHED,
    threadId: "thread",
    runId: "run",
    usage: [{ inputTokens: 10, outputTokens: 5, totalTokens: 15 }],
  });
});

it("emits a schema-valid transcript snapshot before completing a recovered run", async () => {
  const client = testClient(vi.fn().mockResolvedValue(assistant("Recovered answer")));
  const textAdapter = client.textAdapter.bind(client);
  vi.spyOn(client, "textAdapter").mockImplementation((...args) =>
    Object.assign(textAdapter(...args), { needsMessageSnapshot: true }),
  );
  const events = await collectEvents(client);
  expect(events.at(-2)).toMatchObject({
    type: EventType.MESSAGES_SNAPSHOT,
    messages: [
      { role: "user", content: "Go" },
      { role: "assistant", content: "Recovered answer" },
    ],
  });
  expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
});

it("emits an SDK error instead of a successful finish when saving the run fails", async () => {
  const onComplete = vi.fn().mockRejectedValueOnce(new Error("Could not save the run")).mockResolvedValue(undefined);
  const events = await collectEvents(testClient(vi.fn().mockResolvedValue(assistant("Done"))), [], { onComplete });
  expect(events.at(-1)).toMatchObject({ type: EventType.RUN_ERROR, message: "Could not save the run" });
  expect(events.some((event) => event.type === EventType.RUN_FINISHED)).toBe(false);
  expect(onComplete).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed" }));
});

it("fails the run before malformed known events reach the consumer", async () => {
  const onComplete = vi.fn();
  const events = await collectEvents(testClient(vi.fn().mockResolvedValue(assistant("Done"))), [], {
    onComplete,
    middleware: [
      {
        onChunk: (_ctx, chunk) => {
          if (chunk.type !== EventType.TEXT_MESSAGE_CONTENT) return chunk;
          const malformed = { ...chunk };
          Reflect.deleteProperty(malformed, "messageId");
          return malformed;
        },
      },
    ],
  });
  expect(events.at(-1)?.type).toBe(EventType.RUN_ERROR);
  expect(events.some((event) => event.type === EventType.TEXT_MESSAGE_CONTENT)).toBe(false);
  expect(events.some((event) => event.type === EventType.RUN_FINISHED)).toBe(false);
  expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
});
