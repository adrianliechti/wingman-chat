import { describe, expect, it, vi } from "vitest";
import { REDACTED_SECRET } from "./memoryHygiene";
import { createMemoryStore } from "./memoryStore";
import { createFakeMemoryFs } from "./memoryTestUtils";
import { createMemoryTools, MEMORY_CONSOLIDATE_THRESHOLD, MEMORY_ENTRY_MAX_BYTES, memoryLabel } from "./memoryTools";

const DIR = "agents/a1/memory";

function setup(initial: Record<string, string> = {}) {
  const { fs, files } = createFakeMemoryFs(initial);
  const store = createMemoryStore(fs, { dir: DIR, now: () => new Date("2026-09-05T12:00:00.000Z") });
  const onChange = vi.fn();
  const tools = createMemoryTools({ store, onChange });
  const tool = (name: string) => {
    const found = tools.find((t) => t.name === name);
    if (!found) throw new Error(`missing tool ${name}`);
    return found;
  };
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await tool(name).function(args);
    const first = result[0];
    if (first.type !== "text") throw new Error("expected text result");
    try {
      return JSON.parse(first.text) as unknown;
    } catch {
      return first.text;
    }
  };
  return { store, files, onChange, tools, tool, call };
}

describe("memory tool definitions", () => {
  it("exposes the five tools with strict schemas", () => {
    const { tools } = setup();
    expect(tools.map((t) => t.name)).toEqual([
      "list_memory",
      "read_memory",
      "search_memory",
      "write_memory",
      "delete_memory",
    ]);
    for (const t of tools) {
      expect(t.parameters).toMatchObject({ type: "object", additionalProperties: false });
      expect(Array.isArray(t.parameters.required)).toBe(true);
    }
  });

  it("labels calls by title, then filename, then a generic fallback", () => {
    expect(memoryLabel({ title: " Wingman ", path: "x.md" })).toBe("Wingman");
    expect(memoryLabel({ path: "project-context.md" })).toBe("Project Context");
    expect(memoryLabel(null)).toBe("memory");
  });

  it("renders friendly headers", () => {
    const { tool } = setup();
    expect(tool("write_memory").display?.header?.({ title: "Prefs" }, { running: true })?.label).toBe("Remembering…");
    expect(tool("write_memory").display?.header?.({ title: "Prefs" }, {})?.label).toBe("Remembered Prefs");
    expect(tool("write_memory").display?.header?.({ title: "Prefs" }, { error: true })?.label).toBe(
      "Couldn't remember",
    );
    expect(tool("read_memory").display?.header?.({ path: "user-prefs.md" }, {})?.label).toBe("Recalled User Prefs");
    expect(tool("delete_memory").display?.header?.({ path: "user-prefs.md" }, {})?.label).toBe("Forgot User Prefs");
    expect(tool("search_memory").display?.header?.({ queries: ["a", "b"] }, {})?.preview).toBe("a, b");
    expect(tool("write_memory").display?.input?.({ body: "# hi" })).toEqual([{ code: "# hi", language: "markdown" }]);
  });
});

describe("write_memory", () => {
  const valid = { path: "project-context.md", type: "Project Context", title: "Wingman", body: "React app." };

  it("creates an entry and notifies", async () => {
    const { call, store, onChange } = setup();
    expect(await call("write_memory", valid)).toBe('Memory entry "project-context.md" saved.');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((await store.read("project-context.md"))?.body).toBe("React app.");
  });

  it("rejects bad paths without touching storage", async () => {
    const { call, files, onChange } = setup();
    for (const path of ["../escape.md", "Upper.md", "index.md", "log.md", "sub/dir.md", "note.txt", undefined]) {
      const result = (await call("write_memory", { ...valid, path })) as { error: string };
      expect(result.error, String(path)).toBeTruthy();
    }
    expect(files.size).toBe(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects missing or blank required fields", async () => {
    const { call } = setup();
    expect(await call("write_memory", { ...valid, body: "   " })).toMatchObject({
      error: expect.stringMatching(/required/),
    });
    expect(await call("write_memory", { ...valid, title: "" })).toMatchObject({
      error: expect.stringMatching(/required/),
    });
    expect(await call("write_memory", { ...valid, type: 5 })).toMatchObject({
      error: expect.stringMatching(/required/),
    });
  });

  it("enforces the per-entry size limit", async () => {
    const { call, files } = setup();
    const result = (await call("write_memory", { ...valid, body: "x".repeat(MEMORY_ENTRY_MAX_BYTES + 1) })) as {
      error: string;
    };
    expect(result.error).toMatch(/exceeds the 4KB-per-entry limit/);
    expect(files.size).toBe(0);
  });

  it("redacts credentials across title, description and body and says so", async () => {
    const { call, store } = setup();
    const response = await call("write_memory", {
      ...valid,
      title: "Deploy key ghp_" + "a1B2c3D4e5".repeat(4),
      description: "password: hunter22",
      body: "Use Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789 for staging.",
    });
    expect(response).toContain("3 credential-like values were redacted");

    const doc = await store.read("project-context.md");
    expect(doc?.frontmatter.title).toBe(`Deploy key ${REDACTED_SECRET}`);
    expect(doc?.frontmatter.description).toBe(`password: ${REDACTED_SECRET}`);
    expect(doc?.body).toBe(`Use Authorization: Bearer ${REDACTED_SECRET} for staging.`);
  });

  it("normalizes optional metadata", async () => {
    const { call, store } = setup();
    await call("write_memory", {
      ...valid,
      description: `  ${"d".repeat(300)}  `,
      tags: ["a", " a ", "", 3, "b"],
      resource: "https://example.com/x",
    });
    const doc = await store.read("project-context.md");
    expect(doc?.frontmatter.description).toHaveLength(200);
    expect(doc?.frontmatter.tags).toEqual(["a", "b"]);
    expect(doc?.frontmatter.resource).toBe("https://example.com/x");
  });

  it("nudges consolidation past the threshold", async () => {
    const { call } = setup();
    let last = "";
    for (let i = 0; i <= MEMORY_CONSOLIDATE_THRESHOLD; i++) {
      last = (await call("write_memory", { ...valid, path: `entry-${i}.md` })) as string;
    }
    expect(last).toContain(`You now have ${MEMORY_CONSOLIDATE_THRESHOLD + 1} entries`);
  });
});

describe("read, list, search, delete", () => {
  const seed = {
    [`${DIR}/wingman.md`]:
      "---\ntype: Project Context\ntitle: Wingman\ndescription: The chat app\ntags: [repo]\ntimestamp: 2026-01-02T00:00:00.000Z\n---\nUses OPFS.\nTests via vitest.",
    [`${DIR}/adrian.md`]:
      "---\ntype: User Preference\ntitle: Adrian\ntimestamp: 2026-01-01T00:00:00.000Z\n---\nPrefers concise replies.",
    [`${DIR}/index.md`]: "# Memory",
  };

  it("lists metadata without bodies, newest first", async () => {
    const { call } = setup(seed);
    const entries = (await call("list_memory")) as Record<string, unknown>[];
    expect(entries.map((e) => e.path)).toEqual(["wingman.md", "adrian.md"]);
    expect(entries[0]).toMatchObject({ title: "Wingman", type: "Project Context", tags: ["repo"] });
    expect(entries[0]).not.toHaveProperty("body");
  });

  it("reads one entry with its path and body", async () => {
    const { call } = setup(seed);
    expect(await call("read_memory", { path: "wingman.md" })).toMatchObject({
      path: "wingman.md",
      title: "Wingman",
      body: "Uses OPFS.\nTests via vitest.",
    });
    expect(await call("read_memory", { path: "nope.md" })).toEqual({ error: "No memory entry at nope.md" });
    expect(await call("read_memory", { path: "../AGENTS.md" })).toMatchObject({
      error: expect.stringMatching(/Invalid/),
    });
  });

  it("searches across entries and surfaces validation errors", async () => {
    const { call } = setup(seed);
    const result = (await call("search_memory", { queries: ["vitest", "concise"] })) as {
      matches: { path: string; text: string }[];
      total: number;
    };
    expect(result.total).toBe(2);
    expect(result.matches.map((m) => m.path)).toEqual(["adrian.md", "wingman.md"]);

    expect(await call("search_memory", { queries: [] })).toEqual({ error: "At least one non-empty query is required" });
  });

  it("deletes an entry and notifies, or reports a missing one", async () => {
    const { call, store, onChange } = setup(seed);
    expect(await call("delete_memory", { path: "adrian.md" })).toBe('Memory entry "adrian.md" deleted.');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(await store.read("adrian.md")).toBeUndefined();

    expect(await call("delete_memory", { path: "adrian.md" })).toEqual({ error: "No memory entry at adrian.md" });
    expect(await call("delete_memory", { path: "index.md" })).toMatchObject({
      error: expect.stringMatching(/Invalid/),
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
