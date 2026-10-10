import { z } from "zod";
import { describe, expect, it } from "vitest";
import type { Tool } from "@/shared/types/chat";
import { resolveToolHeader } from "@/features/chat/components/toolDisplay";
import { SCRIPT_EXECUTION_DISPLAY } from "./executionToolDisplay";

const tool: Tool = {
  name: "execute_script",
  description: "",
  inputSchema: z.unknown(),
  execute: async () => [],
  display: SCRIPT_EXECUTION_DISPLAY,
};

describe("execution tool progress", () => {
  it("previews the inline language or script path, respecting that inline code wins", () => {
    const preview = (args: object) => resolveToolHeader(tool, tool.name, JSON.stringify(args), {}).preview;
    expect(preview({ language: "python", code: "print('hello')" })).toBe("Python");
    expect(preview({ language: "javascript", code: "console.log('hello')" })).toBe("JavaScript");
    expect(preview({ language: "bash", code: "cat /input.csv" })).toBe("Bash");
    expect(preview({ path: "/scripts/analysis.py", language: "python" })).toBe("scripts/analysis.py");
    expect(preview({ path: "/ignored.py", language: "bash", code: "ls" })).toBe("Bash");
    expect(preview({ code: "print('raw code is not a hint')" })).toBeNull();
  });

  it("keeps the label stable while partial code arguments stream", () => {
    const args = JSON.stringify({ language: "python", code: "print('a long script arrives one token at a time')" });
    const labels = new Set(
      Array.from(
        { length: args.length + 1 },
        (_, length) =>
          resolveToolHeader(tool, tool.name, args.slice(0, length), { running: true, toolCallId: "call-1" }).label,
      ),
    );
    expect(labels.size).toBe(1);
    expect(resolveToolHeader(tool, tool.name, args, { toolCallId: "call-1" }).label).toBe("Ran code");
    expect(resolveToolHeader(tool, tool.name, args, { error: true, toolCallId: "call-1" }).label).toBe(
      "Code hit a snag",
    );
  });

  it("still varies between separate calls", () => {
    const label = (toolCallId: string) => resolveToolHeader(tool, tool.name, "{}", { running: true, toolCallId }).label;
    expect(label("call-1")).not.toBe(label("call-2"));
  });
});
