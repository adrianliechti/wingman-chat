import { describe, expect, it } from "vitest";
import type { File } from "../types/file";
import { countSchemaUnions } from "./toolSchemas";
import { createFileTools, createReadonlyFileTools, type FileToolsOptions, type WritableFileSource } from "./file-tools";

function memorySource(initial: Record<string, string> = {}): {
  files: Map<string, File>;
  source: WritableFileSource;
} {
  const files = new Map<string, File>(Object.entries(initial).map(([path, content]) => [path, { path, content }]));
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
      async writeBatch(updates) {
        const next = new Map(files);
        for (const file of updates) next.set(file.path, { ...file });
        files.clear();
        for (const [path, file] of next) files.set(path, file);
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

function artifactTools(
  source: WritableFileSource,
  options: Partial<Omit<FileToolsOptions, "namespace" | "spaceName">> = {},
) {
  return createFileTools(source, {
    namespace: "artifacts",
    spaceName: "artifact workspace",
    ...options,
  });
}

describe("artifact file tools", () => {
  it.each(["artifacts", "repository"])("%s glob and grep share nested wildcard brace matching", async (namespace) => {
    const { source } = memorySource({
      "/policy/returns.md": "needle",
      "/src/app.ts": "needle",
      "/src/deep/lib.tsx": "needle",
      "/other.txt": "needle",
    });
    const tools = createReadonlyFileTools(source, { namespace });
    const pattern = "{policy/returns.md,src/**/*.{ts,tsx}}";
    const results = [
      await tools.find((tool) => tool.name === `${namespace}_glob`)!.function({ pattern }),
      await tools.find((tool) => tool.name === `${namespace}_grep`)!.function({ pattern: "needle", glob: pattern }),
    ];
    for (const result of results) {
      const output = JSON.stringify(result);
      expect(output).toContain("/policy/returns.md");
      expect(output).toContain("/src/app.ts");
      expect(output).toContain("/src/deep/lib.tsx");
      expect(output).not.toContain("/other.txt");
    }
    const all = await tools
      .find((tool) => tool.name === `${namespace}_glob`)!
      .function({ pattern: "{policy/returns.md,**/*}" });
    expect(JSON.stringify(all)).toContain("# 4 files");
  });

  it("matches zero or more directory levels in glob and grep filters", async () => {
    const { source } = memorySource({ "/src/app.ts": "needle", "/src/deep/lib.ts": "needle", "/other.ts": "needle" });
    const tools = artifactTools(source);
    const glob = await tools.find((tool) => tool.name === "artifacts_glob")!.function({ pattern: "src/**/*.ts" });
    const grep = await tools
      .find((tool) => tool.name === "artifacts_grep")!
      .function({ pattern: "needle", glob: "src/**/*.ts" });
    for (const output of [glob, grep]) {
      const text = JSON.stringify(output);
      expect(text).toContain("/src/app.ts");
      expect(text).toContain("/src/deep/lib.ts");
      expect(text).not.toContain("/other.ts");
    }
  });
  it("keeps schemas union-free, closed, and schema-guided for provider portability", () => {
    const { source } = memorySource();
    const tools = artifactTools(source);
    const create = tools.find((tool) => tool.name === "artifacts_create");
    const edit = tools.find((tool) => tool.name === "artifacts_edit");
    const grep = tools.find((tool) => tool.name === "artifacts_grep");
    const glob = tools.find((tool) => tool.name === "artifacts_glob");
    const requiredByTool: Record<string, string[]> = {
      artifacts_read: ["file_path"],
      artifacts_create: ["file_path", "content"],
      artifacts_edit: ["edits"],
      artifacts_delete: ["file_path"],
      artifacts_move: ["from", "to"],
      artifacts_grep: ["pattern"],
      artifacts_glob: ["pattern"],
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
    expect(edits?.minItems).toBe(1);
    expect(Object.keys(edit?.parameters.properties as Record<string, unknown>)).toEqual(["edits"]);
    const item = edits?.items as Record<string, unknown>;
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual(["file_path", "old_string", "new_string"]);
    expect(Object.keys(grep?.parameters.properties as Record<string, unknown>)).toEqual([
      "pattern",
      "path",
      "glob",
      "type",
      "output_mode",
      "-B",
      "-A",
      "-C",
      "-n",
      "-i",
      "head_limit",
      "skip",
      "multiline",
    ]);
    expect(Object.keys(glob?.parameters.properties as Record<string, unknown>)).toEqual(["pattern", "path"]);
  });

  it("writes normal string content unchanged", async () => {
    const { files, source } = memorySource();
    const create = artifactTools(source).find((tool) => tool.name === "artifacts_create");
    const html = `<!doctype html><div class="card">Hello</div>`;

    expect(create).toBeDefined();
    await create?.function({ file_path: "/index.html", content: html });

    expect(files.get("/index.html")?.content).toBe(html);
  });

  it.each(["create", "edit"])(
    "%s guidance permits known content without treating a save as verification",
    (operation) => {
      const { source } = memorySource();
      const tool = artifactTools(source).find((tool) => tool.name === `artifacts_${operation}`)!;

      expect(tool.description).toContain("earlier reads or successful writes");
      expect(tool.description).toContain("a successful save can still need corrections");
      expect(tool.description).not.toContain("The result is authoritative");
    },
  );

  it.each(["create", "edit"])(
    "reports %s validation errors after saving and accepts a correction using known text",
    async (operation) => {
      const { files, source } = memorySource({ "/config.json": '{"days":30}' });
      const tools = artifactTools(source, {
        validators: [
          {
            id: "json",
            matches: (file) => file.path.endsWith(".json"),
            validate: (file) => {
              JSON.parse(file.content);
              return { errors: [], warnings: [] };
            },
          },
        ],
      });
      const tool = tools.find((tool) => tool.name === `artifacts_${operation}`)!;
      const invalid = '{"days":}';
      const result = await tool.function(
        operation === "create"
          ? { file_path: "/config.json", content: invalid }
          : { edits: [{ file_path: "/config.json", old_string: "30", new_string: "" }] },
      );
      const saved = result[0];
      if (saved.type !== "text") throw new Error("Expected a text result");
      const details = JSON.parse(saved.text);
      expect(details.success).toBe(true);
      expect(details.validation.errors).toHaveLength(1);
      expect(details.validation.errors[0]).toContain("[json]");
      expect(files.get("/config.json")?.content).toBe(invalid);

      // The failed validation did not roll back the save. Correct the known text
      // without another model-facing read, as the prompts instruct.
      const fixed = await tools
        .find((tool) => tool.name === "artifacts_edit")!
        .function({
          edits: [{ file_path: "/config.json", old_string: invalid, new_string: '{"days":45}' }],
        });
      const corrected = fixed[0];
      if (corrected.type !== "text") throw new Error("Expected a text result");
      expect(JSON.parse(corrected.text)).toMatchObject({ success: true });
      expect(JSON.parse(corrected.text)).not.toHaveProperty("validation");
      expect(files.get("/config.json")?.content).toBe('{"days":45}');
    },
  );

  it("rejects malformed content instead of guessing provider-specific aliases", async () => {
    const { files, source } = memorySource();
    const create = artifactTools(source).find((tool) => tool.name === "artifacts_create");

    expect(create).toBeDefined();
    const result = await create?.function({ file_path: "/bad.html", content: { unexpected: true } });

    expect(files.has("/bad.html")).toBe(false);
    const first = result?.[0];
    if (!first || first.type !== "text") throw new Error("Expected a text result");
    const parsed = JSON.parse(first.text) as { error: string };
    expect(parsed.error).toContain("content is required and must be a string");
  });

  it("requires the one canonical file_path/content shape", async () => {
    const { files, source } = memorySource();
    const create = artifactTools(source).find((tool) => tool.name === "artifacts_create");

    const badPath = await create?.function({ path: "/aliased.py", content: "print('hi')" });
    const badContent = await create?.function({ file_path: "/named.py", text: "print('ho')" });

    expect(files.size).toBe(0);
    expect(badPath?.[0]?.type === "text" && JSON.parse(badPath[0].text).error).toContain("file_path is required");
    expect(badContent?.[0]?.type === "text" && JSON.parse(badContent[0].text).error).toContain("content is required");
  });

  it("applies quote-heavy HTML edits", async () => {
    const { files, source } = memorySource({
      "/index.html": `<h1 class="old">Hi</h1>`,
    });
    const edit = artifactTools(source).find((tool) => tool.name === "artifacts_edit");

    expect(edit).toBeDefined();
    await edit?.function({
      edits: [
        {
          file_path: "/index.html",
          old_string: `<h1 class="old">Hi</h1>`,
          new_string: `<h1 class="new">Hello</h1>`,
          replace_all: false,
        },
      ],
    });

    expect(files.get("/index.html")?.content).toBe(`<h1 class="new">Hello</h1>`);
  });

  it("preserves untouched content when an HTML edit needs fuzzy punctuation matching", async () => {
    const original = `<aside title="Curly “quote”">Keep me</aside>   \n<p>Target — value</p>\n`;
    const { files, source } = memorySource({ "/index.html": original });
    const edit = artifactTools(source).find((tool) => tool.name === "artifacts_edit");

    await edit?.function({
      edits: [
        {
          file_path: "/index.html",
          old_string: "<p>Target - value</p>",
          new_string: "<p>Changed</p>",
          replace_all: false,
        },
      ],
    });

    expect(files.get("/index.html")?.content).toBe(`<aside title="Curly “quote”">Keep me</aside>   \n<p>Changed</p>\n`);
  });

  it("keeps exact edits exact when another edit in the batch needs fuzzy matching", async () => {
    const { files, source } = memorySource({
      "/index.html": `<p>"same"</p>\n<p>“same”</p>\n<p>Target — value</p>`,
    });
    const edit = artifactTools(source).find((tool) => tool.name === "artifacts_edit");

    await edit?.function({
      edits: [
        {
          file_path: "/index.html",
          old_string: "<p>“same”</p>",
          new_string: "<p>curly</p>",
          replace_all: false,
        },
        {
          file_path: "/index.html",
          old_string: "<p>Target - value</p>",
          new_string: "<p>changed</p>",
          replace_all: false,
        },
      ],
    });

    expect(files.get("/index.html")?.content).toBe(`<p>"same"</p>\n<p>curly</p>\n<p>changed</p>`);
  });

  it("applies the canonical schema sequentially across files and can create files", async () => {
    const { files, source } = memorySource({
      "/first.txt": "one two\n",
      "/second.txt": "red blue\n",
    });
    const edit = artifactTools(source).find((tool) => tool.name === "artifacts_edit");
    let meta: Record<string, unknown> | undefined;

    const result = await edit?.function(
      {
        edits: [
          { file_path: "/first.txt", old_string: "one", new_string: "ONE" },
          { file_path: "/first.txt", old_string: "ONE two", new_string: "done" },
          { file_path: "/second.txt", old_string: "blue", new_string: "green" },
          { file_path: "/created.txt", old_string: "", new_string: "created\n" },
        ],
      },
      { setMeta: (value) => (meta = value) },
    );

    expect(files.get("/first.txt")?.content).toBe("done\n");
    expect(files.get("/second.txt")?.content).toBe("red green\n");
    expect(files.get("/created.txt")?.content).toBe("created\n");
    expect(meta).toMatchObject({
      artifactDelta: {
        mutations: [
          { operation: "update", path: "/first.txt" },
          { operation: "update", path: "/second.txt" },
          { operation: "create", path: "/created.txt" },
        ],
      },
    });
    const first = result?.[0];
    if (!first || first.type !== "text") throw new Error("Expected a text result");
    expect(JSON.parse(first.text)).toMatchObject({
      success: true,
      paths: ["/first.txt", "/second.txt", "/created.txt"],
    });
  });

  it("stages the whole edit batch before writing any target", async () => {
    const { files, source } = memorySource({ "/existing.txt": "keep me\n" });
    const edit = artifactTools(source).find((tool) => tool.name === "artifacts_edit");

    const result = await edit?.function({
      edits: [
        { file_path: "/created.txt", old_string: "", new_string: "must not persist\n" },
        { file_path: "/existing.txt", old_string: "missing", new_string: "replacement" },
      ],
    });

    expect(files.has("/created.txt")).toBe(false);
    expect(files.get("/existing.txt")?.content).toBe("keep me\n");
    const first = result?.[0];
    if (!first || first.type !== "text") throw new Error("Expected a text result");
    expect(JSON.parse(first.text).error).toContain("no files changed");
  });

  it("preserves a UTF-8 BOM and CRLF line endings while editing", async () => {
    const { files, source } = memorySource({ "/windows.txt": "\uFEFFfirst\r\nsecond\r\n" });
    const edit = artifactTools(source).find((tool) => tool.name === "artifacts_edit");

    const result = await edit?.function({
      edits: [
        {
          file_path: "/windows.txt",
          old_string: "first\nsecond",
          new_string: "first\nchanged",
        },
      ],
    });

    expect(files.get("/windows.txt")?.content).toBe("\uFEFFfirst\r\nchanged\r\n");
    const first = result?.[0];
    if (!first || first.type !== "text") throw new Error("Expected a text result");
    expect(JSON.parse(first.text).text_formats).toEqual({
      "/windows.txt": { utf8_bom: true, line_endings: "CRLF" },
    });
  });

  it("reports actual saved formats per file, including mixed-newline normalization", async () => {
    const { files, source } = memorySource({
      "/lf.txt": "old\nlast\n",
      "/cr.txt": "old\rlast\r",
      "/mixed.txt": "\uFEFFold\r\nlast\n",
    });
    const result = await artifactTools(source)
      .find((tool) => tool.name === "artifacts_edit")!
      .function({
        edits: [
          ...["/lf.txt", "/cr.txt", "/mixed.txt"].map((file_path) => ({
            file_path,
            old_string: "old",
            new_string: "new",
          })),
          { file_path: "/new.txt", old_string: "", new_string: "created" },
        ],
      });
    const first = result[0];
    if (first.type !== "text") throw new Error("Expected a text result");
    expect(JSON.parse(first.text).text_formats).toEqual({
      "/lf.txt": { utf8_bom: false, line_endings: "LF" },
      "/cr.txt": { utf8_bom: false, line_endings: "CR" },
      "/mixed.txt": { utf8_bom: true, line_endings: "CRLF" },
      "/new.txt": { utf8_bom: false, line_endings: "none" },
    });
    expect(files.get("/mixed.txt")?.content).toBe("\uFEFFnew\r\nlast\r\n");
  });

  it("reports create and overwrite formats without implying preservation", async () => {
    const { source } = memorySource();
    const create = artifactTools(source).find((tool) => tool.name === "artifacts_create")!;
    for (const [content, format] of [
      ["\uFEFFfirst\r\n", { utf8_bom: true, line_endings: "CRLF" }],
      ["replacement\n", { utf8_bom: false, line_endings: "LF" }],
      ["", { utf8_bom: false, line_endings: "none" }],
      ["data:image/png;base64,aGVsbG8=", undefined],
    ] as const) {
      const result = await create.function({ file_path: "/file.txt", content });
      const first = result[0];
      if (first.type !== "text") throw new Error("Expected a text result");
      expect(JSON.parse(first.text).text_format).toEqual(format);
    }
  });

  it.each([
    ["\uFEFFfirst\r\nlast\r\n", "yes", "CRLF"],
    ["first\nlast\n", "no", "LF"],
    ["first\rlast\r", "no", "CR"],
    ["first\nlast\r\n", "no", "mixed"],
    ["first", "no", "none"],
    ["\uFEFF", "yes", "none"],
    ["", "no", "none"],
  ])("read headers expose whole-text format even for empty or partial reads: %j", async (content, bom, endings) => {
    const { source } = memorySource({ "/file.txt": content });
    const read = artifactTools(source).find((tool) => tool.name === "artifacts_read")!;
    const result = await read.function({ file_path: "/file.txt", limit: 1 });
    const first = result[0];
    if (first.type !== "text") throw new Error("Expected a text result");
    expect(first.text).toContain(`[UTF-8 BOM: ${bom}; line endings: ${endings}]`);
    expect(first.text).not.toContain("\uFEFF");
    expect(first.text).not.toContain("\r");
  });

  it("does not describe binary data URLs as text format", async () => {
    const { source } = memorySource({ "/image.png": "data:image/png;base64,aGVsbG8=" });
    const result = await artifactTools(source)
      .find((tool) => tool.name === "artifacts_read")!
      .function({ file_path: "/image.png" });
    expect(JSON.stringify(result)).toContain("binary");
    expect(JSON.stringify(result)).not.toContain("UTF-8 BOM");
  });

  it("preserves curly quote style when fuzzy quote folding is required", async () => {
    const { files, source } = memorySource({ "/quotes.txt": "Title: “Hello”\nOwner: ‘Ada’\n" });
    const edit = artifactTools(source).find((tool) => tool.name === "artifacts_edit");

    await edit?.function({
      edits: [
        { file_path: "/quotes.txt", old_string: 'Title: "Hello"', new_string: 'Title: "World"' },
        { file_path: "/quotes.txt", old_string: "Owner: 'Ada'", new_string: "Owner: 'Grace'" },
      ],
    });

    expect(files.get("/quotes.txt")?.content).toBe("Title: “World”\nOwner: ‘Grace’\n");
  });

  it("refuses to edit an oversized existing file before committing the batch", async () => {
    const { files, source } = memorySource({ "/large.txt": "too large" });
    const edit = artifactTools(source, { maxEditBytes: 4 }).find((tool) => tool.name === "artifacts_edit");

    const result = await edit?.function({
      edits: [{ file_path: "/large.txt", old_string: "too", new_string: "not" }],
    });

    expect(files.get("/large.txt")?.content).toBe("too large");
    const first = result?.[0];
    if (!first || first.type !== "text") throw new Error("Expected a text result");
    expect(JSON.parse(first.text).error).toContain("4-byte edit limit");
  });

  it("strips a UTF-8 BOM from read output without changing stored content", async () => {
    const { files, source } = memorySource({ "/bom.txt": "\uFEFFhello\n" });
    const read = artifactTools(source).find((tool) => tool.name === "artifacts_read");

    const result = await read?.function({ file_path: "/bom.txt" });

    const first = result?.[0];
    if (!first || first.type !== "text") throw new Error("Expected a text result");
    expect(first.text).toContain("1: hello");
    expect(first.text).not.toContain("\uFEFF");
    expect(files.get("/bom.txt")?.content).toBe("\uFEFFhello\n");
  });

  it("scopes, sorts, and bounds glob results", async () => {
    const { source } = memorySource({
      "/logs/old.txt": "old",
      "/logs/new.txt": "new",
      "/logs/middle.txt": "middle",
      "/other/ignored.txt": "ignored",
    });
    source.list = async () => [
      { path: "/logs/old.txt", lastModified: 1 },
      { path: "/logs/new.txt", lastModified: 3 },
      { path: "/logs/middle.txt", lastModified: 2 },
      { path: "/other/ignored.txt", lastModified: 4 },
    ];
    const glob = artifactTools(source, { maxPathResults: 2 }).find((tool) => tool.name === "artifacts_glob");

    const result = await glob?.function({ pattern: "*.txt", path: "/logs" });

    const first = result?.[0];
    if (!first || first.type !== "text") throw new Error("Expected a text result");
    expect(first.text.indexOf("/logs/new.txt")).toBeLessThan(first.text.indexOf("/logs/middle.txt"));
    expect(first.text).not.toContain("old.txt");
    expect(first.text).not.toContain("ignored.txt");
    expect(first.text).toContain("Results truncated at 2");
  });

  it('uses glob("**/*") to list top-level and nested files', async () => {
    const { source } = memorySource({
      "/README.md": "readme",
      "/src/app.ts": "app",
    });
    const glob = artifactTools(source).find((tool) => tool.name === "artifacts_glob");

    const result = await glob?.function({ pattern: "**/*" });

    const first = result?.[0];
    if (!first || first.type !== "text") throw new Error("Expected a text result");
    expect(first.text).toContain("/README.md");
    expect(first.text).toContain("/src/app.ts");
  });

  it("supports Wingman-style grep filters, modes, context, and pagination", async () => {
    const { source } = memorySource({
      "/src/app.ts": "before\nNeedle one\nafter\nneedle two\n",
      "/src/app.js": "Needle js\n",
      "/other.ts": "Needle other\n",
    });
    const grep = artifactTools(source).find((tool) => tool.name === "artifacts_grep");

    const defaults = await grep?.function({ pattern: "Needle", path: "/src", type: "ts" });
    const defaultText = defaults?.[0];
    if (!defaultText || defaultText.type !== "text") throw new Error("Expected a text result");
    expect(defaultText.text).toBe("/src/app.ts");

    const content = await grep?.function({
      pattern: "needle",
      path: "/src",
      glob: "*.ts",
      output_mode: "content",
      "-i": true,
      "-C": 1,
      head_limit: 1,
      skip: 1,
    });
    const contentText = content?.[0];
    if (!contentText || contentText.type !== "text") throw new Error("Expected a text result");
    expect(contentText.text).toContain("/src/app.ts:4:needle two");
    expect(contentText.text).toContain("/src/app.ts:3-after");
    expect(contentText.text).not.toContain("Needle one");

    const count = await grep?.function({
      pattern: "Needle[\\s\\S]*after",
      path: "/src/app.ts",
      multiline: true,
      output_mode: "count",
    });
    const countText = count?.[0];
    if (!countText || countText.type !== "text") throw new Error("Expected a text result");
    expect(countText.text).toBe("/src/app.ts:1");
  });

  it("reports invalid grep regexes instead of silently treating them as literals", async () => {
    const { source } = memorySource({ "/a.txt": "[" });
    const grep = artifactTools(source).find((tool) => tool.name === "artifacts_grep");

    const result = await grep?.function({ pattern: "[" });

    const first = result?.[0];
    if (!first || first.type !== "text") throw new Error("Expected a text result");
    expect(JSON.parse(first.text).error).toContain("invalid regex pattern");
  });

  it("lets multiline dot cross lines without changing anchor semantics", async () => {
    const { source } = memorySource({ "/a.txt": "before\nNeedle\nafter\n" });
    const grep = artifactTools(source).find((tool) => tool.name === "artifacts_grep");

    const result = await grep?.function({ pattern: "^Needle$", multiline: true });

    const first = result?.[0];
    if (!first || first.type !== "text") throw new Error("Expected a text result");
    expect(first.text).toBe("No matches found");
  });

  it("continues read pagination from the last line actually returned", async () => {
    const { source } = memorySource({
      "/long.txt": ["1111111111", "2222222222", "3333333333"].join("\n"),
    });
    const read = artifactTools(source, { maxReadLines: 3, maxReadChars: 12 }).find(
      (tool) => tool.name === "artifacts_read",
    );

    const first = await read?.function({ file_path: "/long.txt" });
    const firstResult = first?.[0];
    expect(firstResult?.type).toBe("text");
    if (!firstResult || firstResult.type !== "text") throw new Error("Expected a text result");
    expect(firstResult.text).toContain("lines 1-1 of 3");
    expect(firstResult.text).toContain("use offset=2 to continue");
    expect(firstResult.text).not.toContain("2222222222");

    const second = await read?.function({ file_path: "/long.txt", offset: 2 });
    const secondResult = second?.[0];
    expect(secondResult?.type).toBe("text");
    if (!secondResult || secondResult.type !== "text") throw new Error("Expected a text result");
    expect(secondResult.text).toContain("2: 2222222222");
  });
});
