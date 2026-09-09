import { describe, expect, it, vi } from "vitest";
import { ASK_QUESTIONS_TOOL } from "./questionsTool";

describe("structured question validation", () => {
  it.each([
    [{ id: "format", label: "Which format?", type: "select" }],
    [{ id: "format", label: "Which formats?", type: "multi_select", options: [] }],
    [
      {
        id: "format",
        label: "Which format?",
        type: "select",
        options: [
          { value: "a", label: "A" },
          { value: "a", label: "B" },
        ],
      },
    ],
    [
      { id: "format", label: "Which format?", type: "text" },
      { id: "format", label: "What audience?", type: "text" },
    ],
    [
      { id: "", label: "Which format?", type: "text" },
      { id: "audience", label: "What audience?", type: "text" },
    ],
  ])("rejects an ambiguous or unanswerable form %j", async (...questions) => {
    const elicit = vi.fn().mockResolvedValue({ action: "accept", content: {} });
    const setError = vi.fn();
    const result = await ASK_QUESTIONS_TOOL.function({ questions }, { elicit, setError });
    expect(elicit).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith(expect.objectContaining({ code: "QUESTIONS_ERROR" }));
    expect(result).toEqual([{ type: "text", text: expect.stringContaining('"success":false') }]);
  });
});
