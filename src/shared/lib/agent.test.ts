import { describe, expect, it, vi } from "vitest";
import { DISCOVERY_TOOL_NAME, maxIterations } from "@tanstack/ai";
import { run } from "./agent";
import { testClient } from "./test-support/ai";
import type { Message, Tool } from "../types/chat";

const prompt: Message[] = [{ role: "user", content: [{ type: "text", text: "go" }] }];
const done: Message = { role: "assistant", content: [{ type: "text", text: "Done" }] };
const call = (id = "call", args = "{}"): Message => ({
  role: "assistant",
  content: [{ type: "tool_call", name: "write", id, arguments: args }],
});
const tool = (execute: Tool["function"] = async () => [{ type: "text", text: "Written" }]): Tool => ({
  name: "write",
  parameters: { type: "object", properties: {} },
  function: execute,
});

describe("TanStack agent lifecycle", () => {
  it("discovers deferred tools natively and restores them from saved history", async () => {
    const execute = vi.fn<Tool["function"]>().mockResolvedValue([{ type: "text", text: "Written" }]);
    const deferredTool = { ...tool(execute), lazy: true, description: "Write a file. Extended guidance." };
    const discovery: Message = {
      role: "assistant",
      content: [{ type: "tool_call", name: DISCOVERY_TOOL_NAME, id: "discover", arguments: '{"toolNames":["write"]}' }],
    };
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
    const restored: Message[] = JSON.parse(JSON.stringify([...first.messages, ...prompt]));
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
    const execute = vi.fn<Tool["function"]>().mockResolvedValue([{ type: "text", text: "Written" }]);
    const complete = vi
      .fn()
      .mockResolvedValueOnce(call("early"))
      .mockResolvedValueOnce({
        role: "assistant",
        content: [
          {
            type: "tool_call",
            name: DISCOVERY_TOOL_NAME,
            id: "discover",
            arguments: '{"toolNames":["write"]}',
          },
        ],
      })
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
        tool(async (_args, context) => {
          context?.setMeta?.({ artifactDelta: { mutations: [{ path: "/a.txt" }] } });
          context?.setContent?.({ saved: true });
          return [{ type: "text", text: "Written" }];
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
    expect(result.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(result.messages[2].content[0]).toMatchObject({
      type: "tool_result",
      id: "call",
      meta: { artifactDelta: { mutations: [{ path: "/a.txt" }] } },
      content: { saved: true },
    });
    expect(result.messages.at(-1)?.usage).toMatchObject({ inputTokens: 10, outputTokens: 5 });
    expect(resultHook).toHaveBeenCalledOnce();
    expect(resultHook).toHaveBeenCalledWith([expect.objectContaining({ toolCallId: "call" })]);
    expect(complete.mock.calls[1][0].messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "tool", toolCallId: "call" })]),
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
        onStream([{ type: "text", text: "D" }]);
        onStream([{ type: "text", text: "Do" }]);
        onStream(done.content);
        return done;
      });
    const result = await run(testClient(complete), "model", "", prompt, [tool()]);
    expect(
      result.messages.flatMap((message) => message.content).filter((part) => part.type === "tool_result"),
    ).toHaveLength(1);
    expect(result.messages.at(-1)?.content).toEqual(done.content);
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
        tool(async (_args, context) => {
          controller.abort();
          context?.signal?.throwIfAborted();
          return [];
        }),
      ],
      { options: { signal: controller.signal } },
    );
    expect(result.status).toBe("aborted");
    expect(result.messages.flatMap((m) => m.content).some((p) => p.type === "tool_result")).toBe(false);
    expect(complete).toHaveBeenCalledOnce();
  });

  it("lets TanStack validate tool inputs without executing invalid arguments", async () => {
    const execute = vi.fn();
    const resultHook = vi.fn();
    const complete = vi.fn().mockResolvedValueOnce(call("bad", '{"count":"many"}')).mockResolvedValueOnce(done);
    const result = await run(
      testClient(complete),
      "model",
      "",
      prompt,
      [
        {
          ...tool(execute),
          parameters: { type: "object", properties: { count: { type: "integer" } }, required: ["count"] },
        },
      ],
      { middleware: [{ onToolPhaseComplete: (_ctx, info) => resultHook(info.results) }] },
    );
    expect(result.status).toBe("completed");
    expect(execute).not.toHaveBeenCalled();
    expect(resultHook).toHaveBeenCalledWith([expect.objectContaining({ toolCallId: "bad" })]);
    expect(result.messages.flatMap((m) => m.content)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "tool_result", id: "bad" })]),
    );
  });

  it("does not execute truncated tool arguments", async () => {
    const execute = vi.fn();
    const complete = vi
      .fn()
      .mockResolvedValue({ role: "assistant", content: [{ ...call().content[0], incomplete: true }] });
    const result = await run(testClient(complete), "model", "", prompt, [tool(execute)]);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("OUTPUT_TRUNCATED");
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps rich error results and reports their failure through the native tool loop", async () => {
    const complete = vi.fn().mockResolvedValueOnce(call()).mockResolvedValueOnce(done);
    const result = await run(testClient(complete), "model", "", prompt, [
      tool(async (_args, context) => {
        context?.setMeta?.({ toolResource: "ui://error", mcpResult: { isError: true } });
        context?.setError?.({ code: "MCP_TOOL_ERROR", message: "Remote operation failed" });
        return [{ type: "text", text: "Failure details" }];
      }),
    ]);
    expect(result.status).toBe("completed");
    expect(result.messages[2]).toMatchObject({
      error: { code: "MCP_TOOL_ERROR", message: "Remote operation failed" },
      content: [
        {
          type: "tool_result",
          result: [{ type: "text", text: "Failure details" }],
          meta: { toolResource: "ui://error", mcpResult: { isError: true } },
        },
      ],
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
    const execute = vi.fn(async () => [{ type: "text" as const, text: "Saved" }]);
    const complete = vi.fn().mockResolvedValueOnce(call()).mockRejectedValueOnce(new Error("Model failed"));
    const result = await run(testClient(complete), "model", "", prompt, [tool(execute)]);
    expect(result.status).toBe("failed");
    expect(result.messages.at(-1)?.content[0]).toMatchObject({ type: "tool_result", id: "call" });
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
        tool(async (_args, ctx) => {
          const result = await run(testClient(child), "model", "", prompt, [], {
            context: { ...ctx?.invocationContext, subagentRunId: "child" },
            agentLoopStrategy: maxIterations(1),
          });
          expect(result.status).toBe("completed");
          return [{ type: "text", text: "Done" }];
        }),
      ],
      { agentLoopStrategy: maxIterations(2) },
    );
    expect(result.status).toBe("completed");
    expect(parent).toHaveBeenCalledTimes(2);
    expect(child).toHaveBeenCalledOnce();
  });
});
