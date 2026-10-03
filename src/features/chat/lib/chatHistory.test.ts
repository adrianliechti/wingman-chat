import { feedbackMessage } from "@/shared/lib/test-support/ai";
import type { ModelMessage } from "@tanstack/ai";
import { ALREADY_LOADED } from "@tanstack/ai-skills";
import { describe, expect, it } from "vitest";
import { assistantMessage, mediaFromDataUrl, userMessage } from "@/shared/lib/messages";
import { prepareChatMessages, sanitizeForClassification } from "./chatHistory";

const user = (content: string): ModelMessage => ({ role: "user", content });
const assistant = (content: string): ModelMessage => ({ role: "assistant", content });
const call = (id: string, args = "{}"): ModelMessage => ({
  role: "assistant",
  content: null,
  toolCalls: [{ id, type: "function", function: { name: "read", arguments: args } }],
});
const output = (id: string, content: string): ModelMessage => ({ role: "tool", toolCallId: id, content });
const feedback: ModelMessage = {
  role: "user",
  content: "Fix the missing deliverable.",
  metadata: { kind: "runtime_feedback" },
};
describe("saved chat history", () => {
  it("retains native skill instructions and inventories, ignoring duplicate-load markers", () => {
    const loaded = (id: string, name: string, value: object, args = "{}"): ModelMessage[] => [
      { role: "assistant", content: null, toolCalls: [{ id, type: "function", function: { name, arguments: args } }] },
      { role: "tool", toolCallId: id, content: JSON.stringify(value) },
    ];
    const messages: ModelMessage[] = [
      user("Work"),
      ...loaded("personal", "read_skill", { name: "reports", instructions: "Personal instructions" }),
      ...loaded(
        "old-plugin",
        "read_skill",
        { name: "reports", instructions: "Old plugin instructions" },
        '{"plugin":"one"}',
      ),
      ...loaded("updated", "load_skill", {
        skill: "one:reports",
        content: "Updated plugin instructions",
        resources: ["scripts/verify.py"],
        scripts: [],
        compatibility: "Browser Python",
      }),
      ...loaded("other", "load_skill", {
        skill: "two:reports",
        content: "Other plugin instructions",
        resources: [],
        scripts: [],
      }),
      ...loaded("again", "load_skill", { skill: "one:reports", content: ALREADY_LOADED, resources: [], scripts: [] }),
      { role: "assistant", content: "Prior work", metadata: { kind: "summary" } },
      user("Continue"),
    ];
    const prepared = JSON.stringify(prepareChatMessages(messages));
    expect(prepared).toContain("Personal instructions");
    expect(prepared).toContain("Updated plugin instructions");
    expect(prepared).toContain("Other plugin instructions");
    expect(prepared).toContain("scripts/verify.py");
    expect(prepared).toContain("Browser Python");
    expect(prepared).not.toContain("Old plugin instructions");
    expect(prepared).not.toContain(ALREADY_LOADED);
    expect(prepared).not.toContain('"role":"tool"');
  });

  it("keeps current-turn images after tool results and strips only older images", () => {
    const image = (value: string): ModelMessage => ({
      role: "user",
      content: [{ type: "image", source: { type: "data", value, mimeType: "image/png" } }],
    });
    const old = image("old");
    const current = image("current");
    const prepared = prepareChatMessages([old, assistant("Previous"), current, call("a"), output("a", "OK"), feedback]);
    expect((prepared[0].content as { type: string }[])[0].type).toBe("text");
    expect(prepared[2]).toBe(current);
    expect((old.content as { type: string }[])[0].type).toBe("image");
  });

  it("does not count internal feedback as a human turn when trimming tool history", () => {
    const longOutput = output("a", "x".repeat(5000));
    const messages = [user("Work"), call("a"), longOutput, feedback, assistant("Still working"), feedback];
    expect(prepareChatMessages(messages)[2]).toBe(longOutput);
  });

  it("keeps the human request and feedback beside a legacy summary inside the current turn", () => {
    const messages = [
      user("Old"),
      assistant("Old answer"),
      user("Current"),
      feedback,
      { role: "assistant", content: "Summary", metadata: { kind: "summary" } } as ModelMessage,
      call("a"),
      output("a", "OK"),
    ];
    const prepared = prepareChatMessages(messages, "<context>now</context>");
    expect(prepared.map((message) => message.content)).toEqual([
      "Summary",
      [
        { type: "text", content: "Current" },
        { type: "text", content: "<context>now</context>" },
      ],
      "Fix the missing deliverable.",
      null,
      "OK",
    ]);
  });
});

describe("classification view", () => {
  it("keeps recent prose, describes media, and hides internal feedback", () => {
    const messages = [
      userMessage([{ type: "text", content: "Explain" }, mediaFromDataUrl("data:image/png;base64,AQ==", "chart.png")]),
      feedbackMessage("Fix it", "verification"),
      assistantMessage("Done", { metadata: { kind: "summary" } }),
    ];
    expect(sanitizeForClassification(messages)).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Explain" },
          { type: "text", text: "[image: chart.png]" },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "Done" }] },
    ]);
  });
});
