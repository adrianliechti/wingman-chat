import { describe, expect, it } from "vitest";
import { mcpToolName } from "./mcpToolNames";

describe("MCP tool namespaces", () => {
  it("keeps remote names distinct after sanitization, truncation, and across servers", () => {
    const pairs = [
      ["server one", "read"],
      ["server two", "read"],
      ["server_one", "read"],
      ["server one", "a.b"],
      ["server one", "a/b"],
      ["server one", "x".repeat(100)],
      ["server one", "x".repeat(100) + "y"],
    ];
    const names = pairs.map(([server, tool]) => mcpToolName(server, tool));
    expect(new Set(names).size).toBe(pairs.length);
    for (const name of names) expect(name).toMatch(/^mcp__[a-zA-Z0-9_-]{1,59}$/);
    expect(Math.max(...names.map((name) => name.length))).toBeLessThanOrEqual(64);
    expect(mcpToolName("server one", "read")).toBe(names[0]);
  });
});
