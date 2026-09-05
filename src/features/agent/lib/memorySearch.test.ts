import { describe, expect, it } from "vitest";
import type { MemoryDoc } from "./memoryParser";
import { MAX_SEARCH_RESULTS, MemorySearchError, searchMemoryDocs } from "./memorySearch";

function doc(title: string, body: string, tags?: string[]): MemoryDoc {
  return { frontmatter: { type: "Reference", title, tags, timestamp: "2026-01-01T00:00:00.000Z" }, body };
}

const docs = [
  { path: "wingman.md", doc: doc("Wingman Chat", "React app.\nUses OPFS for storage.\nTests run with vitest.") },
  { path: "adrian.md", doc: doc("Adrian", "Prefers concise replies.\nWorks in Zurich.", ["user"]) },
  { path: "codex.md", doc: doc("Codex Memory", "Two-phase pipeline.\nvitest is not used; Rust tests.") },
];

describe("searchMemoryDocs", () => {
  it("matches case-insensitively by default and orders by path then line", () => {
    const result = searchMemoryDocs(docs, { queries: ["VITEST"] });
    expect(result.total).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.matches.map((m) => [m.path, m.title, m.text])).toEqual([
      ["codex.md", "Codex Memory", "vitest is not used; Rust tests."],
      ["wingman.md", "Wingman Chat", "Tests run with vitest."],
    ]);
  });

  it("honors caseSensitive", () => {
    expect(searchMemoryDocs(docs, { queries: ["VITEST"], caseSensitive: true }).total).toBe(0);
    expect(searchMemoryDocs(docs, { queries: ["vitest"], caseSensitive: true }).total).toBe(2);
  });

  it("searches frontmatter too, so titles and tags are findable", () => {
    const byTitle = searchMemoryDocs(docs, { queries: ["Wingman Chat"] });
    expect(byTitle.matches[0]).toMatchObject({ path: "wingman.md", text: "title: Wingman Chat" });
    const byTag = searchMemoryDocs(docs, { queries: ["[user]"] });
    expect(byTag.matches.map((m) => m.path)).toEqual(["adrian.md"]);
  });

  it("supports any-of and all-on-same-line matching", () => {
    const any = searchMemoryDocs(docs, { queries: ["OPFS", "Zurich"] });
    expect(any.matches.map((m) => m.path)).toEqual(["adrian.md", "wingman.md"]);

    const all = searchMemoryDocs(docs, { queries: ["vitest", "rust"], matchAll: true });
    expect(all.matches.map((m) => m.path)).toEqual(["codex.md"]);
  });

  it("includes clamped context lines", () => {
    const result = searchMemoryDocs(docs, { queries: ["OPFS"], contextLines: 99 });
    expect(result.matches[0].context).toContain("React app.");
    expect(result.matches[0].context).toContain("Tests run with vitest.");
    expect(result.matches[0].line).toBeGreaterThan(1);
  });

  it("bounds results and reports truncation", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      path: `n${String(i).padStart(2, "0")}.md`,
      doc: doc(`N${i}`, "hit"),
    }));
    const result = searchMemoryDocs(many, { queries: ["hit"], maxResults: 5 });
    expect(result.matches).toHaveLength(5);
    expect(result.total).toBe(60);
    expect(result.truncated).toBe(true);

    const capped = searchMemoryDocs(many, { queries: ["hit"], maxResults: 10_000 });
    expect(capped.matches).toHaveLength(MAX_SEARCH_RESULTS);
  });

  it("rejects empty queries", () => {
    expect(() => searchMemoryDocs(docs, { queries: [] })).toThrow(MemorySearchError);
    expect(() => searchMemoryDocs(docs, { queries: ["  "] })).toThrow(MemorySearchError);
    expect(() => searchMemoryDocs(docs, { queries: "x" as unknown as string[] })).toThrow(MemorySearchError);
  });
});
