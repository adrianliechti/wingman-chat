import { describe, expect, it, vi } from "vitest";
import type { Client } from "./client";
import { run } from "./agent";
import { AgentInvocationContext } from "./agent-run-controller";
import { APIError, BadRequestError } from "openai/error";
import type { Message, Tool } from "../types/chat";

const prompt: Message[] = [{ role: "user", content: [{ type: "text", text: "go" }] }];

function fakeClient(complete: Client["complete"]): Client {
  return { complete } as Client;
}

describe("agent run controller", () => {
  it("returns max_turns with ordered events and invocation-wide model usage", async () => {
    const complete = vi.fn(async () => ({
      role: "assistant" as const,
      content: [{ type: "tool_call" as const, id: crypto.randomUUID(), name: "noop", arguments: "{}" }],
    }));
    const tool: Tool = {
      name: "noop",
      parameters: { type: "object", properties: {} },
      function: async () => [{ type: "text", text: "ok" }],
    };
    const events: Array<{ sequence: number }> = [];
    const result = await run(fakeClient(complete as Client["complete"]), "model", "instructions", prompt, [tool], {
      maxTurns: 2,
      onEvent: (event) => events.push(event),
    });

    expect(result.status).toBe("max_turns");
    expect(result.modelCalls).toEqual({ used: 2, limit: 2 });
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index));
  });

  it("does not call the model when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const complete = vi.fn();
    const result = await run(fakeClient(complete as Client["complete"]), "model", "instructions", prompt, [], {
      options: { signal: controller.signal },
    });
    expect(result.status).toBe("aborted");
    expect(complete).not.toHaveBeenCalled();
  });

  it("uses invocation cancellation even when request options provide another signal", async () => {
    const parent = new AbortController();
    parent.abort();
    const complete = vi.fn();
    const result = await run(fakeClient(complete as Client["complete"]), "model", "instructions", prompt, [], {
      invocationContext: new AgentInvocationContext({ signal: parent.signal }),
      options: { signal: new AbortController().signal },
    });
    expect(result.status).toBe("aborted");
    expect(complete).not.toHaveBeenCalled();
  });

  it("treats a tool AbortError as terminal cancellation without persisting an error result", async () => {
    const controller = new AbortController();
    const complete = vi.fn(async () => ({
      role: "assistant" as const,
      content: [{ type: "tool_call" as const, id: "cancel-call", name: "cancel", arguments: "{}" }],
    }));
    const tool: Tool = {
      name: "cancel",
      parameters: { type: "object", properties: {} },
      function: async (_args, context) => {
        controller.abort();
        context?.signal?.throwIfAborted();
        return [{ type: "text", text: "unreachable" }];
      },
    };

    const result = await run(fakeClient(complete as Client["complete"]), "model", "instructions", prompt, [tool], {
      options: { signal: controller.signal },
    });

    expect(result.status).toBe("aborted");
    expect(result.messages.some((message) => message.content.some((part) => part.type === "tool_result"))).toBe(false);
  });

  it("emits one streaming phase event and appends stop-policy content immutably", async () => {
    const events: string[] = [];
    const complete = vi.fn(async (...args: Parameters<Client["complete"]>) => {
      const stream = args[4];
      stream?.([{ type: "text", text: "a" }]);
      stream?.([{ type: "text", text: "ab" }]);
      return { role: "assistant" as const, content: [{ type: "text" as const, text: "done" }] };
    });
    const result = await run(fakeClient(complete), "model", "instructions", prompt, [], {
      onEvent: (event) => events.push(event.type),
      beforeFinish: async () => ({
        action: "finish",
        appendContent: [{ type: "artifact_ref", path: "/result.md" }],
      }),
    });

    expect(events.filter((type) => type === "model.streaming")).toHaveLength(1);
    expect(result.messages.at(-1)?.content.at(-1)).toEqual({ type: "artifact_ref", path: "/result.md" });
    expect(prompt).toEqual([{ role: "user", content: [{ type: "text", text: "go" }] }]);
  });

  it("continues from runtime policy feedback without exposing a second invocation", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ role: "assistant", content: [{ type: "text", text: "draft" }] })
      .mockResolvedValueOnce({ role: "assistant", content: [{ type: "text", text: "fixed" }] });
    let checks = 0;
    const result = await run(fakeClient(complete as Client["complete"]), "model", "instructions", prompt, [], {
      beforeFinish: async () =>
        checks++ === 0
          ? {
              action: "continue",
              feedback: {
                role: "user",
                content: [{ type: "runtime_feedback", source: "verification", text: "Fix the file." }],
              },
            }
          : { action: "finish" },
    });
    expect(result.status).toBe("completed");
    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.messages.some((message) => message.content.some((part) => part.type === "runtime_feedback"))).toBe(
      true,
    );
  });

  it("rejects duplicate tool names before exposing an ambiguous registry to the model", async () => {
    const complete = vi.fn();
    const first: Tool = {
      name: "duplicate",
      parameters: { type: "object" },
      function: vi.fn(),
    };
    const second: Tool = { ...first, function: vi.fn() };

    const result = await run(fakeClient(complete as Client["complete"]), "model", "instructions", prompt, [
      first,
      second,
    ]);

    expect(result.status).toBe("failed");
    expect(result.error?.message).toContain("Duplicate tool name: duplicate");
    expect(complete).not.toHaveBeenCalled();
  });

  it("returns schema-invalid arguments to the model without invoking the tool", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        role: "assistant",
        content: [{ type: "tool_call", id: "bad-args", name: "typed", arguments: '{"count":"many"}' }],
      })
      .mockResolvedValueOnce({ role: "assistant", content: [{ type: "text", text: "corrected" }] });
    const execute = vi.fn();
    const tool: Tool = {
      name: "typed",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["count"],
        properties: { count: { type: "integer" } },
      },
      function: execute,
    };

    const result = await run(fakeClient(complete as Client["complete"]), "model", "instructions", prompt, [tool]);

    expect(result.status).toBe("completed");
    expect(execute).not.toHaveBeenCalled();
    const toolResult = result.messages
      .flatMap((message) => message.content)
      .find((part) => part.type === "tool_result" && part.id === "bad-args");
    expect(toolResult).toMatchObject({ name: "typed" });
    expect(toolResult && "result" in toolResult ? toolResult.result : []).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("must be integer") })]),
    );
  });
});

describe("agent recovery", () => {
  const overflow = () =>
    new BadRequestError(400, { code: "context_length_exceeded" }, "Too much context", new Headers());
  const done: Message = { role: "assistant", content: [{ type: "text", text: "Done" }] };

  it("retries with compacted history and publishes the same history to observers", async () => {
    const compacted: Message[] = [
      { role: "assistant", content: [{ type: "summary", text: "Previous work" }] },
      ...prompt,
    ];
    const complete = vi.fn().mockRejectedValueOnce(overflow()).mockResolvedValueOnce(done);
    const changes: Message[][] = [];
    const result = await run(fakeClient(complete), "model", "", prompt, [], {
      onContextOverflow: async () => compacted,
      onMessagesChange: (messages) => changes.push(messages),
    });
    expect(result.status).toBe("completed");
    expect(complete.mock.calls[1][2]).toBe(compacted);
    expect(changes[0]).toBe(compacted);
    expect(changes.at(-1)).toBe(result.messages);
    expect(result.modelCalls.used).toBe(2);
  });

  it("bounds repeated overflows and reports the original error if compaction cannot help", async () => {
    const error = overflow();
    const complete = vi.fn().mockRejectedValue(error);
    const compact = vi.fn(async (messages: Message[]) => [...messages]);
    const result = await run(fakeClient(complete), "model", "", prompt, [], { onContextOverflow: compact });
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("CONTEXT_EXHAUSTED");
    expect(complete).toHaveBeenCalledTimes(3);
    expect(compact).toHaveBeenCalledTimes(2);

    complete.mockClear();
    const unchanged = await run(fakeClient(complete), "model", "", prompt, [], {
      onContextOverflow: (messages) => messages,
    });
    expect(unchanged.status).toBe("failed");
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("treats a summarizer AbortError as cancellation even without an aborted signal", async () => {
    const complete = vi.fn().mockRejectedValue(overflow());
    const result = await run(fakeClient(complete), "model", "", prompt, [], {
      onContextOverflow: async () => {
        throw new DOMException("Cancelled", "AbortError");
      },
    });
    expect(result.status).toBe("aborted");
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("does not spend another model call after aborting during compaction", async () => {
    const controller = new AbortController();
    const complete = vi.fn().mockRejectedValue(overflow());
    const result = await run(fakeClient(complete), "model", "", prompt, [], {
      options: { signal: controller.signal },
      onContextOverflow: async (messages) => {
        controller.abort();
        return [...messages];
      },
    });
    expect(result.status).toBe("aborted");
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.modelCalls.used).toBe(1);
  });

  it("keeps completed tools after a later model failure so recovery need not rerun them", async () => {
    const execute = vi.fn(async () => [{ type: "text" as const, text: "Written" }]);
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        role: "assistant",
        content: [{ type: "tool_call", id: "once", name: "write", arguments: "{}" }],
      })
      .mockRejectedValueOnce(new APIError(500, {}, "Unavailable", undefined));
    const result = await run(fakeClient(complete), "model", "", prompt, [
      { name: "write", parameters: { type: "object" }, function: execute },
    ]);
    expect(result.status).toBe("failed");
    expect(result.messages.at(-1)?.content[0]).toMatchObject({ type: "tool_result", id: "once" });
    const resumed = await run(fakeClient(vi.fn().mockResolvedValue(done)), "model", "", result.messages, []);
    expect(resumed.status).toBe("completed");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("rejects duplicate call IDs before any tool side effects", async () => {
    const execute = vi.fn();
    const call = { type: "tool_call", id: "duplicate", name: "write", arguments: "{}" };
    const complete = vi.fn().mockResolvedValue({ role: "assistant", content: [call, call] });
    const result = await run(fakeClient(complete), "model", "", prompt, [
      { name: "write", parameters: { type: "object" }, function: execute },
    ]);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INVALID_TOOL_CALL");
    expect(execute).not.toHaveBeenCalled();
  });

  it("shares the model budget with nested agents and stops without another request", async () => {
    const child = vi.fn().mockResolvedValue(done);
    const parent = vi.fn().mockResolvedValue({
      role: "assistant",
      content: [{ type: "tool_call", id: "child", name: "agent", arguments: "{}" }],
    });
    const tool: Tool = {
      name: "agent",
      parameters: { type: "object" },
      function: async (_args, context) => {
        const nested = await run(fakeClient(child), "model", "", prompt, [], {
          invocationContext: context?.invocationContext?.fork("child"),
        });
        expect(nested.status).toBe("completed");
        return [{ type: "text", text: "Child done" }];
      },
    };
    const result = await run(fakeClient(parent), "model", "", prompt, [tool], { maxModelCalls: 2 });
    expect(result.status).toBe("max_turns");
    expect(result.modelCalls).toEqual({ used: 2, limit: 2 });
    expect(parent).toHaveBeenCalledOnce();
    expect(child).toHaveBeenCalledOnce();
  });
});

describe("truncated tool calls", () => {
  const truncatedArguments = '{"path": "/etl/pipeline.py"';

  function writeTool(fn: () => Promise<unknown>): Tool {
    return {
      name: "create",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
        additionalProperties: false,
      },
      function: fn as Tool["function"],
    };
  }

  // A response cut short by max_output_tokens finalizes the call with a
  // truncated JSON prefix. Repairing it yields {"path": "..."} — valid, but
  // missing the payload the model was mid-way through writing — so the tool
  // would blame the model for omitting `content`.
  it("reports the token limit instead of running the tool with a missing payload", async () => {
    const invoked = vi.fn(async () => [{ type: "text" as const, text: "written" }]);
    const complete = vi.fn(async () => ({
      role: "assistant" as const,
      content: [
        {
          type: "tool_call" as const,
          id: "call_truncated",
          name: "create",
          arguments: truncatedArguments,
          incomplete: true,
        },
      ],
    }));

    const result = await run(
      fakeClient(complete as Client["complete"]),
      "model",
      "instructions",
      prompt,
      [writeTool(invoked)],
      { maxTurns: 1 },
    );

    expect(invoked).not.toHaveBeenCalled();

    const text = JSON.stringify(result);
    expect(text).toContain("output token limit");
    expect(text).not.toContain("content is required");
  });

  // Without the flag the same arguments must still take the ordinary repair
  // path, so the fix does not change behaviour for complete calls.
  it("still parses complete arguments normally", async () => {
    const invoked = vi.fn(async () => [{ type: "text" as const, text: "written" }]);
    const complete = vi.fn(async () => ({
      role: "assistant" as const,
      content: [
        {
          type: "tool_call" as const,
          id: "call_ok",
          name: "create",
          arguments: '{"path": "/a.py", "content": "print(1)"}',
        },
      ],
    }));

    await run(fakeClient(complete as Client["complete"]), "model", "instructions", prompt, [writeTool(invoked)], {
      maxTurns: 1,
    });

    expect(invoked).toHaveBeenCalled();
  });
});
