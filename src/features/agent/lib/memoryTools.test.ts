import { describe, expect, it, vi } from "vitest";
import { REDACTED_SECRET } from "./memoryHygiene";
import { createMemoryStore } from "./memoryStore";
import { createFakeMemoryFs } from "./memoryTestUtils";
import {
  createMemoryTools,
  MEMORY_CONSOLIDATE_THRESHOLD,
  MEMORY_ENTRY_MAX_BYTES,
  MEMORY_MAX_OPS,
  type MemoryOpResult,
  memoryCallLabel,
  prepareMemoryEntry,
  searchMemoryDocs,
  toMemoryPath,
} from "./memoryTools";

const DIR = "agents/a1/memory";

const ENTRY = [
  "---",
  "type: Project Context",
  "title: Wingman",
  "description: The chat app",
  "tags: [repo]",
  "---",
  "Uses OPFS.",
  "Tests via vitest.",
].join("\n");

const SEED = {
  [`${DIR}/wingman.md`]: ENTRY.replace("---\nUses", "timestamp: 2026-01-02T00:00:00.000Z\n---\nUses"),
  [`${DIR}/adrian.md`]:
    "---\ntype: User Preference\ntitle: Adrian\ntimestamp: 2026-01-01T00:00:00.000Z\n---\nPrefers concise replies.",
  [`${DIR}/index.md`]: "# Memory",
};

function setup(initial: Record<string, string> = {}) {
  const { fs, files } = createFakeMemoryFs(initial);
  const store = createMemoryStore(fs, { dir: DIR, now: () => new Date("2026-09-05T12:00:00.000Z") });
  const onChange = vi.fn();
  const [tool] = createMemoryTools({ store, onChange });
  const call = async (ops: unknown): Promise<{ results?: MemoryOpResult[]; error?: string }> => {
    const result = await tool.function({ ops });
    const first = result[0];
    if (first.type !== "text") throw new Error("expected text result");
    return JSON.parse(first.text) as { results?: MemoryOpResult[]; error?: string };
  };
  const one = async (op: Record<string, unknown>): Promise<MemoryOpResult> => {
    const { results, error } = await call([op]);
    if (error) throw new Error(error);
    return results![0];
  };
  return { store, files, onChange, tool, call, one };
}

describe("memory tool surface", () => {
  it("is a single tool with a flat, union-free ops schema", () => {
    const { tool } = setup();
    expect(tool.name).toBe("memory");
    expect(tool.parameters).toMatchObject({ type: "object", required: ["ops"], additionalProperties: false });
    expect(JSON.stringify(tool.parameters)).not.toMatch(/anyOf|oneOf/);
  });

  it("labels calls by what they mostly did", () => {
    const read = { ops: [{ op: "read", path: "/user-prefs.md" }] };
    expect(memoryCallLabel(read, {})).toBe("Recalled User Prefs");
    expect(memoryCallLabel({ ops: [{ op: "search", pattern: "x" }] }, {})).toBe("Searched memory");
    expect(memoryCallLabel({ ops: [{ op: "write", path: "/a.md" }] }, { running: true })).toBe("Remembering…");
    expect(memoryCallLabel({ ops: [{ op: "write", path: "/a.md", find: "x" }] }, {})).toBe("Remembered A");
    expect(
      memoryCallLabel(
        {
          ops: [
            { op: "remove", path: "/a.md" },
            { op: "remove", path: "/b.md" },
          ],
        },
        {},
      ),
    ).toBe("Forgot 2 entries");
    expect(
      memoryCallLabel(
        {
          ops: [
            { op: "write", path: "/a.md" },
            { op: "remove", path: "/b.md" },
          ],
        },
        {},
      ),
    ).toBe("Updated memory");
    expect(memoryCallLabel(null, { error: true })).toBe("Memory failed");
    expect(memoryCallLabel({ ops: [{ op: "read", path: "../x.md" }] }, {})).toBe("Recalled memory");
  });

  it("shows written content in the expanded view", () => {
    const { tool } = setup();
    expect(
      tool.display?.input?.({
        ops: [
          { op: "write", path: "/a.md", content: "# hi" },
          { op: "read", path: "/b.md" },
        ],
      }),
    ).toEqual([{ code: "# hi", language: "markdown", name: "/a.md" }]);
  });

  it("maps model paths onto bundle filenames and rejects escapes", () => {
    expect(toMemoryPath("/project-context.md")).toBe("project-context.md");
    expect(toMemoryPath("project-context.md")).toBe("project-context.md");
    expect(toMemoryPath("/home/user/project-context.md")).toBe("project-context.md");
    for (const bad of ["/", "/../AGENTS.md", "/sub/dir.md", "/index.md", "/log.md", "/note.txt", "/.hidden.md", 7]) {
      expect(toMemoryPath(bad), String(bad)).toBeUndefined();
    }
  });

  it("validates the ops array", async () => {
    const { call } = setup();
    expect(await call([])).toEqual({ error: "ops must be a non-empty array of operations" });
    expect(await call("nope")).toEqual({ error: "ops must be a non-empty array of operations" });
    expect(await call([{ op: "patch" }])).toMatchObject({ error: expect.stringMatching(/unknown op "patch"/) });
    expect(
      await call(Array.from({ length: MEMORY_MAX_OPS + 1 }, () => ({ op: "search", pattern: "x" }))),
    ).toMatchObject({
      error: expect.stringMatching(/at most/),
    });
  });
});

describe("prepareMemoryEntry", () => {
  it("keeps well-formed frontmatter", () => {
    const prepared = prepareMemoryEntry("wingman.md", ENTRY);
    expect(prepared.frontmatter).toEqual({
      type: "Project Context",
      title: "Wingman",
      description: "The chat app",
      resource: undefined,
      tags: ["repo"],
      extra: undefined,
    });
    expect(prepared.body).toBe("Uses OPFS.\nTests via vitest.");
    expect(prepared.redacted).toBe(0);
  });

  it("wraps plain markdown as a Reference note titled from the path", () => {
    const prepared = prepareMemoryEntry("deploy-notes.md", "# Deploy\n\nRun the release script on Fridays.");
    expect(prepared.frontmatter).toEqual({ type: "Reference", title: "Deploy Notes", description: "Deploy" });
    expect(prepared.body).toBe("# Deploy\n\nRun the release script on Fridays.");
  });

  it("fills a missing title from the path and a missing description from the body", () => {
    const prepared = prepareMemoryEntry("user-prefs.md", "---\ntype: User Preference\n---\nPrefers tables.");
    expect(prepared.frontmatter.title).toBe("User Prefs");
    expect(prepared.frontmatter.description).toBe("Prefers tables.");
  });

  it("treats frontmatter without a type as no frontmatter", () => {
    const prepared = prepareMemoryEntry("x.md", "---\ntitle: Only title\n---\nbody text");
    expect(prepared.frontmatter.type).toBe("Reference");
    expect(prepared.body).toBe("body text");
  });

  it("redacts credentials anywhere in the content", () => {
    const prepared = prepareMemoryEntry(
      "x.md",
      `---\ntype: Reference\ntitle: Key ghp_${"a1B2c3D4e5".repeat(4)}\n---\npassword: hunter22`,
    );
    expect(prepared.redacted).toBe(2);
    expect(prepared.frontmatter.title).toBe(`Key ${REDACTED_SECRET}`);
    expect(prepared.body).toBe(`password: ${REDACTED_SECRET}`);
  });
});

describe("write op", () => {
  it("creates, then updates, and notifies each time", async () => {
    const { one, store, onChange } = setup();
    expect(await one({ op: "write", path: "/wingman.md", content: ENTRY })).toEqual({
      op: "write",
      path: "/wingman.md",
      action: "created",
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((await store.read("wingman.md"))?.body).toBe("Uses OPFS.\nTests via vitest.");

    expect(await one({ op: "write", path: "wingman.md", content: ENTRY.replace("OPFS", "IndexedDB") })).toMatchObject({
      action: "updated",
    });
    expect((await store.read("wingman.md"))?.body).toContain("IndexedDB");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("rejects bad paths and empty or oversized content without touching storage", async () => {
    const { one, files, onChange } = setup();
    const cases = [
      { path: "/../escape.md", content: ENTRY },
      { path: "/Upper.md", content: ENTRY },
      { path: "/index.md", content: ENTRY },
      { path: "/sub/dir.md", content: ENTRY },
      { path: "/note.txt", content: ENTRY },
      { path: undefined, content: ENTRY },
      { path: "/x.md", content: "   " },
      { path: "/x.md", content: "x".repeat(MEMORY_ENTRY_MAX_BYTES + 1) },
    ];
    for (const c of cases) {
      const result = await one({ op: "write", ...c });
      expect("error" in result && result.error, JSON.stringify(c).slice(0, 60)).toBeTruthy();
    }
    expect(files.size).toBe(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("attaches redaction and consolidation notes", async () => {
    const { one } = setup();
    const withSecret = await one({
      op: "write",
      path: "/creds.md",
      content: "---\ntype: Reference\ntitle: Creds\n---\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789",
    });
    expect(withSecret).toMatchObject({
      action: "created",
      note: expect.stringContaining("1 credential-like value was redacted"),
    });

    let last: MemoryOpResult | undefined;
    for (let i = 0; i <= MEMORY_CONSOLIDATE_THRESHOLD; i++) {
      last = await one({ op: "write", path: `/entry-${i}.md`, content: `note ${i}` });
    }
    expect(last).toMatchObject({
      note: expect.stringContaining(`You now have ${MEMORY_CONSOLIDATE_THRESHOLD + 2} entries`),
    });
  });
});

describe("read, search, edit, remove ops", () => {
  it("reads the serialized entry", async () => {
    const { one } = setup(SEED);
    const result = await one({ op: "read", path: "/wingman.md" });
    expect(result).toMatchObject({ op: "read", path: "/wingman.md" });
    expect("content" in result && result.content).toContain("type: Project Context");
    expect("content" in result && result.content).toContain("Tests via vitest.");

    expect(await one({ op: "read", path: "/nope.md" })).toEqual({
      op: "read",
      path: "/nope.md",
      error: "No memory entry at /nope.md",
    });
    expect(await one({ op: "read", path: "/../AGENTS.md" })).toMatchObject({ error: expect.stringMatching(/Invalid/) });
  });

  it("searches case-insensitively and falls back to a literal on a bad regex", async () => {
    const { one } = setup(SEED);
    const result = await one({ op: "search", pattern: "VITEST|concise" });
    expect(result).toMatchObject({ op: "search", total: 2 });
    expect("matches" in result && result.matches.map((m) => m.path).sort()).toEqual(["/adrian.md", "/wingman.md"]);

    expect(await one({ op: "search", pattern: "Uses OPFS. (" })).toMatchObject({ total: 0 });
    expect(await one({ op: "search", pattern: "OPFS. " })).toMatchObject({ total: 0 });
    expect(await one({ op: "search", pattern: "Uses OPFS." })).toMatchObject({ total: 1 });
    expect(await one({ op: "search", pattern: " " })).toMatchObject({ error: expect.stringMatching(/pattern/) });
  });

  it("bounds search results", () => {
    const docs = Array.from({ length: 40 }, (_, i) => ({
      path: `n${i}.md`,
      doc: { frontmatter: { type: "Reference", title: `N${i}`, timestamp: "2026-01-01T00:00:00.000Z" }, body: "hit" },
    }));
    const result = searchMemoryDocs(docs, "hit", 5);
    expect(result.matches).toHaveLength(5);
    expect(result.total).toBe(40);
  });

  it("write with find replaces one unique passage in place and re-normalizes the entry", async () => {
    const { one, store, onChange } = setup(SEED);
    expect(
      await one({ op: "write", path: "/wingman.md", find: "Uses OPFS.", content: "Uses OPFS for storage." }),
    ).toEqual({
      op: "write",
      path: "/wingman.md",
      action: "updated",
    });
    const doc = await store.read("wingman.md");
    expect(doc?.body).toBe("Uses OPFS for storage.\nTests via vitest.");
    expect(doc?.frontmatter.title).toBe("Wingman");
    expect(doc?.frontmatter.timestamp).toBe("2026-09-05T12:00:00.000Z");
    expect(onChange).toHaveBeenCalledTimes(1);

    expect(
      await one({ op: "write", path: "/wingman.md", find: "title: Wingman", content: "title: Wingman Chat" }),
    ).toMatchObject({
      action: "updated",
    });
    expect((await store.read("wingman.md"))?.frontmatter.title).toBe("Wingman Chat");
  });

  it("refuses ambiguous, missing, or emptying edits", async () => {
    const { one, store } = setup(SEED);
    expect(await one({ op: "write", path: "/wingman.md", find: "nowhere", content: "x" })).toMatchObject({
      error: expect.stringMatching(/not found/),
    });
    expect(await one({ op: "write", path: "/wingman.md", find: "s", content: "x" })).toMatchObject({
      error: expect.stringMatching(/more than once/),
    });
    expect(await one({ op: "write", path: "/missing.md", find: "a", content: "b" })).toMatchObject({
      error: expect.stringMatching(/No memory entry/),
    });
    expect((await store.read("wingman.md"))?.body).toBe("Uses OPFS.\nTests via vitest.");
  });

  it("removes an entry and notifies, or reports a missing one", async () => {
    const { one, store, onChange } = setup(SEED);
    expect(await one({ op: "remove", path: "/adrian.md" })).toEqual({
      op: "remove",
      path: "/adrian.md",
      action: "removed",
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(await store.read("adrian.md")).toBeUndefined();

    expect(await one({ op: "remove", path: "/adrian.md" })).toMatchObject({
      error: expect.stringMatching(/No memory entry/),
    });
    expect(await one({ op: "remove", path: "/index.md" })).toMatchObject({ error: expect.stringMatching(/Invalid/) });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("runs a batch in order and reports per-op results", async () => {
    const { call, store } = setup(SEED);
    const { results } = await call([
      { op: "read", path: "/adrian.md" },
      {
        op: "write",
        path: "/adrian.md",
        content: "---\ntype: User Preference\ntitle: Adrian\n---\nPrefers concise replies and tables.",
      },
      { op: "remove", path: "/wingman.md" },
      { op: "read", path: "/wingman.md" },
    ]);
    expect(results?.map((r) => ("error" in r ? "error" : r.op))).toEqual(["read", "write", "remove", "error"]);
    expect((await store.list()).map((e) => e.path)).toEqual(["adrian.md"]);
  });
});
