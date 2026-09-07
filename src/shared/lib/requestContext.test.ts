import { describe, expect, it } from "vitest";
import { Role, type Message } from "../types/chat";
import { captureRequestContext, injectRequestContext } from "./requestContext";

describe("request context", () => {
  it("keeps history unchanged and adds metadata to the human turn through tool continuations", () => {
    const messages: Message[] = [
      { role: Role.User, content: [{ type: "text", text: "Old request" }] },
      { role: Role.Assistant, content: [{ type: "text", text: "Old answer" }] },
      { role: Role.User, content: [{ type: "text", text: "Edit this" }] },
      {
        role: Role.User,
        content: [{ type: "tool_result", id: "call", name: "artifacts_read", arguments: "{}", result: [] }],
      },
    ];
    const original = structuredClone(messages);
    const context = captureRequestContext('active_file: "/a.txt"', new Date("2026-09-04T10:00:00Z"));
    const wire = injectRequestContext(messages, context);
    expect(wire.slice(0, 2)).toEqual(messages.slice(0, 2));
    expect(wire[3]).toBe(messages[3]);
    expect(wire[2].content.at(-1)).toEqual({ type: "text", text: context });
    expect(context).toContain("2026-09-04T10:00:00.000Z");
    expect(context).toContain('active_file: "/a.txt"');
    expect(messages).toEqual(original);
    expect(injectRequestContext(messages, context)).toEqual(wire);
    const next = injectRequestContext(messages, captureRequestContext('active_file: "/b.txt"'));
    expect(JSON.stringify(next)).not.toContain("/a.txt");
  });
});
