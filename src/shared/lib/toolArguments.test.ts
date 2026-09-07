import { describe, expect, it } from "vitest";
import { parseToolArguments, ToolArgumentsParseError, toolArgumentHints, tryParseToolArguments } from "./toolArguments";

const createFileParameters = {
  type: "object",
  properties: {
    path: { type: "string" },
    content: { type: "string" },
  },
  required: ["path", "content"],
  additionalProperties: false,
};

// Un-escape one escape character from a JSON body, walking escape pairs so the
// second half of an escaped backslash pair (`\\n`) is never touched.
function unescapeSeq(body: string, escChar: string, replacement: string): string {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && i + 1 < body.length) {
      out += body[i + 1] === escChar ? replacement : body[i] + body[i + 1];
      i++;
    } else {
      out += body[i];
    }
  }
  return out;
}

describe("tool argument recovery", () => {
  it("identifies create content instead of its path as the payload", () => {
    expect(toolArgumentHints(createFileParameters)).toEqual({
      payloadKey: "content",
      otherKeys: ["path"],
      declaredKeys: ["path", "content"],
    });
  });

  it("recovers unescaped multiline HTML without truncating embedded JSON keys", () => {
    const html = `<!doctype html>
<main class="card">Hello</main>
<script>const endpoint = {"method":"GET","path":"/api/items"};</script>`;
    const malformed = `{"path":"/index.html","content":"${html}"}`;

    expect(parseToolArguments(malformed, toolArgumentHints(createFileParameters))).toEqual({
      path: "/index.html",
      content: html,
    });
  });

  it("recovers interpreter code and trailing nullable/array arguments", () => {
    const parameters = {
      type: "object",
      properties: {
        code: { type: ["string", "null"] },
        path: { type: ["string", "null"] },
        packages: { type: ["array", "null"] },
      },
    };
    const malformed = `{"code":"print("hello")","path":null,"packages":["pandas"]}`;

    expect(parseToolArguments(malformed, toolArgumentHints(parameters))).toEqual({
      code: `print("hello")`,
      path: null,
      packages: ["pandas"],
    });
  });

  it("removes leaked Bedrock AntML boundaries and recovers an embedded array parameter", () => {
    const parameters = {
      type: "object",
      properties: {
        path: { type: "string" },
        skills: { type: "array", items: { type: "string" } },
        code: { type: "string" },
      },
    };
    const leaked = JSON.stringify({
      code: 'print("hello")',
      path: '</antml_parameter>\n<parameter name="skills">[]',
    });

    expect(parseToolArguments(leaked, toolArgumentHints(parameters))).toEqual({
      code: 'print("hello")',
      path: "",
      skills: [],
    });
  });

  it("cleans a leaked duplicate parameter without overwriting the clean original", () => {
    const parameters = {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
      },
    };
    const leaked = JSON.stringify({
      from: "/assets/note.txt",
      to: '</antml_parameter>\n<parameter name="from">/assets/note.txt',
    });

    expect(parseToolArguments(leaked, toolArgumentHints(parameters))).toEqual({
      from: "/assets/note.txt",
      to: "",
    });
  });

  it("never treats provider-like markup inside the dominant payload as an argument boundary", () => {
    const parameters = {
      type: "object",
      properties: { path: { type: "string" }, code: { type: "string" } },
    };
    const args = {
      path: "",
      code: "print('<parameter name=\"skills\">[]</antml_parameter>')",
    };

    expect(parseToolArguments(JSON.stringify(args), toolArgumentHints(parameters))).toEqual(args);
  });

  it.each([
    {
      name: "double-quoted JSON",
      malformed: `{"code":"print("hello")","path":null,"packages":["pandas"]}`,
      expectedCode: `print("hello")`,
    },
    {
      name: "single-quoted object notation",
      malformed: `{'code':'print('hello')','path':null,'packages':['pandas']}`,
      expectedCode: `print('hello')`,
    },
    {
      name: "typographic structural quotes",
      malformed: `{“code”:“print("hello")”,“path”:null,“packages”:[“pandas”]}`,
      expectedCode: `print("hello")`,
    },
  ])("recovers $name without changing payload quotes", ({ malformed, expectedCode }) => {
    const parameters = {
      type: "object",
      properties: {
        code: { type: "string" },
        path: { type: ["string", "null"] },
        packages: { type: ["array", "null"] },
      },
    };

    expect(parseToolArguments(malformed, toolArgumentHints(parameters))).toEqual({
      code: expectedCode,
      path: null,
      packages: ["pandas"],
    });
  });

  it("keeps embedded sibling-shaped JSON when the outer optional field is omitted", () => {
    const parameters = {
      type: "object",
      properties: {
        code: { type: "string" },
        path: { type: ["string", "null"] },
      },
    };
    const code = `const request = {"method":"GET","path":"/api/items"};\nconsole.log(request);`;
    const malformed = `{"code":"${code}"}`;

    expect(parseToolArguments(malformed, toolArgumentHints(parameters))).toEqual({ code });
  });

  it("keeps a final source brace when the outer object brace is missing", () => {
    const parameters = {
      type: "object",
      properties: { code: { type: "string" }, path: { type: ["string", "null"] } },
    };
    const code = `function answer() { return { value: 42 }; }`;
    const malformed = `{"code":"${code}"`;

    expect(parseToolArguments(malformed, toolArgumentHints(parameters))).toEqual({ code });
  });

  it("derives payload hints from anyOf-style nullable schemas", () => {
    const parameters = {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
    };

    expect(toolArgumentHints(parameters)).toEqual({
      payloadKey: "content",
      otherKeys: ["path"],
      declaredKeys: ["path", "content"],
    });
  });

  it("recovers nested trailing arguments instead of reducing them to null", () => {
    const parameters = {
      type: "object",
      properties: {
        code: { type: "string" },
        options: { type: "object" },
        inputs: { type: "array" },
      },
    };
    const malformed =
      `{"code":"console.log("run")",` +
      `"options":{"timeout":30,"env":{"MODE":"test"}},` +
      `"inputs":[{"path":"/a.csv"},{"path":"/b.csv"}]}`;

    expect(parseToolArguments(malformed, toolArgumentHints(parameters))).toEqual({
      code: `console.log("run")`,
      options: { timeout: 30, env: { MODE: "test" } },
      inputs: [{ path: "/a.csv" }, { path: "/b.csv" }],
    });
  });

  it("preserves valid JSON arguments exactly across quote-heavy payloads", () => {
    const parameters = {
      type: "object",
      properties: { code: { type: "string" }, path: { type: ["string", "null"] } },
    };
    const expected = {
      code: `const a = 'single'; const b = "double"; const c = \`template ${"${value}"}\`;`,
      path: null,
    };

    expect(parseToolArguments(JSON.stringify(expected), toolArgumentHints(parameters))).toEqual(expected);
  });

  it("parses double-encoded arguments instead of yielding empty args", () => {
    const args = { path: "/script.py", content: 'import re\n\nprint(re.compile(r"\\d+"))\n' };

    expect(parseToolArguments(JSON.stringify(JSON.stringify(args)), toolArgumentHints(createFileParameters))).toEqual(
      args,
    );
  });

  it("recovers a double-encoded payload whose inner JSON is itself malformed", () => {
    const malformed = JSON.stringify(`{"path":"/script.py","content":"print("hello")"}`);

    expect(parseToolArguments(malformed, toolArgumentHints(createFileParameters))).toEqual({
      path: "/script.py",
      content: `print("hello")`,
    });
  });

  it("unwraps a one-element array around the arguments object", () => {
    const malformed = `[{"path":"/script.py","content":"print('hi')"}]`;

    expect(parseToolArguments(malformed, toolArgumentHints(createFileParameters))).toEqual({
      path: "/script.py",
      content: "print('hi')",
    });
  });

  it("unwraps an undeclared arguments-style wrapper key", () => {
    const wrapped = JSON.stringify({ arguments: { path: "/s.py", content: "print('hi')" } });

    expect(parseToolArguments(wrapped, toolArgumentHints(createFileParameters))).toEqual({
      path: "/s.py",
      content: "print('hi')",
    });
  });

  it("keeps a wrapper-like key that the tool schema actually declares", () => {
    const parameters = {
      type: "object",
      properties: { input: { type: "object" } },
    };
    const args = { input: { path: "/s.py", content: "x" } };

    expect(parseToolArguments(JSON.stringify(args), toolArgumentHints(parameters))).toEqual(args);
  });

  it("takes the last snapshot when full argument objects were concatenated", () => {
    const first = JSON.stringify({ path: "/script.py", content: "print('partial')" });
    const last = JSON.stringify({ path: "/script.py", content: "print('hi')\nprint('done')" });

    expect(parseToolArguments(first + last, toolArgumentHints(createFileParameters))).toEqual({
      path: "/script.py",
      content: "print('hi')\nprint('done')",
    });
  });

  it("does not leak a trailing comma into the recovered payload", () => {
    const malformed = `{"path":"/s.py","content":"print("hi")",}`;

    expect(parseToolArguments(malformed, toolArgumentHints(createFileParameters))).toEqual({
      path: "/s.py",
      content: `print("hi")`,
    });
  });

  it("keeps backslash sequences verbatim when quotes and newlines were never escaped", () => {
    const content = [
      "import re",
      'with open("C:\\data\\new.txt") as f:',
      '    m = re.findall("\\d+", f.read())',
      'print("count:", len(m))',
    ].join("\n");
    const malformed = `{"path":"/script.py","content":"${content}"}`;

    expect(parseToolArguments(malformed, toolArgumentHints(createFileParameters))).toEqual({
      path: "/script.py",
      content,
    });
  });

  it("keeps a single-line payload verbatim when raw quotes coexist with non-JSON escapes", () => {
    const content = `open("C:\\data\\new.txt")`;
    const malformed = `{"path":"/s.py","content":"${content}"}`;

    expect(parseToolArguments(malformed, toolArgumentHints(createFileParameters))).toEqual({
      path: "/s.py",
      content,
    });
  });

  it("keeps a raw Windows path when each segment resembles a JSON escape", () => {
    const content = 'open("C:\\new\\temp.txt")';
    const malformed = '{"path":"/s.py","content":"' + content + '"}';

    expect(parseToolArguments(malformed, toolArgumentHints(createFileParameters))).toEqual({
      path: "/s.py",
      content,
    });
  });

  it("keeps literal whitespace escapes when newlines are raw but quotes were escaped", () => {
    const malformed = [
      `{"path":"/script.py","content":"import csv`,
      `print(\\"a\\tb\\")`,
      `rows = text.split(\\"\\n\\")"}`,
    ].join("\n");

    expect(parseToolArguments(malformed, toolArgumentHints(createFileParameters))).toEqual({
      path: "/script.py",
      content: ["import csv", 'print("a\\tb")', 'rows = text.split("\\n")'].join("\n"),
    });
  });

  it("fully decodes a flattened file when quotes are raw but newlines and backslashes were escaped", () => {
    const content = `import re\npattern = re.compile(r"\\d{4}-\\d{2}-\\d{2}")\nprint(pattern.findall("born 2024-01-15"))\n`;
    // JSON-escape everything, then leave the quotes raw.
    const body = unescapeSeq(JSON.stringify(content).slice(1, -1), '"', '"');
    const malformed = `{"path":"/s.py","content":"${body}"}`;

    expect(parseToolArguments(malformed, toolArgumentHints(createFileParameters))).toEqual({
      path: "/s.py",
      content,
    });
  });

  it("keeps in-string whitespace literals when only line breaks were escaped", () => {
    // Model replaces real newlines with \n and escapes nothing else: the \n
    // inside the Python string literal is source text and must survive.
    const content = `EOL = "\\n"\nSEP = "\\t"\nprint("a" + SEP + "b" + EOL)\n`;
    const malformed = `{"path":"/s.py","content":"${content.replaceAll("\n", "\\n")}"}`;

    expect(parseToolArguments(malformed, toolArgumentHints(createFileParameters))).toEqual({
      path: "/s.py",
      content,
    });
  });

  it("keeps in-string regexes while decoding structural newline escapes around them", () => {
    const content = `import re\np = re.compile("\\d+")\nprint(p.findall("x1y2"))\n`;
    const malformed = `{"path":"/s.py","content":"${content.replaceAll("\n", "\\n")}"}`;

    expect(parseToolArguments(malformed, toolArgumentHints(createFileParameters))).toEqual({
      path: "/s.py",
      content,
    });
  });

  it("is not derailed by prose apostrophes before the first structural escape", () => {
    const content = `# don't panic\nx = "a"\ny = "b"\n`;
    const malformed = `{"path":"/s.py","content":"${content.replaceAll("\n", "\\n")}"}`;

    expect(parseToolArguments(malformed, toolArgumentHints(createFileParameters))).toEqual({
      path: "/s.py",
      content,
    });
  });

  it("decodes escaped backslashes outside string literals in a one-line payload", () => {
    const malformed = `{"path":"/run.cmd","content":"dir C:\\\\build\\\\out && echo "done""}`;

    expect(parseToolArguments(malformed, toolArgumentHints(createFileParameters))).toEqual({
      path: "/run.cmd",
      content: `dir C:\\build\\out && echo "done"`,
    });
  });

  it("decodes other JSON escapes when only the line break was malformed", () => {
    const args = {
      path: "/script.py",
      content: 'const pattern = "\\d+";\nprint("done")',
    };
    const malformed = JSON.stringify(args).replace("\\n", "\n");

    expect(parseToolArguments(malformed, toolArgumentHints(createFileParameters))).toEqual(args);
  });

  it("decodes fully escaped payloads with docstrings and unescaped inner quotes", () => {
    const malformed = `{"path":"/s.py","content":"def f():\\n    """Compute "x" fast."""\\n    return 1\\n"}`;

    expect(parseToolArguments(malformed, toolArgumentHints(createFileParameters))).toEqual({
      path: "/s.py",
      content: `def f():\n    """Compute "x" fast."""\n    return 1\n`,
    });
  });

  it("keeps invalid unicode escapes verbatim alongside raw quotes", () => {
    const content = `shutil.copy("C:\\users\\new", "D:\\backup")`;
    const malformed = `{"path":"/s.py","content":"${content}"}`;

    expect(parseToolArguments(malformed, toolArgumentHints(createFileParameters))).toEqual({
      path: "/s.py",
      content,
    });
  });

  it("decodes surrogate-pair unicode escapes in recovered payloads", () => {
    const malformed = `{"path":"/s.py","content":"print("\\ud83d\\ude00 caf\\u00e9")"}`;

    expect(parseToolArguments(malformed, toolArgumentHints(createFileParameters))).toEqual({
      path: "/s.py",
      content: `print("😀 café")`,
    });
  });

  it("parses triple-encoded arguments", () => {
    const args = { path: "/s.py", content: "print('hi')" };

    expect(
      parseToolArguments(JSON.stringify(JSON.stringify(JSON.stringify(args))), toolArgumentHints(createFileParameters)),
    ).toEqual(args);
  });

  it("unwraps a wrapper whose inner object only matches via an alias plus a declared key", () => {
    const wrapped = JSON.stringify({ arguments: { file_path: "/s.py", content: "print('hi')" } });

    expect(parseToolArguments(wrapped, toolArgumentHints(createFileParameters))).toEqual({
      file_path: "/s.py",
      content: "print('hi')",
    });
  });

  it("accepts whitespace between concatenated argument snapshots", () => {
    const first = JSON.stringify({ path: "/s.py", content: "A" });
    const last = JSON.stringify({ path: "/s.py", content: "AB" });

    expect(parseToolArguments(`${first}\n${last}`, toolArgumentHints(createFileParameters))).toEqual({
      path: "/s.py",
      content: "AB",
    });
  });

  it("throws on a valid array holding several argument objects instead of splicing them", () => {
    const multi = JSON.stringify([
      { path: "/a.py", content: "A" },
      { path: "/b.py", content: "B" },
    ]);

    expect(() => parseToolArguments(multi, toolArgumentHints(createFileParameters))).toThrow(ToolArgumentsParseError);
  });

  it("throws on valid non-object JSON instead of returning empty args", () => {
    expect(() => parseToolArguments("42", toolArgumentHints(createFileParameters))).toThrow(ToolArgumentsParseError);
    expect(() => parseToolArguments(`"just some prose"`, toolArgumentHints(createFileParameters))).toThrow(
      ToolArgumentsParseError,
    );
  });

  it("treats null and empty arguments as an empty object", () => {
    expect(parseToolArguments("null")).toEqual({});
    expect(parseToolArguments("")).toEqual({});
    expect(parseToolArguments(undefined)).toEqual({});
  });

  it("returns null from tryParseToolArguments instead of throwing", () => {
    expect(tryParseToolArguments("42", toolArgumentHints(createFileParameters))).toBeNull();
    expect(tryParseToolArguments("")).toEqual({});
  });

  describe("malformation-mode roundtrips", () => {
    // Realistic file contents, quote/backslash-heavy across languages.
    const corpus: Record<string, string> = {
      python: `import re\nimport pandas as pd\n\ndef main():\n    df = pd.read_csv("/data/input.csv")\n    print(f"rows: {len(df)}")\n\nif __name__ == "__main__":\n    main()\n`,
      docstring: `def parse(text):\n    """Parse "key=value" lines.\n\n    Returns a dict.\n    """\n    return dict(l.split("=") for l in text.splitlines())\n`,
      "python-escapes": `SEP = "\\t"\nEOL = "\\n"\nprint("a" + SEP + "b" + EOL)\n`,
      "js-template": "const name = 'world';\nconst greet = `hello ${name}`;\nconsole.log(greet, \"done\");\n",
      html: `<!doctype html>\n<div class="card" data-info='{"id":1}'>\n  <p>Hello &amp; welcome</p>\n</div>\n`,
      csv: `id,name,notes\n1,"Smith, J","said ""hi"""\n2,Doe,\n`,
      json: `{\n  "name": "demo",\n  "steps": ["a", "b"],\n  "nested": {"path": "/x"}\n}\n`,
      unicode: `greeting = "héllo wörld 😀"\nprint(greeting)\n`,
      "mixed-quotes": `msg = 'it\\'s "quoted"'\nprint(msg)\n`,
    };

    const modes: Record<string, (p: string, c: string) => string> = {
      "strict json": (p, c) => JSON.stringify({ path: p, content: c }),
      "double-encoded": (p, c) => JSON.stringify(JSON.stringify({ path: p, content: c })),
      "array-wrapped": (p, c) => `[${JSON.stringify({ path: p, content: c })}]`,
      "arguments-wrapper": (p, c) => JSON.stringify({ arguments: { path: p, content: c } }),
      "duplicated snapshot": (p, c) => JSON.stringify({ path: p, content: c }).repeat(2),
      "trailing comma": (p, c) => `${JSON.stringify({ path: p, content: c }).slice(0, -1)},}`,
      "content-first key order": (p, c) => JSON.stringify({ content: c, path: p }),
      "raw newlines, rest escaped": (p, c) =>
        `{"path":${JSON.stringify(p)},"content":"${unescapeSeq(JSON.stringify(c).slice(1, -1), "n", "\n")}"}`,
      "raw quotes, rest escaped": (p, c) =>
        `{"path":${JSON.stringify(p)},"content":"${unescapeSeq(JSON.stringify(c).slice(1, -1), '"', '"')}"}`,
      "only newlines escaped": (p, c) => `{"path":${JSON.stringify(p)},"content":"${c.replaceAll("\n", "\\n")}"}`,
      "fully verbatim": (p, c) => `{"path":${JSON.stringify(p)},"content":"${c}"}`,
    };

    // Documented ambiguity: with raw quotes and no backslash-escaping evidence,
    // `\n` inside a string literal is kept as source text (protecting
    // `EOL = "\n"` from becoming a syntax error). A docstring interior spanning
    // lines therefore degrades to literal `\n` — syntactically valid, visible,
    // and recoverable, rather than silently destructive.
    const docstringDegraded = corpus.docstring.replace(
      ` lines.\n\n    Returns a dict.\n    `,
      ` lines.\\n\\n    Returns a dict.\\n    `,
    );
    const expectedExceptions: Record<string, Record<string, string>> = {
      docstring: {
        "raw quotes, rest escaped": docstringDegraded,
        "only newlines escaped": docstringDegraded,
      },
    };

    for (const [contentName, content] of Object.entries(corpus)) {
      for (const [modeName, make] of Object.entries(modes)) {
        it(`reconstructs ${contentName} content from ${modeName} arguments`, () => {
          const expected = expectedExceptions[contentName]?.[modeName] ?? content;
          expect(parseToolArguments(make("/file.txt", content), toolArgumentHints(createFileParameters))).toEqual({
            path: "/file.txt",
            content: expected,
          });
        });
      }
    }
  });

  it("does not misidentify edit's path as its dominant text payload", () => {
    const parameters = {
      type: "object",
      properties: {
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              file_path: { type: "string" },
              old_string: { type: "string" },
              new_string: { type: "string" },
              replace_all: { type: ["boolean", "null"] },
            },
          },
        },
      },
    };
    const malformed =
      `{"edits":[{"file_path":"/index.html",` +
      `"old_string":"<h1 class="old">Hi</h1>","new_string":"<h1 class="new">Hello</h1>","replace_all":false}]}`;

    expect(toolArgumentHints(parameters)).toEqual({ declaredKeys: ["edits"] });
    expect(parseToolArguments(malformed, toolArgumentHints(parameters))).toEqual({
      edits: [
        {
          file_path: "/index.html",
          old_string: `<h1 class="old">Hi</h1>`,
          new_string: `<h1 class="new">Hello</h1>`,
          replace_all: false,
        },
      ],
    });
  });
});
