import { describe, expect, it } from "vitest";
import { parseMemoryDoc } from "./memoryParser";
import {
  createMemoryStore,
  MEMORY_LOG_MAX_ENTRIES,
  MemoryPathError,
  parseLogGroups,
  pruneLogGroups,
  serializeLogGroups,
  splitLegacySections,
} from "./memoryStore";
import { createFakeMemoryFs } from "./memoryTestUtils";

const DIR = "agents/a1/memory";
const LEGACY = "agents/a1/MEMORY.md";

function makeStore(initial: Record<string, string> = {}) {
  const { fs, files } = createFakeMemoryFs(initial);
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 8, 5, 12, 0, tick++));
  const store = createMemoryStore(fs, { dir: DIR, legacyPath: LEGACY, now });
  return { store, files, fs };
}

describe("MemoryStore CRUD", () => {
  it("writes an entry, rebuilds the index and logs the change", async () => {
    const { store, files } = makeStore();

    const entry = await store.write(
      "project-context.md",
      { type: "Project Context", title: "Wingman", description: "The repo", tags: ["repo"] },
      "React + OPFS.",
    );

    expect(entry).toMatchObject({
      path: "project-context.md",
      title: "Wingman",
      type: "Project Context",
      tags: ["repo"],
    });
    expect(entry.timestamp).toBe("2026-09-05T12:00:00.000Z");

    const written = parseMemoryDoc(files.get(`${DIR}/project-context.md`)?.content ?? "");
    expect(written?.body).toBe("React + OPFS.");

    expect(files.get(`${DIR}/index.md`)?.content).toBe(
      '---\nokf_version: "0.1"\n---\n\n# Memory\n\n* [Wingman](project-context.md) - The repo [repo]\n',
    );
    expect(files.get(`${DIR}/log.md`)?.content).toBe(
      "# Directory Update Log\n\n## 2026-09-05\n* **Created**: [Wingman](project-context.md)\n",
    );
  });

  it("updates in place, preserves resource and extra keys, and logs Updated", async () => {
    const { store, files } = makeStore({
      [`${DIR}/ref.md`]:
        "---\ntype: Reference\ntitle: Ref\nresource: https://example.com\ncustom: keep\ntimestamp: 2020-01-01T00:00:00.000Z\n---\nold",
    });

    await store.write("ref.md", { type: "Reference", title: "Ref v2" }, "new");

    const doc = await store.read("ref.md");
    expect(doc?.frontmatter).toMatchObject({
      title: "Ref v2",
      resource: "https://example.com",
      extra: { custom: "keep" },
      timestamp: "2026-09-05T12:00:00.000Z",
    });
    expect(doc?.body).toBe("new");
    expect(files.get(`${DIR}/log.md`)?.content).toContain("* **Updated**: [Ref v2](ref.md)");
  });

  it("lists newest first, ignoring reserved and non-markdown files", async () => {
    const { store } = makeStore({
      [`${DIR}/old.md`]: "---\ntype: Reference\ntitle: Old\ntimestamp: 2024-01-01T00:00:00.000Z\n---\nx",
      [`${DIR}/new.md`]: "---\ntype: Reference\ntitle: New\ntimestamp: 2025-01-01T00:00:00.000Z\n---\nx",
      [`${DIR}/index.md`]: "# Memory",
      [`${DIR}/log.md`]: "# Directory Update Log",
      [`${DIR}/notes.txt`]: "not markdown",
      [`${DIR}/broken.md`]: "no frontmatter",
    });
    expect((await store.list()).map((e) => e.path)).toEqual(["new.md", "old.md"]);
  });

  it("deletes an entry, refreshes the index and returns false for unknown paths", async () => {
    const { store, files } = makeStore();
    await store.write("a.md", { type: "Reference", title: "A" }, "x");
    await store.write("b.md", { type: "Reference", title: "B" }, "y");

    expect(await store.delete("a.md")).toBe(true);
    expect(await store.delete("a.md")).toBe(false);
    expect(files.has(`${DIR}/a.md`)).toBe(false);
    expect(files.get(`${DIR}/index.md`)?.content).not.toContain("a.md");
    expect(files.get(`${DIR}/index.md`)?.content).toContain("[B](b.md)");
    expect(files.get(`${DIR}/log.md`)?.content).toContain("* **Deleted**: A (`a.md`)");
  });

  it("refuses unsafe paths on every mutation and read", async () => {
    const { store, files } = makeStore({ "agents/a1/AGENTS.md": "secret agent prompt" });
    await expect(store.write("../AGENTS.md", { type: "x", title: "x" }, "clobber")).rejects.toThrow(MemoryPathError);
    await expect(store.delete("../AGENTS.md")).rejects.toThrow(MemoryPathError);
    await expect(store.write("index.md", { type: "x", title: "x" }, "clobber")).rejects.toThrow(MemoryPathError);
    expect(await store.read("../AGENTS.md")).toBeUndefined();
    expect(files.get("agents/a1/AGENTS.md")?.content).toBe("secret agent prompt");
  });

  it("serializes concurrent writes so the index reflects all of them", async () => {
    const { store, files } = makeStore();
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.write(`e-${i}.md`, { type: "Reference", title: `E${i}` }, "b")),
    );
    const index = files.get(`${DIR}/index.md`)?.content ?? "";
    for (let i = 0; i < 10; i++) expect(index).toContain(`(e-${i}.md)`);
    expect(parseLogGroups(files.get(`${DIR}/log.md`)?.content ?? "")[0].lines).toHaveLength(10);
  });

  it("serves reads from the cache and refreshes it on ensureMigrated", async () => {
    const { store, files } = makeStore();
    await store.write("a.md", { type: "Reference", title: "A" }, "alpha");
    expect((await store.list()).map((e) => e.path)).toEqual(["a.md"]);

    // Something else writes to storage directly (e.g. a zip import): the cache doesn't see it…
    files.set(`${DIR}/b.md`, {
      content: "---\ntype: Reference\ntitle: B\ntimestamp: 2027-01-01T00:00:00.000Z\n---\nbeta",
      lastModified: 1,
    });
    expect((await store.list()).map((e) => e.path)).toEqual(["a.md"]);

    // …until the bundle is (re)opened.
    await store.ensureMigrated();
    expect((await store.list()).map((e) => e.path)).toEqual(["b.md", "a.md"]);
  });

  it("reports the serialized size of each entry", async () => {
    const { store, files } = makeStore();
    const entry = await store.write("a.md", { type: "Reference", title: "A" }, "alpha");
    expect(entry.size).toBe(new TextEncoder().encode(files.get(`${DIR}/a.md`)?.content ?? "").length);
  });

  it("readAll returns bodies for search", async () => {
    const { store } = makeStore();
    await store.write("a.md", { type: "Reference", title: "A" }, "alpha");
    const all = await store.readAll();
    expect(all).toEqual([{ path: "a.md", doc: expect.objectContaining({ body: "alpha" }) }]);
  });
});

describe("MemoryStore migration", () => {
  it("creates an empty index when there is nothing to migrate", async () => {
    const { store, files } = makeStore();
    await store.ensureMigrated();
    expect(files.get(`${DIR}/index.md`)?.content).toContain("_No memories yet._");
    expect(files.has(`${DIR}/log.md`)).toBe(false);
  });

  it("splits a legacy MEMORY.md into one entry per section and removes it", async () => {
    const legacy = [
      "Intro line before headers",
      "",
      "## User Preferences",
      "- Likes tables",
      "",
      "## Project Context",
      "- Vite app",
      "",
      "## Empty Section",
      "",
      "## Project Context",
      "- duplicate header",
    ].join("\n");
    const { store, files } = makeStore({ [LEGACY]: legacy });

    await store.ensureMigrated();

    expect(files.has(LEGACY)).toBe(false);
    const entries = await store.list();
    expect(entries.map((e) => e.path).sort()).toEqual([
      "general.md",
      "project-context-2.md",
      "project-context.md",
      "user-preferences.md",
    ]);
    const prefs = await store.read("user-preferences.md");
    expect(prefs?.frontmatter).toMatchObject({ type: "User Preferences", title: "User Preferences" });
    expect(prefs?.body).toBe("- Likes tables");
    // legacy file's mtime (fake clock) becomes the entry timestamp
    expect(prefs?.frontmatter.timestamp).toBe(new Date(1_700_000_000_000).toISOString());
    expect(files.get(`${DIR}/log.md`)?.content).toContain("Migrated from single-file MEMORY.md (4 entries)");
  });

  it("is a no-op once the bundle has an index", async () => {
    const { store, files } = makeStore({
      [LEGACY]: "## Section\nstill here",
      [`${DIR}/index.md`]: "# Memory\n\n_No memories yet._",
    });
    await store.ensureMigrated();
    expect(files.has(LEGACY)).toBe(true);
    expect(await store.list()).toEqual([]);
  });
});

describe("legacy section splitting", () => {
  it("handles a file with no headers", () => {
    expect(splitLegacySections("just notes")).toEqual([{ title: "General", body: "just notes" }]);
  });

  it("drops empty sections", () => {
    expect(splitLegacySections("## A\n\n## B\nbody")).toEqual([{ title: "B", body: "body" }]);
  });
});

describe("log helpers", () => {
  it("round-trips groups and prunes to the newest entries", () => {
    const groups = [
      { date: "2026-09-05", lines: ["* one", "* two"] },
      { date: "2026-09-04", lines: ["* three"] },
    ];
    const text = serializeLogGroups(groups);
    expect(parseLogGroups(text)).toEqual(groups);

    expect(pruneLogGroups(groups, 2)).toEqual([{ date: "2026-09-05", lines: ["* one", "* two"] }]);
    expect(pruneLogGroups(groups, 1)).toEqual([{ date: "2026-09-05", lines: ["* one"] }]);
  });

  it("caps the on-disk log", async () => {
    const { store, files } = makeStore();
    for (let i = 0; i < MEMORY_LOG_MAX_ENTRIES + 5; i++) {
      await store.write("x.md", { type: "Reference", title: `X${i}` }, "b");
    }
    const lines = parseLogGroups(files.get(`${DIR}/log.md`)?.content ?? "").flatMap((g) => g.lines);
    expect(lines).toHaveLength(MEMORY_LOG_MAX_ENTRIES);
    expect(lines[0]).toContain(`X${MEMORY_LOG_MAX_ENTRIES + 4}`);
  });
});
