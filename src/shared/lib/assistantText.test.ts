import { describe, expect, it } from "vitest";
import type { Content } from "../types/chat";
import { getTextFromContent } from "../types/chat";
import { getFinalTextFromContent } from "./assistantText";

describe("final assistant text", () => {
  it.each<{ name: string; content: Content[]; expected: string }>([
    { name: "empty output", content: [], expected: "" },
    { name: "legacy output", content: [{ type: "text", text: "answer" }], expected: "answer" },
    {
      name: "multiple unphased messages",
      content: [
        { type: "text", text: "draft" },
        { type: "text", text: "answer" },
      ],
      expected: "answer",
    },
    {
      name: "last explicit final answer",
      content: [
        { type: "text", text: "draft", phase: "final_answer" },
        { type: "text", text: "answer", phase: "final_answer" },
        { type: "text", text: "trailing unphased message" },
      ],
      expected: "answer",
    },
    { name: "commentary only", content: [{ type: "text", text: "working", phase: "commentary" }], expected: "" },
    {
      name: "empty final answer",
      content: [
        { type: "text", text: "draft" },
        { type: "text", text: "", phase: "final_answer" },
      ],
      expected: "",
    },
  ])("selects $name", ({ content, expected }) => {
    expect(getFinalTextFromContent(content)).toBe(expected);
  });

  it("keeps progress text available for display and search", () => {
    const content: Content[] = [
      { type: "text", text: "working", phase: "commentary" },
      { type: "text", text: "answer", phase: "final_answer" },
    ];
    expect(getTextFromContent(content)).toBe("workinganswer");
    expect(getFinalTextFromContent(content)).toBe("answer");
  });
});
