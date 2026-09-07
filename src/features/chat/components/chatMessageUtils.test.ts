import { describe, expect, it } from "vitest";
import type { Message } from "@/shared/types/chat";
import { collectTurnArtifactPaths, summarizeToolGroup } from "./chatMessageUtils";

function result(id: string, name: string, args: Record<string, unknown>, meta?: Record<string, unknown>): Message {
  return {
    role: "user",
    content: [{ type: "tool_result", id, name, arguments: JSON.stringify(args), result: [], meta }],
  };
}

describe("summarizeToolGroup", () => {
  it("deduplicates file targets and preserves semantic ordering", () => {
    const messages = [
      result("1", "read", { path: "/a.ts" }),
      result("2", "read", { path: "/a.ts" }),
      result("3", "grep", { query: "needle" }),
      result("4", "create", { path: "/b.ts" }),
      result("5", "edit", { path: "/b.ts" }),
      result("6", "execute_python_code", { code: "print(1)" }),
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

  it("still renders persisted calls that use the former file-tool names", () => {
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "Create it" }] },
      result("1", "create_file", { path: "/legacy.txt" }),
      { role: "assistant", content: [{ type: "text", text: "Done" }] },
    ];

    expect(collectTurnArtifactPaths(messages, 2)).toEqual(["/legacy.txt"]);
    expect(summarizeToolGroup(messages, [1])).toBe("Edited 1 file");
  });
});
