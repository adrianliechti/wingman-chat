import type { ModelMessage } from "@tanstack/ai";
import { describe, expect, it } from "vitest";
import { captureRequestContext, injectRequestContext } from "./requestContext";

describe("request context", () => {
  it("keeps history unchanged and adds metadata to the human turn through tool continuations", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Old request" },
      { role: "assistant", content: "Old answer" },
      { role: "user", content: [{ type: "text", content: "Edit this" }] },
      { role: "tool", toolCallId: "call", content: "[]" },
    ];
    const original = structuredClone(messages);
    const context = captureRequestContext('active_file: "/a.txt"', new Date("2026-09-04T10:00:00Z"));
    const wire = injectRequestContext(messages, context);
    expect(wire.slice(0, 2)).toEqual(messages.slice(0, 2));
    expect(wire[3]).toBe(messages[3]);
    expect(wire[2].content).toEqual([
      { type: "text", content: "Edit this" },
      { type: "text", content: context },
    ]);
    expect(context).toContain("2026-09-04T10:00:00.000Z");
    expect(context).toContain('active_file: "/a.txt"');
    expect(messages).toEqual(original);
    expect(injectRequestContext(messages, context)).toEqual(wire);
    const next = injectRequestContext(messages, captureRequestContext('active_file: "/b.txt"'));
    expect(JSON.stringify(next)).not.toContain("/a.txt");
  });

  it("expands a plain string prompt into parts and skips internal feedback turns", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Build it" },
      { role: "user", content: "Fix the deliverable.", metadata: { kind: "runtime_feedback" } },
    ];
    const wire = injectRequestContext(messages, "<context>now</context>");
    expect(wire[0].content).toEqual([
      { type: "text", content: "Build it" },
      { type: "text", content: "<context>now</context>" },
    ]);
    expect(wire[1]).toBe(messages[1]);
    expect(injectRequestContext(messages, "   ")).toBe(messages);
  });
});
