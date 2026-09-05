import { describe, expect, it } from "vitest";
import { buildMemoryRuntimeContext, stripIndexFrontmatter, truncateMemoryIndex } from "./memoryContext";

const index = [
  "---",
  'okf_version: "0.1"',
  "---",
  "",
  "# Memory",
  "",
  "* [A](a.md) - first",
  "* [B](b.md) - second",
  "",
].join("\n");

describe("memory runtime context", () => {
  it("strips the index frontmatter", () => {
    expect(stripIndexFrontmatter(index)).toBe("# Memory\n\n* [A](a.md) - first\n* [B](b.md) - second");
    expect(stripIndexFrontmatter("no frontmatter")).toBe("no frontmatter");
  });

  it("wraps the index in a memory-index block", () => {
    expect(buildMemoryRuntimeContext(index)).toBe(
      "<memory-index>\n# Memory\n\n* [A](a.md) - first\n* [B](b.md) - second\n</memory-index>",
    );
  });

  it("renders a placeholder for an empty index", () => {
    expect(buildMemoryRuntimeContext("")).toBe("<memory-index>\n_No memories yet._\n</memory-index>");
  });

  it("leaves a small index alone", () => {
    const body = "# Memory\n\n* [A](a.md) - first";
    expect(truncateMemoryIndex(body, 1024)).toBe(body);
  });

  it("truncates on line boundaries and reports how many entries were dropped", () => {
    const lines = [
      "# Memory",
      "",
      ...Array.from({ length: 50 }, (_, i) => `* [Entry ${i}](entry-${i}.md) - description ${i}`),
    ];
    const body = lines.join("\n");
    const truncated = truncateMemoryIndex(body, 400);

    expect(new TextEncoder().encode(truncated).length).toBeLessThan(400 + 120);
    expect(truncated.startsWith("# Memory\n\n* [Entry 0]")).toBe(true);
    const kept = truncated.split("\n").filter((l) => l.startsWith("* [Entry")).length;
    expect(truncated).toContain(`* … ${50 - kept} more entries not shown — call list_memory or search_memory.`);
    expect(
      truncated.split("\n").every((l) => l.includes("Entry") || l === "# Memory" || l === "" || l.startsWith("* …")),
    ).toBe(true);
  });

  it("never drops the first line even when it alone exceeds the budget", () => {
    const truncated = truncateMemoryIndex("x".repeat(100), 10);
    expect(truncated.startsWith("x".repeat(100))).toBe(true);
    expect(truncated).toContain("index truncated");
  });
});
