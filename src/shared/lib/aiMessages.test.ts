import { convertMessagesToModelMessages, type UIMessage } from "@tanstack/ai";
import { expect, it } from "vitest";
import { fromAIMessages, toAIMessages } from "./aiMessages";
import type { Message } from "../types/chat";

const call = { type: "tool_call" as const, id: "call", name: "work", arguments: "{}" };
const result = {
  type: "tool_result" as const,
  id: "call",
  name: "work",
  arguments: "{}",
  result: [{ type: "image" as const, data: "data:image/png;base64,aW1hZ2U=" }],
  meta: { file: "/image.png" },
};

it("round trips persisted tool media and metadata in native part order", () => {
  const saved: Message[] = [
    { role: "assistant", content: [call] },
    { role: "user", content: [result] },
    { role: "assistant", content: [{ type: "text", text: "Done" }] },
  ];
  const native = toAIMessages(saved);
  expect(native[0].parts.map((part) => part.type)).toEqual(["tool-call", "tool-result"]);
  expect(fromAIMessages(native).map((message) => ({ role: message.role, content: message.content }))).toEqual(
    saved.map((message) => ({
      ...message,
      content: message.content.map((part) => (part.type === "tool_call" ? { ...part, incomplete: false } : part)),
    })),
  );
});

it("splits a native message containing several tool rounds into ordered stored turns", () => {
  const message: UIMessage = {
    id: "native",
    role: "assistant",
    parts: [
      { type: "tool-call", id: "call", name: "work", arguments: "{}", state: "complete" },
      { type: "tool-result", toolCallId: "call", content: "Saved", state: "complete" },
      { type: "text", content: "Done" },
    ],
  };
  expect(fromAIMessages([message]).map((message) => message.content[0].type)).toEqual([
    "tool_call",
    "tool_result",
    "text",
  ]);
});

it("uses the framework's incomplete state for saved cancelled calls and excludes orphan results", () => {
  const native = toAIMessages([
    { role: "assistant", content: [call] },
    { role: "user", content: [{ ...result, id: "orphan" }] },
    { role: "user", content: [{ type: "text", text: "Try again" }] },
  ]);
  const wire = convertMessagesToModelMessages(native);
  expect(wire.some((message) => message.toolCalls?.length || message.role === "tool")).toBe(false);
  expect(JSON.stringify(wire)).toContain("Try again");
});

it("pairs out-of-order results with the nearest preceding call without mutating stored history", () => {
  const saved: Message[] = [
    { role: "assistant", content: [call, { ...call, id: "other" }] },
    { role: "user", content: [{ ...result, id: "other" }, result] },
    { role: "assistant", content: [call] },
    { role: "user", content: [{ ...result, meta: { file: "/later.png" } }] },
  ];
  const before = JSON.stringify(saved);
  const native = toAIMessages(saved);
  expect(native.map((message) => message.parts.map((part) => part.type))).toEqual([
    ["tool-call", "tool-call", "tool-result", "tool-result"],
    ["tool-call", "tool-result"],
  ]);
  expect(native[1].parts[1]).toMatchObject({ metadata: { wingman: { ...result, meta: { file: "/later.png" } } } });
  expect(JSON.stringify(saved)).toBe(before);
});

it("translates old reasoning only for the producing model and keeps native signatures", () => {
  const history: Message[] = [
    {
      role: "assistant",
      content: [{ type: "reasoning", id: "rs", text: "Plan", encryptedContent: "opaque", model: "original" }],
    },
  ];
  expect(toAIMessages(history, "original")[0].parts[0]).toMatchObject({
    type: "thinking",
    signature: JSON.stringify({ id: "rs", encrypted_content: "opaque" }),
  });
  expect(toAIMessages(history, "different")[0].parts[0]).toMatchObject({ type: "thinking", signature: undefined });
  const stored = fromAIMessages(
    [{ id: "native", role: "assistant", parts: [{ type: "thinking", content: "Plan", signature: "opaque-native" }] }],
    "run",
    "original",
  );
  expect(toAIMessages(stored, "original")[0].parts[0]).toMatchObject({ signature: "opaque-native" });
});
