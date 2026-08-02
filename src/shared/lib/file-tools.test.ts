import { describe, expect, it } from "vitest";
import { countSchemaUnions } from "./toolSchemas";
import { createFileTools, type FileData, type WritableFileSource } from "./file-tools";

function memorySource(initial: Record<string, string> = {}): {
  files: Map<string, FileData>;
  source: WritableFileSource;
} {
  const files = new Map<string, FileData>(Object.entries(initial).map(([path, content]) => [path, { path, content }]));
  return {
    files,
    source: {
      async list() {
        return [...files.values()].map(({ path, content }) => ({ path, size: content.length }));
      },
      async read(path) {
        return files.get(path);
      },
      async write(path, content, contentType) {
        files.set(path, { path, content, contentType });
      },
      async remove(path) {
        return files.delete(path);
      },
      async move(from, to) {
        const file = files.get(from);
        if (!file) return false;
        files.delete(from);
        files.set(to, { ...file, path: to });
        return true;
      },
    },
  };
}

describe("artifact file tools", () => {
  it("keeps schemas union-free, closed, and schema-guided for provider portability", () => {
    const { source } = memorySource();
    const tools = createFileTools(source);
    const create = tools.find((tool) => tool.name === "create_file");
    const edit = tools.find((tool) => tool.name === "edit_file");
    const requiredByTool: Record<string, string[]> = {
      list_files: [],
      read_file: ["path"],
      create_file: ["path", "content"],
      edit_file: ["path", "edits"],
      delete_file: ["path"],
      move_file: ["from", "to"],
      grep: ["pattern"],
      glob: ["pattern"],
    };

    for (const tool of tools) {
      expect(tool.strict, tool.name).toBe(false);
      expect(tool.parameters.additionalProperties, tool.name).toBe(false);
      expect(countSchemaUnions(tool.parameters), `${tool.name} must not consume the provider union budget`).toBe(0);
      expect(tool.parameters.required, tool.name).toEqual(requiredByTool[tool.name]);
      expect(tool.parameters.properties, tool.name).not.toHaveProperty("baseRevision");
    }

    expect(create).toBeDefined();
    expect(edit).toBeDefined();

    const edits = (edit?.parameters.properties as Record<string, Record<string, unknown>> | undefined)?.edits;
    expect(edits).toBeDefined();
    const item = edits?.items as Record<string, unknown>;
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual(["find", "replace"]);
  });

  it("writes normal string content unchanged", async () => {
    const { files, source } = memorySource();
    const create = createFileTools(source).find((tool) => tool.name === "create_file");
    const html = `<!doctype html><div class="card">Hello</div>`;

    expect(create).toBeDefined();
    await create?.function({ path: "/index.html", content: html });

    expect(files.get("/index.html")?.content).toBe(html);
  });

  it("narrowly recovers line arrays and wrapped HTML from non-strict providers", async () => {
    const { files, source } = memorySource();
    const create = createFileTools(source).find((tool) => tool.name === "create_file");

    expect(create).toBeDefined();
    await create?.function({ path: "/lines.html", content: ["<main>", "  Hello", "</main>"] });
    await create?.function({ path: "/wrapped.html", content: { html: `<p class="note">Hello</p>` } });
    await create?.function({ path: "/aliased.html", html: `<strong>Hello</strong>` });

    expect(files.get("/lines.html")?.content).toBe("<main>\n  Hello\n</main>");
    expect(files.get("/wrapped.html")?.content).toBe(`<p class="note">Hello</p>`);
    expect(files.get("/aliased.html")?.content).toBe(`<strong>Hello</strong>`);
  });

  it("still rejects arbitrary object content", async () => {
    const { files, source } = memorySource();
    const create = createFileTools(source).find((tool) => tool.name === "create_file");

    expect(create).toBeDefined();
    const result = await create?.function({ path: "/bad.html", content: { unexpected: true } });

    expect(files.has("/bad.html")).toBe(false);
    const first = result?.[0];
    if (!first || first.type !== "text") throw new Error("Expected a text result");
    const parsed = JSON.parse(first.text) as { error: string };
    expect(parsed.error).toContain("content is required and must be a string");
    expect(parsed.error).toContain("path, content");
  });

  it("accepts common path aliases from non-strict providers", async () => {
    const { files, source } = memorySource();
    const create = createFileTools(source).find((tool) => tool.name === "create_file");

    await create?.function({ file_path: "/aliased.py", content: "print('hi')" });
    await create?.function({ filename: "/named.py", content: "print('ho')" });

    expect(files.get("/aliased.py")?.content).toBe("print('hi')");
    expect(files.get("/named.py")?.content).toBe("print('ho')");
  });

  it("accepts common content aliases from non-strict providers", async () => {
    const { files, source } = memorySource();
    const create = createFileTools(source).find((tool) => tool.name === "create_file");

    await create?.function({ path: "/contents.py", contents: "print('hi')" });
    await create?.function({ path: "/file-content.py", file_content: "print('ho')" });

    expect(files.get("/contents.py")?.content).toBe("print('hi')");
    expect(files.get("/file-content.py")?.content).toBe("print('ho')");
  });

  it("names the received keys when the path is missing entirely", async () => {
    const { files, source } = memorySource();
    const create = createFileTools(source).find((tool) => tool.name === "create_file");

    const result = await create?.function({ content: "print('hi')" });

    expect(files.size).toBe(0);
    const first = result?.[0];
    if (!first || first.type !== "text") throw new Error("Expected a text result");
    const parsed = JSON.parse(first.text) as { error: string };
    expect(parsed.error).toContain("path is required");
    expect(parsed.error).toContain("Received argument keys: content");
  });

  it("applies quote-heavy HTML edits", async () => {
    const { files, source } = memorySource({
      "/index.html": `<h1 class="old">Hi</h1>`,
    });
    const edit = createFileTools(source).find((tool) => tool.name === "edit_file");

    expect(edit).toBeDefined();
    await edit?.function({
      path: "/index.html",
      edits: [
        {
          find: `<h1 class="old">Hi</h1>`,
          replace: `<h1 class="new">Hello</h1>`,
          replace_all: false,
        },
      ],
    });

    expect(files.get("/index.html")?.content).toBe(`<h1 class="new">Hello</h1>`);
  });

  it("preserves untouched content when an HTML edit needs fuzzy punctuation matching", async () => {
    const original = `<aside title="Curly “quote”">Keep me</aside>   \n<p>Target — value</p>\n`;
    const { files, source } = memorySource({ "/index.html": original });
    const edit = createFileTools(source).find((tool) => tool.name === "edit_file");

    await edit?.function({
      path: "/index.html",
      edits: [{ find: "<p>Target - value</p>", replace: "<p>Changed</p>", replace_all: false }],
    });

    expect(files.get("/index.html")?.content).toBe(`<aside title="Curly “quote”">Keep me</aside>   \n<p>Changed</p>\n`);
  });

  it("keeps exact edits exact when another edit in the batch needs fuzzy matching", async () => {
    const { files, source } = memorySource({
      "/index.html": `<p>"same"</p>\n<p>“same”</p>\n<p>Target — value</p>`,
    });
    const edit = createFileTools(source).find((tool) => tool.name === "edit_file");

    await edit?.function({
      path: "/index.html",
      edits: [
        { find: "<p>“same”</p>", replace: "<p>curly</p>", replace_all: false },
        { find: "<p>Target - value</p>", replace: "<p>changed</p>", replace_all: false },
      ],
    });

    expect(files.get("/index.html")?.content).toBe(`<p>"same"</p>\n<p>curly</p>\n<p>changed</p>`);
  });

  it("continues read pagination from the last line actually returned", async () => {
    const { source } = memorySource({
      "/long.txt": ["1111111111", "2222222222", "3333333333"].join("\n"),
    });
    const read = createFileTools(source, { maxReadLines: 3, maxReadChars: 12 }).find(
      (tool) => tool.name === "read_file",
    );

    const first = await read?.function({ path: "/long.txt", startLine: null, endLine: null });
    const firstResult = first?.[0];
    expect(firstResult?.type).toBe("text");
    if (!firstResult || firstResult.type !== "text") throw new Error("Expected a text result");
    expect(firstResult.text).toContain("lines 1-1 of 3");
    expect(firstResult.text).toContain("Use startLine=2 to continue");
    expect(firstResult.text).not.toContain("2222222222");

    const second = await read?.function({ path: "/long.txt", startLine: 2, endLine: null });
    const secondResult = second?.[0];
    expect(secondResult?.type).toBe("text");
    if (!secondResult || secondResult.type !== "text") throw new Error("Expected a text result");
    expect(secondResult.text).toContain("2: 2222222222");
  });
});
