import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { DISCOVERY_TOOL_NAME, maxIterations, type UIMessage } from "@tanstack/ai";
import { run } from "./agent";
import { messageMetadata, toolResultMetadata, toolResults } from "./messages";
import { assistantMessage } from "./messages";
import { assistant, calls, output, testClient, toolCall, user } from "./test-support/ai";
import type { Tool } from "../types/chat";

const prompt: UIMessage[] = [user("go")];
const done = assistant("Done");
const call = (id = "call", args = "{}") => calls([id, "write", args]);
const tool = (execute: Tool["execute"] = async () => output("Written")): Tool => ({
  name: "write",
  description: "Test tool",
  inputSchema: z.looseObject({}),
  execute: execute,
});
const results = (messages: UIMessage[]) => messages.flatMap(toolResults);

describe("TanStack agent lifecycle", () => {
  it("discovers deferred tools natively and restores them from saved history", async () => {
    const execute = vi.fn<Tool["execute"]>().mockResolvedValue(output("Written"));
    const deferredTool = { ...tool(execute), lazy: true, description: "Write a file. Extended guidance." };
    const discovery = calls(["discover", DISCOVERY_TOOL_NAME, { toolNames: ["write"] }]);
    const complete = vi.fn().mockResolvedValueOnce(discovery).mockResolvedValueOnce(call()).mockResolvedValueOnce(done);
    const first = await run(testClient(complete), "model", "", prompt, [deferredTool]);
    expect(first.status).toBe("completed");
    expect(execute).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0][0].tools.map((entry: Tool) => entry.name)).toEqual([DISCOVERY_TOOL_NAME]);
    expect(complete.mock.calls[0][0].tools[0].description).toContain("write — Write a file.");
    expect(complete.mock.calls[0][0].tools[0].description).not.toContain("Extended guidance");
    expect(complete.mock.calls[1][0].tools.map((entry: Tool) => entry.name)).toEqual(["write"]);

    // JSON storage drops prototypes and object identities; TanStack must still
    // recognize its own discovery result without a separate cache in Wingman.
    const restored: UIMessage[] = JSON.parse(JSON.stringify([...first.messages, ...prompt]));
    const next = vi.fn().mockResolvedValue(done);
    await run(testClient(next), "model", "", restored, [deferredTool]);
    expect(next.mock.calls[0][0].tools.map((entry: Tool) => entry.name)).toEqual(["write"]);

    // Old discoveries cannot re-enable a tool removed from the current selection.
    const disabled = vi.fn().mockResolvedValue(done);
    await run(testClient(disabled), "model", "", restored, []);
    expect(disabled.mock.calls[0][0].tools).toEqual([]);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("does not execute a deferred tool before discovery and lets the model correct its call", async () => {
    const execute = vi.fn<Tool["execute"]>().mockResolvedValue(output("Written"));
    const complete = vi
      .fn()
      .mockResolvedValueOnce(call("early"))
      .mockResolvedValueOnce(calls(["discover", DISCOVERY_TOOL_NAME, { toolNames: ["write"] }]))
      .mockResolvedValueOnce(call("valid"))
      .mockResolvedValueOnce(done);
    const result = await run(testClient(complete), "model", "", prompt, [{ ...tool(execute), lazy: true }]);
    expect(result.status).toBe("completed");
    expect(execute).toHaveBeenCalledOnce();
    expect(JSON.stringify(complete.mock.calls[1][0].messages)).toContain("must be discovered first");
    expect(complete).toHaveBeenCalledTimes(4);
  });

  it("streams and commits turns, results, metadata and usage with stable identities", async () => {
    const complete = vi.fn().mockResolvedValueOnce(call()).mockResolvedValueOnce(done);
    const resultHook = vi.fn();
    const result = await run(
      testClient(complete),
      "model",
      "Instructions",
      prompt,
      [
        tool(async (_args, execution) => {
          const context = execution?.context;
          context?.setMeta?.({ artifactDelta: { mutations: [{ path: "/a.txt" }] } });
          context?.setContent?.({ saved: true });
          return output("Written");
        }),
      ],
      {
        middleware: [{ onToolPhaseComplete: (_ctx, info) => resultHook(info.results) }],
      },
    );
    expect(result.status).toBe("completed");
    expect(
      new Set(result.messages.filter((message) => message.role === "assistant").map((message) => message.id)).size,
    ).toBe(2);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.messages.map((m) => m.role)).toEqual(["user", "assistant", "assistant"]);
    expect(result.messages[1].parts.map((part) => part.type)).toEqual(["tool-call", "tool-result"]);
    expect(toolResultMetadata(results(result.messages)[0])).toMatchObject({
      result: output("Written"),
      meta: { artifactDelta: { mutations: [{ path: "/a.txt" }] } },
      content: { saved: true },
    });
    expect(messageMetadata(result.messages.at(-1)!).usage).toMatchObject({ inputTokens: 10, outputTokens: 5 });
    expect(messageMetadata(result.messages.at(-1)!).runId).toEqual(expect.any(String));
    expect(resultHook).toHaveBeenCalledOnce();
    expect(resultHook).toHaveBeenCalledWith([expect.objectContaining({ toolCallId: "call" })]);
    expect(complete.mock.calls[1][0].messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "tool", toolCallId: "call", content: "Written" })]),
    );
  });

  it("bounds repeated tool cycles with TanStack's configured iteration limit", async () => {
    const complete = vi.fn(async () => call(crypto.randomUUID()));
    const result = await run(testClient(complete), "model", "", prompt, [tool()]);
    expect(result.status).toBe("completed");
    expect(complete).toHaveBeenCalledTimes(100);
  });

  it("accepts a native loop strategy without creating a synthetic failure", async () => {
    const complete = vi.fn(async () => call(crypto.randomUUID()));
    const result = await run(testClient(complete), "model", "", prompt, [tool()], {
      agentLoopStrategy: maxIterations(2),
    });
    expect(result.status).toBe("completed");
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("persists native partial messages without duplicating completed tool results", async () => {
    const complete = vi
      .fn<Parameters<typeof testClient>[0]>()
      .mockResolvedValueOnce(call())
      .mockImplementationOnce(async (_options, onStream) => {
        onStream("D");
        onStream("Do");
        onStream("Done");
        return done;
      });
    const result = await run(testClient(complete), "model", "", prompt, [tool()]);
    expect(results(result.messages)).toHaveLength(1);
    expect(result.messages.at(-1)?.parts).toEqual([{ type: "text", content: "Done" }]);
  });

  it("never invokes a model after parent cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const complete = vi.fn();
    const result = await run(testClient(complete), "model", "", prompt, [], {
      context: { signal: controller.signal },
      options: { signal: new AbortController().signal },
    });
    expect(result.status).toBe("aborted");
    expect(complete).not.toHaveBeenCalled();
  });

  it("cancels an executing tool without persisting an error result", async () => {
    const controller = new AbortController();
    const complete = vi.fn().mockResolvedValue(call());
    const result = await run(
      testClient(complete),
      "model",
      "",
      prompt,
      [
        tool(async (_args, execution) => {
          const context = execution?.context;
          controller.abort();
          context?.signal?.throwIfAborted();
          return [];
        }),
      ],
      { options: { signal: controller.signal } },
    );
    expect(result.status).toBe("aborted");
    expect(results(result.messages)).toHaveLength(0);
    expect(complete).toHaveBeenCalledOnce();
  });

  it.each(["many", -1])("lets TanStack validate tool inputs, including native refinements: %s", async (count) => {
    const execute = vi.fn();
    const resultHook = vi.fn();
    const complete = vi
      .fn()
      .mockResolvedValueOnce(call("bad", JSON.stringify({ count })))
      .mockResolvedValueOnce(done);
    const result = await run(
      testClient(complete),
      "model",
      "",
      prompt,
      [
        {
          ...tool(execute),
          inputSchema: z.looseObject({
            count: z
              .number()
              .int()
              .refine((value) => value > 0, "Count must be positive"),
          }),
        },
      ],
      { middleware: [{ onToolPhaseComplete: (_ctx, info) => resultHook(info.results) }] },
    );
    expect(result.status).toBe("completed");
    expect(execute).not.toHaveBeenCalled();
    expect(resultHook).toHaveBeenCalledWith([expect.objectContaining({ toolCallId: "bad" })]);
    expect(results(result.messages)).toEqual([expect.objectContaining({ toolCallId: "bad", state: "error" })]);
  });

  it("uses TanStack's cancellation signal for tools and reports middleware aborts as aborted", async () => {
    const parent = new AbortController();
    const complete = vi.fn().mockResolvedValue(call());
    let cancel!: () => void;
    let toolSignal: AbortSignal | undefined;
    let invocationSignal: AbortSignal | undefined;
    let executionSignal: AbortSignal | undefined;
    const onToolMeta = vi.fn();
    const result = await run(
      testClient(complete),
      "model",
      "",
      prompt,
      [
        tool(async (_args, execution) => {
          const context = execution?.context;
          toolSignal = context?.signal;
          invocationSignal = context?.invocationContext?.signal;
          cancel();
          context?.setMeta?.({ progress: "Late progress" });
          return output("Too late");
        }),
      ],
      {
        options: { signal: parent.signal },
        onToolMeta,
        createToolContext: (_call, execution) => {
          executionSignal = execution.abortSignal;
          return {};
        },
        middleware: [
          {
            onBeforeToolCall: (ctx) => {
              cancel = () => ctx.abort("Cancelled by middleware");
            },
          },
        ],
      },
    );
    expect(toolSignal?.aborted).toBe(true);
    expect(toolSignal).toBe(executionSignal);
    expect(invocationSignal).toBe(toolSignal);
    expect(parent.signal.aborted).toBe(false);
    expect(result.status).toBe("aborted");
    expect(results(result.messages)).toHaveLength(0);
    expect(onToolMeta).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledOnce();
  });

  it("prepares delegated requests with the child's cancellation signal", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce(calls(["delegate", "agent", { prompt: "Child task" }]))
      .mockResolvedValue(done);
    const parent = new AbortController();
    let childSignal: AbortSignal | undefined;
    const result = await run(
      testClient(complete),
      "model",
      "",
      prompt,
      [
        {
          name: "agent",
          description: "Test tool",
          inputSchema: z.looseObject({ prompt: z.string() }),
          execute: async () => [],
          subagent: { instructions: "", tools: [], timeoutMs: 10 },
        },
      ],
      {
        options: { signal: parent.signal },
        prepareMessages: async (messages, signal) => {
          if (!childSignal && complete.mock.calls.length === 1) {
            childSignal = signal;
            await new Promise((resolve) => setTimeout(resolve, 25));
            signal.throwIfAborted();
          }
          return messages;
        },
      },
    );
    expect(childSignal?.aborted).toBe(true);
    expect(parent.signal.aborted).toBe(false);
    expect(result.status).toBe("completed");
    // Only the parent generated; the child's timeout interrupted request preparation.
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("does not execute truncated tool arguments", async () => {
    const execute = vi.fn();
    const complete = vi
      .fn()
      .mockResolvedValue(assistantMessage([{ ...toolCall("call", "write"), state: "input-streaming" }]));
    const result = await run(testClient(complete), "model", "", prompt, [tool(execute)]);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("OUTPUT_TRUNCATED");
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps rich error results and reports their failure through the native tool loop", async () => {
    const complete = vi.fn().mockResolvedValueOnce(call()).mockResolvedValueOnce(done);
    const result = await run(testClient(complete), "model", "", prompt, [
      tool(async (_args, execution) => {
        const context = execution?.context;
        context?.setMeta?.({ toolResource: "ui://error", mcpResult: { isError: true } });
        context?.setError?.({ code: "MCP_TOOL_ERROR", message: "Remote operation failed" });
        return output("Failure details");
      }),
    ]);
    expect(result.status).toBe("completed");
    expect(results(result.messages)[0]).toMatchObject({
      state: "error",
      error: "Remote operation failed",
      metadata: {
        result: output("Failure details"),
        meta: { toolResource: "ui://error", mcpResult: { isError: true } },
        error: { code: "MCP_TOOL_ERROR", message: "Remote operation failed" },
      },
    });
    expect(complete.mock.calls[1][0].messages).toContainEqual(
      expect.objectContaining({
        role: "tool",
        error: "Remote operation failed",
        content: JSON.stringify({ error: "Remote operation failed" }),
      }),
    );
  });

  it("keeps committed tool work when a later request fails and does not replay it on resume", async () => {
    const execute = vi.fn(async () => output("Saved"));
    const complete = vi.fn().mockResolvedValueOnce(call()).mockRejectedValueOnce(new Error("Model failed"));
    const result = await run(testClient(complete), "model", "", prompt, [tool(execute)]);
    expect(result.status).toBe("failed");
    expect(results(result.messages)).toMatchObject([{ toolCallId: "call", state: "complete" }]);
    const resumed = await run(testClient(vi.fn().mockResolvedValue(done)), "model", "", result.messages, [
      tool(execute),
    ]);
    expect(resumed.status).toBe("completed");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("gives each delegated run its own native iteration limit", async () => {
    const child = vi.fn().mockResolvedValue(done);
    const parent = vi.fn().mockResolvedValueOnce(call()).mockResolvedValueOnce(done);
    const result = await run(
      testClient(parent),
      "model",
      "",
      prompt,
      [
        tool(async (_args, execution) => {
          const ctx = execution?.context;
          const result = await run(testClient(child), "model", "", prompt, [], {
            context: { ...ctx?.invocationContext, subagentRunId: "child" },
            agentLoopStrategy: maxIterations(1),
          });
          expect(result.status).toBe("completed");
          return output("Done");
        }),
      ],
      { agentLoopStrategy: maxIterations(2) },
    );
    expect(result.status).toBe("completed");
    expect(parent).toHaveBeenCalledTimes(2);
    expect(child).toHaveBeenCalledOnce();
  });
});
