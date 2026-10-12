import { describe, expect, it } from "vitest";
import type { UIMessage } from "@tanstack/ai";
import { assistantMessage, userMessage, type ToolResultMetadata } from "@/shared/lib/messages";
import { collectTurnArtifactPaths, groupRenderUnits, summarizeActivity, summarizeToolGroup } from "./chatMessageUtils";

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
        metadata: { meta } satisfies ToolResultMetadata,
      },
    ],
    { id: `turn-${id}` },
  );
}

describe("summarizeToolGroup", () => {
  it("keeps native widgets visible outside folded tool groups", () => {
    const widget = result("app", "app", {});
    widget.parts.push({
      type: "ui-resource",
      resource: { uri: "ui://app", mimeType: "text/html;profile=mcp-app", text: "<p>App</p>" },
      serverId: "server",
      toolCallId: "app",
      toolName: "app",
    });
    expect(groupRenderUnits([result("a", "read", {}), widget, result("b", "read", {})], false)).toEqual(
      [0, 1, 2].map((index) => ({ kind: "message", index })),
    );
  });
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

  it("folds the turn's reasoning, including the reply's opening thought, into the group", () => {
    const thought = result("b", "web_research", {});
    thought.parts.unshift({ type: "thinking", content: "Look deeper" });
    const reply = assistantMessage([
      { type: "thinking", content: "Summarize" },
      { type: "text", content: "Done" },
    ]);
    const messages = [userMessage("Go"), result("a", "web_fetch", {}), thought, reply];
    expect(groupRenderUnits(messages, false)).toEqual([
      { kind: "message", index: 0 },
      { kind: "toolGroup", indices: [1, 2], reply: 3 },
      { kind: "message", index: 3, foldedReasoning: true },
    ]);
    expect(summarizeActivity(messages, [1, 2], 3)).toBe("Used 2 tools and 2 thoughts");
    // One tool and one thought are already two steps worth folding.
    expect(groupRenderUnits([userMessage("Go"), result("a", "web_fetch", {}), reply], false)).toEqual([
      { kind: "message", index: 0 },
      { kind: "toolGroup", indices: [1], reply: 2 },
      { kind: "message", index: 2, foldedReasoning: true },
    ]);
    // The running round stays visible until it finishes.
    expect(groupRenderUnits(messages.slice(0, 3), true)).toEqual([0, 1, 2].map((index) => ({ kind: "message", index })));
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

  it("collects generated files from deltas without guessing from a failed call's arguments", () => {
    const failed = result("failed", "create", { path: "/missing.txt" });
    failed.parts[1] = { ...failed.parts[1], state: "error", error: "Disk full" } as never;
    const messages = [
      userMessage("Create it"),
      failed,
      result(
        "done",
        "execute_script",
        {},
        {
          artifactDelta: { mutations: [{ operation: "create", path: "/created.txt" }] },
        },
      ),
      assistantMessage("Done"),
    ];
    expect(collectTurnArtifactPaths(messages, 3)).toEqual(["/created.txt"]);
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
