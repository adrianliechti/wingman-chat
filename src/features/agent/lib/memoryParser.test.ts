import { describe, expect, it } from "vitest";
import {
  deriveTitleFromPath,
  getMemoryPathError,
  isSafeMemoryPath,
  parseMemoryDoc,
  serializeMemoryDoc,
  slugifyMemoryPath,
} from "./memoryParser";

describe("parseMemoryDoc", () => {
  it("parses frontmatter and body", () => {
    const doc = parseMemoryDoc(
      [
        "---",
        "type: Project Context",
        "title: Wingman Repo",
        "description: Where things live",
        "tags: [repo, layout]",
        "timestamp: 2026-01-02T03:04:05.000Z",
        "owner: adrian",
        "---",
        "",
        "Body **here**.",
      ].join("\n"),
    );
    expect(doc).toEqual({
      frontmatter: {
        type: "Project Context",
        title: "Wingman Repo",
        description: "Where things live",
        resource: undefined,
        tags: ["repo", "layout"],
        timestamp: "2026-01-02T03:04:05.000Z",
        extra: { owner: "adrian" },
      },
      body: "Body **here**.",
    });
  });

  it("returns null without frontmatter or without the required type", () => {
    expect(parseMemoryDoc("just markdown")).toBeNull();
    expect(parseMemoryDoc("---\ntitle: No type\n---\nbody")).toBeNull();
  });

  it("falls back to the provided title when none is set", () => {
    const doc = parseMemoryDoc("---\ntype: Reference\n---\nbody", "Project Context");
    expect(doc?.frontmatter.title).toBe("Project Context");
    expect(parseMemoryDoc("---\ntype: Reference\n---\nbody")?.frontmatter.title).toBe("Untitled");
  });

  it("accepts quoted values and comma-separated tags", () => {
    const doc = parseMemoryDoc("---\ntype: \"Decision\"\ntitle: 'It''s done'\ntags: a, \"b\", 'c'\n---\nx");
    expect(doc?.frontmatter.type).toBe("Decision");
    expect(doc?.frontmatter.title).toBe("It's done");
    expect(doc?.frontmatter.tags).toEqual(["a", "b", "c"]);
  });

  it("tolerates a body containing --- separators", () => {
    const doc = parseMemoryDoc("---\ntype: Reference\n---\n\nabove\n\n---\n\nbelow");
    expect(doc?.body).toBe("above\n\n---\n\nbelow");
  });
});

describe("serializeMemoryDoc", () => {
  const base = { type: "Reference", title: "T", timestamp: "2026-01-01T00:00:00.000Z" };

  it("round-trips every field", () => {
    const doc = {
      frontmatter: {
        ...base,
        description: "Desc",
        resource: "https://example.com/x",
        tags: ["one", "two"],
        extra: { owner: "me" },
      },
      body: "Hello",
    };
    expect(parseMemoryDoc(serializeMemoryDoc(doc))).toEqual(doc);
  });

  it("keeps hostile values on one line and round-trips them", () => {
    const doc = {
      frontmatter: {
        ...base,
        title: "Line one\nLine two\n---\ntype: pwned",
        description: "- starts with dash: and colon # hash",
      },
      body: "safe",
    };
    const serialized = serializeMemoryDoc(doc);
    const parsed = parseMemoryDoc(serialized);
    expect(parsed?.frontmatter.type).toBe("Reference");
    expect(parsed?.frontmatter.title).toBe("Line one Line two --- type: pwned");
    expect(parsed?.frontmatter.description).toBe("- starts with dash: and colon # hash");
    expect(parsed?.body).toBe("safe");
  });

  it("sanitizes tags that would break the bracket list", () => {
    const serialized = serializeMemoryDoc({ frontmatter: { ...base, tags: ["a]b", "c,d", " e "] }, body: "" });
    expect(parseMemoryDoc(serialized)?.frontmatter.tags).toEqual(["a b", "c d", "e"]);
  });

  it("drops extra keys that collide with known fields or are not identifiers", () => {
    const serialized = serializeMemoryDoc({
      frontmatter: { ...base, extra: { type: "Injected", "bad key": "x", ok_key: "y" } },
      body: "",
    });
    const parsed = parseMemoryDoc(serialized);
    expect(parsed?.frontmatter.type).toBe("Reference");
    expect(parsed?.frontmatter.extra).toEqual({ ok_key: "y" });
  });

  it("quotes an empty description-like value only when present", () => {
    const serialized = serializeMemoryDoc({ frontmatter: { ...base, description: "" }, body: "b" });
    expect(serialized).not.toContain("description:");
  });
});

describe("path helpers", () => {
  it("derives titles from filenames", () => {
    expect(deriveTitleFromPath("project-context.md")).toBe("Project Context");
    expect(deriveTitleFromPath("nested/user_prefs.md")).toBe("User Prefs");
  });

  it("slugifies titles and avoids reserved names", () => {
    expect(slugifyMemoryPath("  Key Decisions!  ")).toBe("key-decisions");
    expect(slugifyMemoryPath("###")).toBe("memory");
    expect(slugifyMemoryPath("Index")).toBe("index-notes");
    expect(slugifyMemoryPath("log")).toBe("log-notes");
  });

  it("isSafeMemoryPath rejects traversal, separators, hidden and reserved files", () => {
    expect(isSafeMemoryPath("project-context.md")).toBe(true);
    expect(isSafeMemoryPath("Imported_Note.v2.md")).toBe(true);
    for (const bad of ["../x.md", "a/b.md", "..md", ".hidden.md", "index.md", "log.md", "note.txt", "", 42, null]) {
      expect(isSafeMemoryPath(bad), String(bad)).toBe(false);
    }
    expect(isSafeMemoryPath(`${"a".repeat(200)}.md`)).toBe(false);
  });

  it("getMemoryPathError enforces the strict model-facing slug rules", () => {
    expect(getMemoryPathError("project-context.md")).toBeNull();
    expect(getMemoryPathError("a1.md")).toBeNull();
    expect(getMemoryPathError(undefined)).toMatch(/required/);
    expect(getMemoryPathError("Project.md")).toMatch(/lowercase/);
    expect(getMemoryPathError("double--dash.md")).toMatch(/lowercase/);
    expect(getMemoryPathError("-leading.md")).toMatch(/lowercase/);
    expect(getMemoryPathError("../escape.md")).toMatch(/lowercase/);
    expect(getMemoryPathError("index.md")).toMatch(/generated file/);
    expect(getMemoryPathError(`${"a".repeat(200)}.md`)).toMatch(/at most/);
  });
});
