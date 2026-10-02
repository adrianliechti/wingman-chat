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

it("round trips failed tool results once without empty user turns or lost error details", () => {
  const error = { code: "PYTHON_EXECUTION_ERROR", message: "AssertionError on line 31" };
  let saved: Message[] = [
    { id: "prompt", role: "user", content: [{ type: "text", text: "Run the script" }] },
    { id: "assistant", role: "assistant", content: [call] },
    { id: "result-call", role: "user", content: [result], error },
  ];

  for (let i = 0; i < 3; i++) {
    const native = toAIMessages(saved);
    expect(native.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(native[1].parts[1]).toMatchObject({ type: "tool-result", state: "error", error: error.message });
    const wire = convertMessagesToModelMessages(native);
    expect(wire.map((message) => message.role)).toEqual(["user", "assistant", "tool"]);
    expect(wire[2]).toMatchObject({ toolCallId: "call", error: error.message });

    saved = fromAIMessages(JSON.parse(JSON.stringify(native)));
    expect(saved.map((message) => message.id)).toEqual(["prompt", "assistant", "result-call"]);
    expect(saved[2]).toMatchObject({ content: [result], error });
  }
});

it("drops stale empty user error turns while preserving assistant completion errors", () => {
  const error = { code: "TOOL_EXECUTION_ERROR", message: "Script failed" };
  const completion: Message = {
    id: "completion-error",
    role: "assistant",
    content: [],
    error: { code: "COMPLETION_ERROR", message: "Request failed" },
  };
  const saved: Message[] = [
    { id: "assistant", role: "assistant", content: [call] },
    { id: "result-call", role: "user", content: [result], error },
    { id: "result-call", role: "user", content: [], error },
    { id: "orphan", role: "user", content: [{ ...result, id: "orphan" }], error },
    completion,
  ];
  const native = toAIMessages(saved);
  expect(native.map((message) => message.id)).toEqual(["assistant", "completion-error"]);
  const restored = fromAIMessages(native);
  expect(restored.map((message) => message.id)).toEqual(["assistant", "result-call", "completion-error"]);
  expect(restored.at(-1)).toMatchObject(completion);
  expect(
    fromAIMessages([...native, { id: "result-call", role: "user", parts: [], metadata: { wingman: { error } } }]),
  ).toEqual(restored);
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
    { role: "assistant", content: [{ ...call, incomplete: true }] },
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

it("keeps reasoning in existing fields and replays it only for the producing model", () => {
  const history: Message[] = [
    {
      role: "assistant",
      content: [{ type: "reasoning", id: "rs", text: "Plan", encryptedContent: "opaque", model: "original" }],
    },
  ];
  expect(fromAIMessages(toAIMessages(history, "original"))[0].content).toEqual(history[0].content);
  expect(fromAIMessages(toAIMessages(history, "different"))[0].content).toEqual([
    { type: "reasoning", id: "rs", text: "Plan", model: "original" },
  ]);
  const stored = fromAIMessages(
    [
      {
        id: "native",
        role: "assistant",
        parts: [
          { type: "thinking", content: "Plan", signature: JSON.stringify({ id: "rs", encrypted_content: "opaque" }) },
        ],
      },
    ],
    "run",
    "original",
  );
  expect(stored[0].content).toEqual(history[0].content);
  expect(fromAIMessages(toAIMessages(stored, "original"))[0].content).toEqual(history[0].content);
});

it("preserves domain-only parts and identities through JSON persistence", () => {
  const messages: Message[] = [
    {
      id: "user",
      role: "user",
      content: [
        { type: "text", text: "Edit this" },
        { type: "artifact_ref", path: "/draft.md", revision: "v1" },
        { type: "artifact_selection", path: "/draft.md", text: "Selected text" },
      ],
    },
    { id: "feedback", role: "user", content: [{ type: "runtime_feedback", source: "verification", text: "Fix it" }] },
  ];
  let restored = messages;
  for (let i = 0; i < 3; i++) restored = fromAIMessages(JSON.parse(JSON.stringify(toAIMessages(restored))));
  expect(restored.map(({ id, content }) => ({ id, content }))).toEqual(
    messages.map(({ id, content }) => ({ id, content })),
  );
});

it("preserves a completed pending tool call for interrupt resume", () => {
  const native = toAIMessages([{ id: "assistant", role: "assistant", content: [call] }]);
  expect(native[0].parts[0]).toMatchObject({ state: "input-complete" });
  expect(convertMessagesToModelMessages(native)[0].toolCalls?.[0].id).toBe(call.id);
});

it("keeps subagent messages agnostic and restores native routing from separate state", () => {
  const native: UIMessage[] = [
    {
      id: "parent",
      role: "assistant",
      parts: [
        {
          type: "subagent",
          subagent: {
            id: "child",
            name: "research",
            status: "suspended",
            parentToolCallId: "delegate",
            interruptIds: ["approve"],
            metadata: { tanstack: { subagentPlan: { agent: "research" } } },
            messages: [
              {
                id: "child-message",
                role: "assistant",
                parts: [
                  { type: "tool-call", id: "call", name: "work", arguments: "{}", state: "complete" },
                  { type: "tool-result", toolCallId: "call", content: "Evidence", state: "complete" },
                  {
                    type: "subagent",
                    subagent: {
                      id: "nested",
                      name: "inspect",
                      status: "suspended",
                      interruptIds: ["nested-approval"],
                      messages: [],
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  ];
  const messages = fromAIMessages(native);
  const saved = JSON.stringify(messages);
  expect(saved).not.toMatch(/"parts"|parentToolCallId/);
  expect(messages[0].content[0]).toMatchObject({
    type: "subagent",
    id: "child",
    toolCallId: "delegate",
    signature: expect.stringMatching(/^@tanstack:/),
    messages: [
      { content: [{ type: "tool_call" }] },
      { content: [{ type: "tool_result" }] },
      { content: [{ type: "subagent", id: "nested" }] },
    ],
  });
  const restored = toAIMessages(JSON.parse(saved));
  expect(restored[0].parts[0]).toMatchObject({
    type: "subagent",
    subagent: {
      id: "child",
      parentToolCallId: "delegate",
      interruptIds: ["approve"],
      metadata: { tanstack: { subagentPlan: { agent: "research" } } },
      messages: [
        { parts: [{ type: "tool-call" }, { type: "tool-result" }] },
        { parts: [{ type: "subagent", subagent: { interruptIds: ["nested-approval"] } }] },
      ],
    },
  });
});

it("keeps media filenames and reasoning model identities through native persistence", () => {
  const messages: Message[] = [
    {
      role: "user",
      content: [
        { type: "image", name: "photo.jpg", data: "blob:sha256-image", contentType: "image/jpeg" },
        { type: "audio", name: "voice.wav", data: "blob:sha256-audio", contentType: "audio/wav" },
      ],
    },
    {
      role: "assistant",
      content: [{ type: "reasoning", id: "reason", text: "Plan", encryptedContent: "private", model: "producer" }],
    },
  ];
  const restored = fromAIMessages(JSON.parse(JSON.stringify(toAIMessages(messages))));
  expect(restored[0].content).toEqual(messages[0].content);
  expect(restored[1].content).toEqual(messages[1].content);
  expect(fromAIMessages(toAIMessages(restored, "other-model"))[1].content).toEqual([
    { type: "reasoning", id: "reason", text: "Plan", model: "producer" },
  ]);
});
