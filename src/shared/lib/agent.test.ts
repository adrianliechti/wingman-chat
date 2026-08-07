import { describe, expect, it, vi } from "vitest";
import type { Client } from "./client";
import { run } from "./agent";
import { AgentInvocationContext } from "./agent-run-controller";
import { elideToolArguments } from "./toolHistoryTrim";
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

  it("refuses to write content the model copied from a trimmed earlier call", async () => {
    // What the model can see once history trimming shortened its own earlier
    // create_skill call — a 300-char preview plus the elision marker.
    const elided = elideToolArguments(
      JSON.stringify({ name: "hvb-review-deck-pptx", content: "# HVB review deck\n\n".padEnd(15_414, "detail. ") }),
    );
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        role: "assistant",
        content: [{ type: "tool_call", id: "echoed", name: "update_skill", arguments: elided }],
      })
      .mockResolvedValueOnce({ role: "assistant", content: [{ type: "text", text: "re-reading first" }] });
    const execute = vi.fn();
    const tool: Tool = {
      name: "update_skill",
      parameters: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" }, content: { type: "string" } },
      },
      function: execute,
    };

    const result = await run(fakeClient(complete as Client["complete"]), "model", "instructions", prompt, [tool]);

    expect(result.status).toBe("completed");
    expect(execute).not.toHaveBeenCalled();
    const toolResult = result.messages
      .flatMap((message) => message.content)
      .find((part) => part.type === "tool_result" && part.id === "echoed");
    expect(toolResult && "result" in toolResult ? toolResult.result : []).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("nothing was written") })]),
    );
  });

  it("still writes a full-length payload that merely looks bulky", async () => {
    const content = "# HVB review deck\n\n".padEnd(15_414, "detail. ");
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        role: "assistant",
        content: [
          {
            type: "tool_call",
            id: "full",
            name: "update_skill",
            arguments: JSON.stringify({ name: "hvb-review-deck-pptx", content }),
          },
        ],
      })
      .mockResolvedValueOnce({ role: "assistant", content: [{ type: "text", text: "saved" }] });
    const execute = vi.fn().mockResolvedValue([{ type: "text", text: "ok" }]);
    const tool: Tool = {
      name: "update_skill",
      parameters: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" }, content: { type: "string" } },
      },
      function: execute,
    };

    await run(fakeClient(complete as Client["complete"]), "model", "instructions", prompt, [tool]);

    expect(execute).toHaveBeenCalledWith({ name: "hvb-review-deck-pptx", content }, expect.anything());
  });
});
