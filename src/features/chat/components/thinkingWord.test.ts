import { describe, expect, it } from "vitest";
import { getThinkingWord } from "./thinkingWord";

describe("getThinkingWord", () => {
  it("keeps the label stable across remounts within one agent run", () => {
    const runId = "same-agent-run";

    expect(getThinkingWord(runId)).toBe(getThinkingWord(runId));
  });

  it("still varies labels between agent runs", () => {
    const labels = new Set(Array.from({ length: 20 }, (_, index) => getThinkingWord(`run-${index}`)));

    expect(labels.size).toBeGreaterThan(1);
  });
});
