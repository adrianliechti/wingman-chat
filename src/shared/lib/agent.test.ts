import { describe, expect, it, vi } from "vitest";
import type { Client } from "./client";
import { run } from "./agent";
import type { Message, Tool } from "../types/chat";

const prompt: Message[] = [{ role: "user", content: [{ type: "text", text: "go" }] }];

function fakeClient(complete: Client["complete"]): Client {
  return { complete } as Client;
}

describe("agent run controller", () => {
  it("returns max_turns with an ordered, schema-versioned checkpoint", async () => {
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
    expect(result.checkpoint.schemaVersion).toBe("1.0");
    expect(result.checkpoint.modelCalls).toEqual({ used: 2, limit: 2 });
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
});
