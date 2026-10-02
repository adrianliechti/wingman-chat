import { describe, expect, it } from "vitest";
import type { Message } from "@/shared/types/chat";
import { collectTurnArtifactPaths, groupRenderUnits, summarizeToolGroup } from "./chatMessageUtils";

function result(id: string, name: string, args: Record<string, unknown>, meta?: Record<string, unknown>): Message {
  return {
    role: "user",
    content: [{ type: "tool_result", id, name, arguments: JSON.stringify(args), result: [], meta }],
  };
}

describe("summarizeToolGroup", () => {
  it("shows a delegated conversation once, while keeping other results and failures", () => {
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "Research" }] },
      {
        role: "assistant",
        content: [
          { type: "subagent", id: "child", name: "research", toolCallId: "delegate", status: "finished", messages: [] },
        ],
      },
      result("delegate", "research", {}),
      result("other", "read", {}),
      { role: "assistant", content: [{ type: "text", text: "Answer" }] },
    ];
    expect(groupRenderUnits(messages, false)).toEqual([0, 1, 3, 4].map((index) => ({ kind: "message", index })));
    messages[2].error = { code: "EXECUTION_ERROR", message: "Could not return the report" };
    expect(groupRenderUnits(messages, false)).toContainEqual({ kind: "message", index: 2 });
    messages[1].content = [];
    messages[2].error = undefined;
    expect(groupRenderUnits(messages, false)).toContainEqual({ kind: "toolGroup", indices: [2, 3] });
  });
  it("deduplicates file targets and preserves semantic ordering", () => {
    const messages = [
      result("1", "read", { path: "/a.ts" }),
      result("2", "read", { path: "/a.ts" }),
      result("3", "grep", { query: "needle" }),
      result("4", "create", { path: "/b.ts" }),
      result("5", "edit", { path: "/b.ts" }),
      result("6", "execute_script", { language: "python", code: "print(1)" }),
    ];
    expect(summarizeToolGroup(messages, [0, 1, 2, 3, 4, 5])).toBe(
      "Read 1 file, Ran 1 search, Edited 1 file, Ran 1 command",
    );
  });

  it("prefers canonical artifact deltas and falls back for generic tools", () => {
    const messages = [
      result(
        "1",
        "edit",
        { path: "/stale.ts" },
        {
          artifactDelta: {
            mutations: [{ operation: "move", from: "/a.ts", path: "/b.ts" }],
          },
        },
      ),
      result("2", "custom_tool", {}),
    ];
    expect(summarizeToolGroup(messages, [0, 1])).toBe("Edited 1 file, used 1 other tool");
    expect(summarizeToolGroup([result("3", "custom_tool", {})], [0])).toBe("Used 1 tool");
  });

  it.each(["execute_python_code", "execute_javascript_code"])("keeps historical %s results readable", (name) => {
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "Run it" }] },
      result("legacy", name, { code: "legacy script" }, { artifactFiles: ["/legacy.txt"] }),
      { role: "assistant", content: [{ type: "text", text: "Done" }] },
    ];
    expect(collectTurnArtifactPaths(messages, 2)).toEqual(["/legacy.txt"]);
    expect(summarizeToolGroup(messages, [1])).toBe("Ran 1 command");
  });

  it("still renders persisted calls that use the former file-tool names", () => {
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "Create it" }] },
      result("1", "create_file", { path: "/legacy.txt" }),
      { role: "assistant", content: [{ type: "text", text: "Done" }] },
    ];

    expect(collectTurnArtifactPaths(messages, 2)).toEqual(["/legacy.txt"]);
    expect(summarizeToolGroup(messages, [1])).toBe("Edited 1 file");
  });

  it("shows subagent outputs and retires moved or deleted files without appended references", () => {
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "Build the files" }] },
      result(
        "child",
        "agent",
        {},
        {
          artifactDelta: {
            mutations: [
              { operation: "create", path: "/draft.html" },
              { operation: "create", path: "/temp/a.txt" },
            ],
          },
        },
      ),
      result(
        "move",
        "artifacts_move",
        {},
        { artifactDelta: { mutations: [{ operation: "move", from: "/draft.html", path: "/game.html" }] } },
      ),
      result(
        "delete",
        "artifacts_delete",
        {},
        { artifactDelta: { mutations: [{ operation: "delete", path: "/temp" }] } },
      ),
      { role: "assistant", content: [{ type: "text", text: "Done" }] },
    ];
    expect(collectTurnArtifactPaths(messages, 4)).toEqual(["/game.html"]);
  });
});
