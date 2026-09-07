import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { after, before, describe, test } from "node:test";
import { promisify } from "node:util";
import { createArtifactWorkspace } from "./artifact-workspace.mjs";
import { contentParts, REQUEST_TIMEOUT_MS, resultDetail, startGatewayHarness } from "./gateway-harness.mjs";

const execFileAsync = promisify(execFile);
const PYTHON = process.env.WINGMAN_E2E_PYTHON ?? "python3";
const MODEL = process.env.WINGMAN_E2E_BEDROCK_MODEL ?? "bedrock-sonnet-4-6";
const MARKUP_LEAK = /<\/?antml_parameter\b|<parameter\s+name=/i;

const createFixtures = [
  {
    name: "HTML with nested JSON and mixed quotes",
    path: "/soak/card.html",
    content:
      '<!doctype html>\n<main class="card" data-owner=\'Ada\'>Hello &amp; welcome</main>\n<script>const state = {"ready":true,"items":[1,2]};</script>\n',
  },
  {
    name: "Python regexes and Windows paths",
    path: "/soak/regex.py",
    content: 'import re\npath = r"C:\\data\\new file.txt"\nprint(re.findall(r"\\d{2,4}", path))\n',
  },
  {
    name: "pretty JSON with Unicode",
    path: "/soak/unicode.json",
    content: '{\n  "greeting": "Grüezi 🪽",\n  "nested": {"quote": "\\\"hello\\\""}\n}\n',
  },
  {
    name: "CSV with commas and doubled quotes",
    path: "/soak/quoted.csv",
    content: 'id,name,notes\n1,"Smith, J","said ""hello"""\n2,Doe,"C:\\tmp\\file"\n',
  },
  {
    name: "Markdown fenced code",
    path: "/soak/readme.md",
    content: "# Fixture\n\n```python\nprint(\"hello 'world'\")\n```\n\nPath: `C:\\tmp\\wingman`\n",
  },
  {
    name: "XML-like text with attributes",
    path: "/soak/vector.txt",
    content: '<svg viewBox="0 0 10 10"><text data-json=\'{"x":1,"label":"A &amp; B"}\'>Grüezi</text></svg>\n',
  },
  {
    name: "JavaScript template and backticks",
    path: "/soak/template.js",
    content: "const value = 42;\nconst message = `result=${value}; path=C:\\\\tmp\\\\file`;\nconsole.log(message);\n",
  },
  {
    name: "YAML punctuation",
    path: "/soak/config.yaml",
    content: 'title: "Schema: soak"\npath: "C:\\\\tmp\\\\file"\nitems:\n  - name: \'quoted item\'\n',
  },
  {
    name: "SQL quoting",
    path: "/soak/query.sql",
    content: "SELECT id, name FROM users WHERE note = 'Ada''s file' AND path LIKE 'C:\\\\tmp\\\\%';\n",
  },
  {
    name: "provider-like markup inside file content",
    path: "/soak/provider-markup.txt",
    content: 'This is literal file content:\n<parameter name="skills">[]</antml_parameter>\n</antml_parameter>\n',
  },
];

const pythonFixtures = [
  {
    name: "quotes and Windows path",
    code: `quote = 'He said "hi"'\npath = r"C:\\tmp\\file"\nprint(f"QUOTE_OK|{quote}|{path}")`,
    output: 'QUOTE_OK|He said "hi"|C:\\tmp\\file',
  },
  {
    name: "raw regular expression",
    code: `import re\nprint("REGEX_OK|" + ",".join(re.findall(r"\\d+", "a12 b034")))`,
    output: "REGEX_OK|12,034",
  },
  {
    name: "nested Unicode JSON",
    code: `import json\nvalue = {"emoji": "🪽", "items": [{"id": 1}, {"id": 2}]}\nprint(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")))`,
    output: '{"emoji":"🪽","items":[{"id":1},{"id":2}]}',
  },
  {
    name: "quoted CSV parsing",
    code: `import csv, io\nrow = next(csv.reader(io.StringIO('"Smith, J","said ""hi"""')) )\nprint("CSV_OK|" + "|".join(row))`,
    output: 'CSV_OK|Smith, J|said "hi"',
  },
  {
    name: "triple-quoted multiline text",
    code: `text = """alpha "quoted"\nbeta \\ slash"""\nprint("DOC_OK|" + text.replace("\\n", "/"))`,
    output: 'DOC_OK|alpha "quoted"/beta \\ slash',
  },
  {
    name: "pathlib with backslashes",
    code: `from pathlib import PureWindowsPath\np = PureWindowsPath(r"C:\\Users\\Ada\\report.csv")\nprint("PATH_OK|" + p.name + "|" + p.parent.name)`,
    output: "PATH_OK|report.csv|Ada",
  },
  {
    name: "Unicode normalization",
    code: `import unicodedata\nvalue = unicodedata.normalize("NFC", "Gru\\u0308ezi")\nprint("UNICODE_OK|" + value + "|🪽")`,
    output: "UNICODE_OK|Grüezi|🪽",
  },
  {
    name: "base64 binary roundtrip",
    code: `import base64\ndata = bytes([0, 1, 2, 250, 255])\nprint("B64_OK|" + base64.b64encode(data).decode("ascii"))`,
    output: "B64_OK|AAEC+v8=",
  },
  {
    name: "deterministic date formatting",
    code: `from datetime import datetime, timezone\ndt = datetime(2026, 8, 2, 12, 34, 56, tzinfo=timezone.utc)\nprint("DATE_OK|" + dt.isoformat())`,
    output: "DATE_OK|2026-08-02T12:34:56+00:00",
  },
  {
    name: "comprehension and stable sorting",
    code: `values = {"beta": 2, "alpha": 1, "gamma": 3}\nprint("TABLE_OK|" + ",".join(f"{k}:{values[k] ** 2}" for k in sorted(values)))`,
    output: "TABLE_OK|alpha:1,beta:4,gamma:9",
  },
];

let harness;
let run;
let client;
let Role;
let workspace;
let createFile;
let pythonParameters;
const stats = {
  calls: 0,
  functionalPasses: 0,
  rawJsonFailures: 0,
  rawMarkupLeaks: 0,
  recoveredMarkupCalls: 0,
  markupLeaksByTool: {},
  markupLeakSamples: [],
};

function user(text) {
  return { role: Role.User, content: [{ type: "text", text }] };
}

function recordArguments(result, toolName, payloadKey) {
  const calls = contentParts(result.messages, "tool_call").filter((part) => part.name === toolName);
  assert.equal(calls.length, 1, `Expected exactly one ${toolName} call`);
  const raw = calls[0].arguments;
  stats.calls++;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    stats.rawJsonFailures++;
  }

  // Payloads are allowed to contain arbitrary text, including provider-like
  // markup. Count a leak only when markup lands in a structural argument such
  // as path, which is the provider failure we recover in production.
  const leakedFields =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.entries(parsed).filter(
          ([key, value]) => key !== payloadKey && typeof value === "string" && MARKUP_LEAK.test(value),
        )
      : [];
  const leakedMarkup = leakedFields.length > 0 || (!parsed && MARKUP_LEAK.test(raw));
  if (leakedMarkup) {
    stats.rawMarkupLeaks++;
    stats.markupLeaksByTool[toolName] = (stats.markupLeaksByTool[toolName] ?? 0) + 1;
    if (stats.markupLeakSamples.length < 2) {
      stats.markupLeakSamples.push({
        tool: toolName,
        fields: Object.fromEntries(leakedFields.map(([key, value]) => [key, value.slice(0, 180)])),
      });
    }
  }
  return { raw, leakedMarkup };
}

function exactBlock(kind, value) {
  return [
    `Copy the bytes between BEGIN_${kind} and END_${kind} exactly.`,
    "The marker lines are not part of the value; preserve all quotes, backslashes, Unicode, and line breaks.",
    `BEGIN_${kind}`,
    value,
    `END_${kind}`,
  ].join("\n");
}

void describe("Bedrock Sonnet 4.6 production-schema soak", { concurrency: false }, () => {
  before(
    async () => {
      harness = await startGatewayHarness();
      ({ run, client, Role } = harness);
      assert(
        harness.availableModels.some((model) => model.id === MODEL),
        `${MODEL} is not exposed by the configured gateway`,
      );
      const artifactModule = await harness.vite.ssrLoadModule("/src/shared/types/artifact.ts");
      const fileToolsModule = await harness.vite.ssrLoadModule("/src/shared/lib/file-tools.ts");
      const validatorsModule = await harness.vite.ssrLoadModule("/src/features/artifacts/lib/artifactValidators.ts");
      const executionSchemas = await harness.vite.ssrLoadModule("/src/features/artifacts/lib/executionToolSchemas.ts");
      workspace = await createArtifactWorkspace(artifactModule);
      createFile = fileToolsModule
        .createFileTools(workspace.source, { namespace: "artifacts", validators: validatorsModule.ARTIFACT_VALIDATORS })
        .find((tool) => tool.name === "artifacts_create");
      assert(createFile);
      assert.equal(createFile.strict, false);
      pythonParameters = executionSchemas.PYTHON_EXECUTION_PARAMETERS;
      await execFileAsync(PYTHON, ["--version"], { timeout: 10_000 });
    },
    { timeout: REQUEST_TIMEOUT_MS },
  );

  after(async () => {
    await workspace?.cleanup();
    await harness?.close();
  });

  for (const fixture of createFixtures) {
    void test(
      `create: ${fixture.name}`,
      async () => {
        const result = await run(
          client,
          MODEL,
          `This is a schema transport probe. Call artifacts_create exactly once and emit no prose. Use file_path ${JSON.stringify(fixture.path)}.\n${exactBlock("FILE_CONTENT", fixture.content)}`,
          [user("Create the exact fixture now.")],
          [createFile],
          { agentName: "bedrock-create-soak", maxTurns: 1 },
        );

        assert.equal(result.status, "max_turns", resultDetail(result));
        const observed = recordArguments(result, "artifacts_create", "content");
        assert.equal(
          (await workspace.read(fixture.path))?.content,
          fixture.content,
          `Raw tool arguments: ${observed.raw}`,
        );
        if (observed.leakedMarkup) stats.recoveredMarkupCalls++;
        stats.functionalPasses++;
      },
      { timeout: REQUEST_TIMEOUT_MS * 2 },
    );
  }

  for (const fixture of pythonFixtures) {
    void test(
      `execute_python_code: ${fixture.name}`,
      async () => {
        const parsedCalls = [];
        const pythonTool = {
          name: "execute_python_code",
          description: "Execute inline Python code. Omit path when using code.",
          strict: false,
          parameters: pythonParameters,
          function: async (args) => {
            parsedCalls.push(args);
            assert.equal(typeof args.code, "string");
            assert(args.path === undefined || args.path === "");
            const { stdout } = await execFileAsync(PYTHON, ["-I", "-c", args.code], {
              timeout: 15_000,
              maxBuffer: 1024 * 1024,
            });
            return [{ type: "text", text: stdout.trimEnd() }];
          },
        };
        const result = await run(
          client,
          MODEL,
          `This is a schema transport probe. Call execute_python_code exactly once and emit no prose. Omit path.\n${exactBlock("PYTHON_CODE", fixture.code)}`,
          [user("Execute the exact Python fixture now.")],
          [pythonTool],
          { agentName: "bedrock-python-soak", maxTurns: 1 },
        );

        assert.equal(result.status, "max_turns", resultDetail(result));
        const observed = recordArguments(result, "execute_python_code", "code");
        assert.equal(parsedCalls.length, 1);
        const toolResult = contentParts(result.messages, "tool_result").find(
          (part) => part.name === "execute_python_code",
        );
        const output = toolResult?.result?.find((part) => part.type === "text")?.text;
        assert.equal(output, fixture.output);
        if (observed.leakedMarkup) stats.recoveredMarkupCalls++;
        stats.functionalPasses++;
      },
      { timeout: REQUEST_TIMEOUT_MS * 2 },
    );
  }

  void test("reports raw provider quality separately from functional recovery", (context) => {
    assert.equal(stats.calls, createFixtures.length + pythonFixtures.length);
    context.diagnostic(
      `Bedrock schema soak: ${JSON.stringify({
        model: MODEL,
        createFileCases: createFixtures.length,
        pythonCases: pythonFixtures.length,
        functionalFailures: stats.calls - stats.functionalPasses,
        ...stats,
      })}`,
    );
  });
});
