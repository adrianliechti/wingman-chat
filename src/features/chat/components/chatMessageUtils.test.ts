import { describe, expect, it } from "vitest";
import type { UIMessage } from "@tanstack/ai";
import { assistantMessage, userMessage, type ToolResultMetadata } from "@/shared/lib/messages";
import { collectTurnArtifactPaths, groupRenderUnits, summarizeToolGroup } from "./chatMessageUtils";

/** A committed tool round in its own assistant turn. */
function result(id: string, name: string, args: Record<string, unknown>, meta?: Record<string, unknown>): UIMessage {
  return assistantMessage(
    [
      { type: "tool-call", id, name, arguments: JSON.stringify(args), state: "complete" },
      {
        type: "tool-result",
        toolCallId: id,
        content: "",
        state: "complete",
        metadata: { result: [], meta } satisfies ToolResultMetadata,
      },
    ],
    { id: `turn-${id}` },
  );
}

describe("summarizeToolGroup", () => {
  it("shows a delegated conversation once, while keeping other results and failures", () => {
    const messages: UIMessage[] = [
      userMessage("Research"),
      assistantMessage([
        {
          type: "subagent",
          subagent: { id: "child", name: "research", parentToolCallId: "delegate", status: "finished", messages: [] },
        },
      ]),
      result("delegate", "research", {}),
      result("other", "read", {}),
      assistantMessage("Answer"),
    ];
    expect(groupRenderUnits(messages, false)).toEqual([0, 1, 3, 4].map((index) => ({ kind: "message", index })));
    const failed = result("delegate", "research", {});
    failed.parts[1] = { ...failed.parts[1], state: "error", error: "Could not return the report" } as never;
    messages[2] = failed;
    expect(groupRenderUnits(messages, false)).toContainEqual({ kind: "message", index: 2 });
    messages[1] = assistantMessage([]);
    messages[2] = result("delegate", "research", {});
    expect(groupRenderUnits(messages, false)).toContainEqual({ kind: "toolGroup", indices: [2, 3] });
  });

  it("folds several rounds of one turn and leaves a lone round standalone", () => {
    const twoRounds = assistantMessage([
      { type: "tool-call", id: "a", name: "read", arguments: "{}", state: "complete" },
      { type: "tool-result", toolCallId: "a", content: "", state: "complete" },
      { type: "tool-call", id: "b", name: "read", arguments: "{}", state: "complete" },
      { type: "tool-result", toolCallId: "b", content: "", state: "complete" },
    ]);
    expect(groupRenderUnits([userMessage("Go"), twoRounds, assistantMessage("Done")], false)).toEqual([
      { kind: "message", index: 0 },
      { kind: "toolGroup", indices: [1] },
      { kind: "message", index: 2 },
    ]);
    expect(groupRenderUnits([userMessage("Go"), result("a", "read", {}), assistantMessage("Done")], false)).toEqual(
      [0, 1, 2].map((index) => ({ kind: "message", index })),
    );
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
    const messages: UIMessage[] = [
      userMessage("Run it"),
      result("legacy", name, { code: "legacy script" }, { artifactFiles: ["/legacy.txt"] }),
      assistantMessage("Done"),
    ];
    expect(collectTurnArtifactPaths(messages, 2)).toEqual(["/legacy.txt"]);
    expect(summarizeToolGroup(messages, [1])).toBe("Ran 1 command");
  });

  it("still renders persisted calls that use the former file-tool names", () => {
    const messages: UIMessage[] = [
      userMessage("Create it"),
      result("1", "create_file", { path: "/legacy.txt" }),
      assistantMessage("Done"),
    ];

    expect(collectTurnArtifactPaths(messages, 2)).toEqual(["/legacy.txt"]);
    expect(summarizeToolGroup(messages, [1])).toBe("Edited 1 file");
  });

  it("shows subagent outputs and retires moved or deleted files without appended references", () => {
    const messages: UIMessage[] = [
      userMessage("Build the files"),
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
      assistantMessage("Done"),
    ];
    expect(collectTurnArtifactPaths(messages, 4)).toEqual(["/game.html"]);
  });
});
