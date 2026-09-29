import { describe, expect, it } from "vitest";
import { ALREADY_LOADED } from "@tanstack/ai-skills";
import type { Message } from "@/shared/types/chat";
import { trimBulkyToolHistory } from "@/shared/lib/toolHistoryTrim";
import { prepareChatMessages } from "./chatHistory";

const user = (text: string): Message => ({ role: "user", content: [{ type: "text", text }] });
const assistant = (text: string): Message => ({ role: "assistant", content: [{ type: "text", text }] });
const call = (id: string, args = "{}"): Message => ({
  role: "assistant",
  content: [{ type: "tool_call", id, name: "read", arguments: args }],
});
const output = (id: string, text: string): Message => ({
  role: "user",
  content: [{ type: "tool_result", id, name: "read", arguments: "{}", result: [{ type: "text", text }] }],
});
const feedback: Message = {
  role: "user",
  content: [{ type: "runtime_feedback", source: "verification", text: "Fix the missing deliverable." }],
};
describe("saved chat history", () => {
  it("retains native skill instructions and inventories, ignoring duplicate-load markers", () => {
    const loaded = (id: string, name: string, value: object, args = "{}"): Message => ({
      role: "user",
      content: [
        { type: "tool_result", id, name, arguments: args, result: [{ type: "text", text: JSON.stringify(value) }] },
      ],
    });
    const messages: Message[] = [
      user("Work"),
      loaded("personal", "read_skill", { name: "reports", instructions: "Personal instructions" }),
      loaded(
        "old-plugin",
        "read_skill",
        { name: "reports", instructions: "Old plugin instructions" },
        '{"plugin":"one"}',
      ),
      loaded("updated", "load_skill", {
        skill: "one:reports",
        content: "Updated plugin instructions",
        resources: ["scripts/verify.py"],
        scripts: [],
        compatibility: "Browser Python",
      }),
      loaded("other", "load_skill", {
        skill: "two:reports",
        content: "Other plugin instructions",
        resources: [],
        scripts: [],
      }),
      loaded("again", "load_skill", { skill: "one:reports", content: ALREADY_LOADED, resources: [], scripts: [] }),
      { role: "assistant", content: [{ type: "summary", text: "Prior work" }] },
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
    expect(prepared).not.toContain("tool_result");
  });

  it("keeps current-turn images after tool results and strips only older images", () => {
    const old: Message = { role: "user", content: [{ type: "image", data: "data:image/png;base64,old" }] };
    const current: Message = { role: "user", content: [{ type: "image", data: "data:image/png;base64,current" }] };
    const prepared = prepareChatMessages([old, assistant("Previous"), current, call("a"), output("a", "OK"), feedback]);
    expect(prepared[0].content[0].type).toBe("text");
    expect(prepared[2]).toBe(current);
    expect(old.content[0].type).toBe("image");
  });

  it("does not count internal feedback as a human turn when trimming tool history", () => {
    const longOutput = output("a", "x".repeat(5000));
    const messages = [user("Work"), call("a"), longOutput, feedback, assistant("Still working"), feedback];
    expect(trimBulkyToolHistory(messages)).toBe(messages);
    expect(prepareChatMessages(messages)[2]).toBe(longOutput);
  });
});
