import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

type ExecutionResult = {
  success: boolean;
  output: string;
  error?: string;
  files?: Record<string, { content: string; contentType?: string }>;
};

type ScriptArgs = { code?: string; path?: string; language?: "python" | "javascript" | "bash"; args?: string[] };

type TextToolResult = Array<{ type: "text"; text: string }>;

declare global {
  interface Window {
    interpreterMemoryWorkspace?: boolean;
    interpreterE2E: {
      executePython(request: unknown, options?: unknown): Promise<ExecutionResult>;
      executeJavaScript(request: unknown, options?: unknown): Promise<ExecutionResult>;
      executeBash(request: unknown, options?: unknown): Promise<ExecutionResult>;
      runScript(
        engine: "python" | "javascript" | "bash" | "auto",
        chatId: string,
        args: ScriptArgs,
        files?: Record<string, { content: string; contentType?: string }>,
        resources?: Record<string, string>,
        plugin?: string,
      ): Promise<ExecutionResult>;
      runScripts(
        chatId: string,
        requests: ScriptArgs[],
        files?: Record<string, { content: string; contentType?: string }>,
        resources?: Record<string, string>,
        plugin?: string,
      ): Promise<ExecutionResult[]>;
      executeWorkspace(
        engine: "python" | "javascript" | "bash" | "auto",
        chatId: string,
        code: string,
      ): Promise<ExecutionResult>;
      queryWorkspace(chatId: string, query: string): Promise<{ rows: Record<string, unknown>[] }>;
      initializeLlm(): Promise<void>;
      runToolFlow(chatId: string): Promise<{
        created: TextToolResult;
        edited: TextToolResult;
        read: TextToolResult;
        listed: TextToolResult;
        file?: { content: string };
      }>;
      runArtifactFlow(chatId: string): Promise<{
        execution: ExecutionResult;
        commit?: { createdPaths: string[]; updatedPaths: string[]; deletedPaths: string[] };
        output?: { content: string; contentType?: string };
      }>;
    };
  }
}

test.beforeEach(async ({ page, browserName }) => {
  await page.addInitScript((memory) => {
    window.interpreterMemoryWorkspace = memory;
  }, browserName === "webkit");
});

async function openFixture(page: Page): Promise<void> {
  await page.goto("/tests/browser/fixtures/interpreter.html");
  await page.waitForFunction(() => Boolean(window.interpreterE2E));
}

test("execute_script detects Bash skill files and commits outputs without persisting the mount", async ({ page }) => {
  await openFixture(page);
  const result = await page.evaluate(() =>
    window.interpreterE2E.runScript(
      "auto",
      "bash-plugin-script",
      {
        path: "/skills/acme:test-script/scripts/run.sh",
        args: ["output with spaces.txt", "$(touch injected); 'quoted' *"],
      },
      { "/obsolete.txt": { content: "delete" } },
      {
        "scripts/run.sh":
          '#!/bin/bash\nset -e\nsource "$(dirname "$0")/helper.sh"\nprintf "%s\\n%s\\n" "$label" "$2" > "$1"\nrm obsolete.txt\necho temporary > "$(dirname "$0")/helper.sh"\necho complete',
        "scripts/helper.sh": 'label="skill resource"',
      },
      "acme",
    ),
  );
  expect(result.success, result.error).toBe(true);
  expect(result.output).toBe("complete");
  expect(Object.keys(result.files ?? {})).toEqual(["/output with spaces.txt"]);
  expect(result.files?.["/output with spaces.txt"].content).toBe("skill resource\n$(touch injected); 'quoted' *\n");
});

test("execute_script detects shebangs, requires an inline language and shares files across all runtimes", async ({
  page,
}) => {
  await openFixture(page);
  const results = await page.evaluate(() =>
    window.interpreterE2E.runScripts(
      "three-script-runtimes",
      [
        { code: "echo ambiguous" },
        { path: "/scripts/generate" },
        { path: "/scripts/transform" },
        { path: "/scripts/finish" },
        {
          language: "bash",
          code: "cat result.txt; rm values.json intermediate.txt; echo discarded > result.txt; exit 9",
        },
        { language: "bash", code: "cat result.txt; rm values.json intermediate.txt" },
      ],
      {
        "/scripts/generate": {
          content: '#!/usr/bin/env python3\nfrom pathlib import Path\nPath("values.json").write_text("[1,2,3]")',
        },
        "/scripts/transform": {
          content:
            '#!/usr/bin/env node\nvfs.write("intermediate.txt", String(vfs.readJSON("values.json").reduce((a, b) => a + b, 0)));',
        },
        "/scripts/finish": { content: '#!/bin/sh\ncat intermediate.txt > result.txt; printf "\\n" >> result.txt' },
      },
    ),
  );
  expect(results[0].success).toBe(false);
  expect(results[0].error).toContain("Inline code requires language");
  for (const index of [1, 2, 3, 5]) expect(results[index].success, results[index].error).toBe(true);
  expect(results[4].success).toBe(false);
  expect(results[4].error).toContain("status 9");
  expect(results[4].files?.["/result.txt"].content).toBe("6\n");
  expect(results[4].files?.["/values.json"]).toBeDefined();
  expect(results[5].output).toBe("6");
  expect(results[5].files?.["/values.json"]).toBeUndefined();
  expect(results[5].files?.["/intermediate.txt"]).toBeUndefined();
});

test("Bash cancellation terminates the worker and the next run starts cleanly", async ({ page }) => {
  await openFixture(page);
  const result = await page.evaluate(async () => {
    const controller = new AbortController();
    const pending = window.interpreterE2E.executeBash(
      { code: "sleep 30; echo late > late.txt" },
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 250);
    return pending;
  });
  expect(result.success).toBe(false);
  expect(result.error).toMatch(/abort|cancel/i);
  const next = await page.evaluate(() =>
    window.interpreterE2E.executeBash({ code: "test ! -e late.txt && echo recovered" }),
  );
  expect(next.success, next.error).toBe(true);
  expect(next.output).toBe("recovered");
});

test("Bash writes text and binary files that Python reads, and reads Python outputs back", async ({ page }) => {
  await openFixture(page);
  const results = await page.evaluate(() =>
    window.interpreterE2E.runScripts("bash-python-shared-files", [
      {
        language: "bash",
        code: "printf 'name,value\\nalpha,21\\n' > input.csv; printf 'AP+AQg==' | base64 -d > input.bin",
      },
      {
        language: "python",
        code: `import csv, json
from pathlib import Path
row = next(csv.DictReader(Path("input.csv").open()))
Path("result.json").write_text(json.dumps({"name": row["name"], "value": int(row["value"]) * 2}))
assert Path("input.bin").read_bytes() == bytes([0, 255, 128, 66])
Path("result.bin").write_bytes(Path("input.bin").read_bytes()[::-1])
print(row["name"])`,
      },
      { language: "bash", code: "jq -r '.value' result.json; base64 result.bin" },
      {
        language: "javascript",
        code: 'return JSON.stringify({value: vfs.readJSON("result.json").value, bytes: Array.from(vfs.readBytes("result.bin"))});',
      },
    ]),
  );
  for (const result of results) expect(result.success, result.error).toBe(true);
  expect(results[1].output).toBe("alpha");
  expect(results[2].output).toBe("42\nQoD/AA==");
  expect(JSON.parse(results[3].output)).toEqual({ value: 42, bytes: [66, 128, 255, 0] });
});

test("Bash OCR/extract and llm commands bridge file bytes, Unicode pipes and the owning model", async ({ page }) => {
  const requests: Array<{ model: string; instructions: string; input: unknown[]; tools?: unknown[] }> = [];
  let extractions = 0;
  await page.route("**/config.json", (route) => route.fulfill({ json: { extractor: {} } }));
  await page.route("**/api/v1/extract", async (route) => {
    extractions++;
    const body = route.request().postDataBuffer()!;
    expect(body.toString()).toContain('filename="input.pdf"');
    expect(body.toString()).toContain("application/pdf");
    await route.fulfill({ contentType: "text/plain", body: "Grüezi 🪽\nextracted text" });
  });
  await page.route("**/api/v1/responses", async (route) => {
    requests.push(route.request().postDataJSON());
    const response = {
      id: `bash-response-${requests.length}`,
      object: "response",
      created_at: 0,
      model: "fixture",
      status: "completed",
      error: null,
      incomplete_details: null,
      output: [
        {
          id: "message",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "Résumé 🪽", annotations: [] }],
        },
      ],
    };
    await route.fulfill({
      contentType: "text/event-stream",
      body: [
        { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
        { type: "response.completed", response },
      ]
        .map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`)
        .join(""),
    });
  });
  await openFixture(page);
  const { result, uploads } = await page.evaluate(async () => {
    await window.interpreterE2E.initializeLlm();
    const uploads: number[][] = [];
    const originalFetch = window.fetch;
    // WebKit's network inspector omits multipart file bodies. Inspect the
    // native File being sent, then let the real bridge perform its HTTP request.
    window.fetch = async (input, init) => {
      if (init?.body instanceof FormData) {
        const file = init.body.get("file");
        if (file instanceof Blob) uploads.push(Array.from(new Uint8Array(await file.arrayBuffer())));
      }
      return originalFetch.call(window, input, init);
    };
    try {
      const result = await window.interpreterE2E.executeBash(
        {
          code: 'set -e; set -o pipefail; ocr -o raw.txt input.pdf; extract input.pdf | llm -m specialist -s "Summarize" > summary.md; llm "Independent question"',
          files: { "/input.pdf": { content: "data:application/pdf;base64,AP+AQg==", contentType: "application/pdf" } },
        },
        { context: { model: "owning-model" } },
      );
      return { result, uploads };
    } finally {
      window.fetch = originalFetch;
    }
  });
  expect(result.success, result.error).toBe(true);
  expect(result.files?.["/raw.txt"].content).toBe("Grüezi 🪽\nextracted text");
  expect(result.files?.["/summary.md"].content).toBe("Résumé 🪽\n");
  expect(result.output).toBe("Résumé 🪽");
  expect(extractions).toBe(2);
  expect(uploads).toEqual([
    [0, 255, 128, 66],
    [0, 255, 128, 66],
  ]);
  expect(requests.map((request) => request.model)).toEqual(["specialist", "owning-model"]);
  expect(requests.map((request) => request.instructions)).toEqual(["Summarize", ""]);
  expect(JSON.stringify(requests[0].input)).toContain("Grüezi 🪽");
  expect(JSON.stringify(requests[1].input)).toContain("Independent question");
  expect(JSON.stringify(requests[1].input)).not.toContain("Grüezi");
  expect(requests.every((request) => !request.tools?.length)).toBe(true);
});

test("a bundled PDF skill script runs directly by path with arguments and cold dependencies", async ({ page }) => {
  const source = readFileSync("skills/studio/pdf/scripts/check_fillable_fields.py", "utf8");
  const { jsPDF } = await import("jspdf");
  const pdf = `data:application/pdf;base64,${Buffer.from(new jsPDF().output("arraybuffer")).toString("base64")}`;
  await openFixture(page);
  const result = await page.evaluate(
    ({ source, pdf }) =>
      window.interpreterE2E.runScript(
        "python",
        "bundled-skill-script",
        { path: "/skills/test-script/scripts/check.py", args: ["input with spaces.pdf"] },
        { "/input with spaces.pdf": { content: pdf, contentType: "application/pdf" } },
        { "scripts/check.py": source },
      ),
    { source, pdf },
  );
  expect(result.success, result.error).toBe(true);
  expect(result.output).toContain("does not have fillable form fields");
  expect(Object.keys(result.files ?? {})).toEqual(["/input with spaces.pdf"]);
});

test("plugin Python scripts resolve local imports, bundled dependencies, arguments and adjacent resources", async ({
  page,
}) => {
  await openFixture(page);
  const result = await page.evaluate(() =>
    window.interpreterE2E.runScript(
      "python",
      "plugin-python-script",
      {
        path: "/home/user/skills/acme%2Fdocuments:test-script/scripts/run.py",
        args: ["output with spaces.json", "hello world"],
      },
      {},
      {
        "scripts/run.py": `import json, sys, os, __main__
from dataclasses import dataclass
from pathlib import Path
from helpers import size
@dataclass
class Report:
    message: str
assert __main__.Report is Report
if __name__ == "__main__":
    data = {"message": Report(sys.argv[2]).message, "size": size(), "cwd": os.getcwd(), "file": __file__, "adjacent": Path(__file__).with_name("label.txt").read_text()}
    Path(sys.argv[1]).write_text(json.dumps(data))
    sys.exit(0)`,
        "scripts/helpers/__init__.py": "from .image import size",
        "scripts/helpers.py": "invalid shadowed module that must not be scanned !!!",
        "scripts/helpers/image.py":
          "from PIL import Image\ndef size():\n    return list(Image.new('RGB', (7, 9)).size)",
        "scripts/label.txt": "resource label",
        "scripts/unused.py": "invalid Python that must not be scanned !!!",
      },
      "acme/documents",
    ),
  );
  expect(result.success, result.error).toBe(true);
  expect(Object.keys(result.files ?? {})).toEqual(["/output with spaces.json"]);
  expect(JSON.parse(result.files!["/output with spaces.json"].content)).toEqual({
    message: "hello world",
    size: [7, 9],
    cwd: "/home/user",
    adjacent: "resource label",
    file: "/home/user/skills/acme%2Fdocuments:test-script/scripts/run.py",
  });
});

test("ordinary Python file runs refresh local modules and reset argv, paths and main between runs", async ({
  page,
}) => {
  await openFixture(page);
  const results = await page.evaluate(async () => {
    const run = (value: string) =>
      window.interpreterE2E.runScript(
        "python",
        `script-${value}`,
        { path: "/scripts/run.py", args: [value] },
        {
          "/scripts/run.py": { content: "import sys\nfrom helper import value\nprint(__file__, sys.argv[1], value)" },
          "/scripts/helper.py": { content: `value = '${value}'` },
        },
      );
    const first = await run("first");
    const second = await run("second");
    const inline = await window.interpreterE2E.executePython({
      code: `import sys, json
print(json.dumps({"argv": sys.argv, "helper": "helper" in sys.modules, "oldPath": "/home/user/scripts" in sys.path, "file": "__file__" in globals()}))`,
    });
    return { first, second, inline };
  });
  expect(results.first.success, results.first.error).toBe(true);
  expect(results.first.output).toBe("/home/user/scripts/run.py first first");
  expect(results.second.success, results.second.error).toBe(true);
  expect(results.second.output).toBe("/home/user/scripts/run.py second second");
  expect(Object.keys(results.second.files ?? {}).sort()).toEqual(["/scripts/helper.py", "/scripts/run.py"]);
  expect(JSON.parse(results.inline.output)).toEqual({ argv: ["-c"], helper: false, oldPath: false, file: false });
});

test("Python script errors include the filename and failed exits never commit files", async ({ page }) => {
  await openFixture(page);
  const results = await page.evaluate(async () => {
    const failing = await window.interpreterE2E.runScript(
      "python",
      "failed-script",
      { path: "/scripts/fail.py" },
      {
        "/scripts/fail.py": {
          content:
            "from pathlib import Path\nPath('discard.txt').write_text('discard')\nraise ValueError('script failure')",
        },
      },
    );
    const exit = await window.interpreterE2E.runScript("python", "failed-exit", {
      code: "import sys\nfrom pathlib import Path\nPath('discard.txt').write_text('discard')\nsys.exit(2)",
    });
    return { failing, exit };
  });
  expect(results.failing.success).toBe(false);
  expect(results.failing.error).toContain("/home/user/scripts/fail.py");
  expect(results.failing.files?.["/discard.txt"]).toBeUndefined();
  expect(results.exit.success).toBe(false);
  expect(results.exit.error).toContain("Script exited with status 2");
  expect(results.exit.files).toEqual({});
});

for (const source of ["artifact", "plugin"] as const) {
  test(`JavaScript ${source} scripts receive arguments and read adjacent resources through VFS`, async ({ page }) => {
    await openFixture(page);
    const result = await page.evaluate((source) => {
      const code = `const [output, message] = process.argv.slice(2);
vfs.writeJSON(output, {message, file: __filename, directory: __dirname, label: vfs.read(__dirname + '/label.txt')});
return 'script complete';`;
      return window.interpreterE2E.runScript(
        "javascript",
        `js-${source}-script`,
        {
          path: source === "plugin" ? "/skills/acme:test-script/scripts/run.js" : "/scripts/run.js",
          args: ["/output.json", "hello world"],
        },
        source === "artifact"
          ? { "/scripts/run.js": { content: code }, "/scripts/label.txt": { content: "resource label" } }
          : {},
        source === "plugin" ? { "scripts/run.js": code, "scripts/label.txt": "resource label" } : {},
        source === "plugin" ? "acme" : undefined,
      );
    }, source);
    expect(result.success, result.error).toBe(true);
    expect(result.output).toBe("script complete");
    const directory = source === "plugin" ? "/skills/acme:test-script/scripts" : "/scripts";
    expect(JSON.parse(result.files!["/output.json"].content)).toEqual({
      message: "hello world",
      file: `${directory}/run.js`,
      directory,
      label: "resource label",
    });
    if (source === "plugin") expect(Object.keys(result.files ?? {})).toEqual(["/output.json"]);
  });
}

for (const runtime of ["executeJavaScript", "executePython"] as const) {
  test(`${runtime} gives every LLM and vision call a fresh context`, async ({ page }) => {
    const requests: Array<{
      model: string;
      instructions: string;
      input: Array<{ role: string; content: Array<{ type: string; text?: string }> }>;
      tools?: unknown[];
      previous_response_id?: string;
      conversation?: unknown;
    }> = [];
    await page.route("**/config.json", (route) => route.fulfill({ json: { vision: {} } }));
    await page.route("**/api/v1/responses", async (route) => {
      requests.push(route.request().postDataJSON());
      const response = {
        id: `response_${requests.length}`,
        object: "response",
        created_at: 0,
        model: "fixture",
        status: "completed",
        error: null,
        incomplete_details: null,
        output: [
          {
            id: "message",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "PRIVATE_PREVIOUS_HELPER_OUTPUT", annotations: [] }],
          },
        ],
      };
      const events = [
        { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
        { type: "response.completed", response },
      ];
      await route.fulfill({
        contentType: "text/event-stream",
        body: events
          .map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`)
          .join(""),
      });
    });
    await openFixture(page);
    const results = await page.evaluate(async (engine) => {
      await window.interpreterE2E.initializeLlm();
      const execute = window.interpreterE2E[engine];
      const files = { "/image.png": { content: "data:image/png;base64,AQ==", contentType: "image/png" } };
      const first = await execute(
        {
          code:
            engine === "executePython"
              ? 'await llm("First question", model="specialist", system="First instructions")\nawait vision("/home/user/image.png", "First image")'
              : 'await llm("First question", { model: "specialist", system: "First instructions" }); await vision("/image.png", "First image");',
          files,
        },
        { context: { model: "first-run-model" } },
      );
      const second = await execute(
        {
          code:
            engine === "executePython"
              ? 'await llm("Independent question")\nawait vision("/home/user/image.png", "Independent image")'
              : 'await llm("Independent question"); await vision("/image.png", "Independent image");',
          files,
        },
        { context: { model: "next-run-model" } },
      );
      return [first, second];
    }, runtime);
    expect(results.map((result) => ({ success: result.success, error: result.error }))).toEqual([
      { success: true, error: undefined },
      { success: true, error: undefined },
    ]);
    expect(requests.map((request) => request.model)).toEqual([
      "specialist",
      "first-run-model",
      "next-run-model",
      "next-run-model",
    ]);
    expect(requests.map((request) => request.instructions)).toEqual(["First instructions", "", "", ""]);
    expect(
      requests.map((request) =>
        request.input.flatMap((item) =>
          item.content.filter((part) => part.type === "input_text").map((part) => part.text),
        ),
      ),
    ).toEqual([["First question"], ["First image"], ["Independent question"], ["Independent image"]]);
    for (const request of requests) {
      expect(request.input).toHaveLength(1);
      expect(request.input[0].role).toBe("user");
      expect(request.tools ?? []).toEqual([]);
      expect(request.previous_response_id).toBeUndefined();
      expect(request.conversation).toBeUndefined();
      expect(JSON.stringify(request)).not.toContain("PRIVATE_PREVIOUS_HELPER_OUTPUT");
    }
  });
}

test("finished Python executions cannot make delayed LLM calls during the next execution", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/config.json", (route) => route.fulfill({ json: { vision: {} } }));
  await page.route("**/api/v1/responses", async (route) => {
    requests.push(route.request().postData() ?? "");
    await route.fulfill({ status: 400, json: { error: { message: "Unexpected stale request" } } });
  });
  await openFixture(page);
  const results = await page.evaluate(async () => {
    await window.interpreterE2E.initializeLlm();
    const first = await window.interpreterE2E.executePython(
      {
        code: `import asyncio
async def background():
    await asyncio.sleep(0.2)
    try:
        await llm("Expired execution")
    except Exception:
        pass
pending = asyncio.create_task(background())
print("scheduled")`,
      },
      { context: { model: "first-model" } },
    );
    const second = await window.interpreterE2E.executePython(
      {
        code: `import asyncio
await asyncio.sleep(0.5)
print("next run")`,
      },
      { context: { model: "next-model" } },
    );
    return [first, second];
  });
  expect(results.map((result) => result.success)).toEqual([true, true]);
  expect(requests).toEqual([]);
});

test("production file tools preserve BOM/CRLF through OPFS and accept their own writes", async ({ page }) => {
  await openFixture(page);
  const result = await page.evaluate(() => window.interpreterE2E.runToolFlow(`tools-${crypto.randomUUID()}`));
  expect(JSON.stringify(result.created)).toContain("success");
  expect(JSON.stringify(result.edited)).not.toContain("changed since");
  expect(result.file?.content).toBe("\uFEFFALPHA\r\nbeta\r\n");
  const format = { utf8_bom: true, line_endings: "CRLF" };
  expect(JSON.parse(result.created[0].text).text_format).toEqual(format);
  expect(JSON.parse(result.edited[0].text).text_formats).toEqual({ "/bom.txt": format });
  expect(result.read[0].text).toContain("[UTF-8 BOM: yes; line endings: CRLF]");
  expect(result.listed[0].text).toContain("# 1 files");
  expect(result.listed[0].text).toContain("/bom.txt");
});

test("Python uses real Pyodide, blocks fetch, writes files, and resets per-run state", async ({ page }) => {
  await openFixture(page);

  const first = await page.evaluate(() =>
    window.interpreterE2E.executePython({
      code: `import os
from pathlib import Path
sentinel = 42
__name__ = "previous_run"
os.environ["WINGMAN_SENTINEL"] = "set"
os.chdir("/tmp")
Path("/home/user/generated.txt").write_text("generated")
try:
    from js import fetch
    await fetch("https://example.com")
    network_blocked = False
except Exception:
    network_blocked = True
try:
    from js import navigator
    await navigator.storage.getDirectory()
    storage_blocked = False
except Exception:
    storage_blocked = True
print("python-ok", network_blocked, storage_blocked)`,
    }),
  );

  expect(first).toMatchObject({ success: true });
  expect(first.output).toContain("python-ok True True");
  expect(first.files?.["/generated.txt"]?.content).toBe("generated");

  const second = await page.evaluate(() =>
    window.interpreterE2E.executePython({
      code: `import os
if __name__ == "__main__":
    print("sentinel" in globals(), os.getcwd(), os.environ.get("WINGMAN_SENTINEL"))`,
    }),
  );
  expect(second).toMatchObject({ success: true, output: "False /home/user None" });

  const bounded = await page.evaluate(() =>
    window.interpreterE2E.executePython({
      code: `print("x" * 10000)`,
      limits: { maxOutputBytes: 128 },
    }),
  );
  expect(bounded.success).toBe(true);
  expect(new TextEncoder().encode(bounded.output).byteLength).toBeLessThanOrEqual(128);
  expect(bounded.output).toContain("truncated");
});

test("JavaScript supports VFS, blocks remote fetch, resets globals, and recovers after abort", async ({ page }) => {
  await openFixture(page);

  const first = await page.evaluate(() =>
    window.interpreterE2E.executeJavaScript({
      code: `globalThis.sentinel = 42;
Object.prototype.wingmanLeak = "leaked";
const local = await (await fetch("/input.json")).json();
let networkBlocked = false;
try { await fetch("https://example.com"); } catch { networkBlocked = true; }
let storageBlocked = false;
try { await navigator.storage.getDirectory(); } catch { storageBlocked = true; }
vfs.writeJSON("/output.json", { value: local.value * 2 });
console.log("javascript-ok", networkBlocked, storageBlocked);`,
      files: { "/input.json": { content: '{"value":21}', contentType: "application/json" } },
    }),
  );
  expect(first).toMatchObject({ success: true });
  expect(first.output).toContain("javascript-ok true true");
  expect(JSON.parse(first.files?.["/output.json"]?.content ?? "null")).toEqual({ value: 42 });

  const second = await page.evaluate(() =>
    window.interpreterE2E.executeJavaScript({
      code: `console.log(typeof globalThis.sentinel, typeof ({}).wingmanLeak)`,
    }),
  );
  expect(second).toMatchObject({ success: true, output: "undefined undefined" });

  const dynamicImport = await page.evaluate(() =>
    window.interpreterE2E.executeJavaScript({ code: `await import("https://example.com/module.js")` }),
  );
  expect(dynamicImport).toMatchObject({
    success: false,
    error: "Dynamic import is disabled in the JavaScript sandbox",
  });

  const boundedError = await page.evaluate(() =>
    window.interpreterE2E.executeJavaScript({
      code: `throw new Error("x".repeat(10000))`,
      limits: { maxOutputBytes: 128 },
    }),
  );
  expect(boundedError.success).toBe(false);
  expect(new TextEncoder().encode(boundedError.error ?? "").byteLength).toBeLessThanOrEqual(128);
  expect(boundedError.error).toContain("truncated");

  const aborted = await page.evaluate(async () => {
    const controller = new AbortController();
    const promise = window.interpreterE2E.executeJavaScript({ code: `while (true) {}` }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    return promise;
  });
  expect(aborted).toMatchObject({ success: false, error: "Code execution aborted" });

  const recovered = await page.evaluate(() =>
    window.interpreterE2E.executeJavaScript({ code: `return "worker-recovered"` }),
  );
  expect(recovered).toMatchObject({ success: true, output: "worker-recovered" });
});

test("runtime file gates fail safely and Python recovers after forced termination", async ({ page }) => {
  await openFixture(page);

  const tooManyPythonFiles = await page.evaluate(() =>
    window.interpreterE2E.executePython({
      code: `from pathlib import Path
Path("one.txt").write_text("1")
Path("two.txt").write_text("2")`,
      limits: { maxFiles: 1 },
    }),
  );
  expect(tooManyPythonFiles.success).toBe(false);
  expect(tooManyPythonFiles.error).toContain("more than 1 files");

  const oversizedJavaScriptFile = await page.evaluate(() =>
    window.interpreterE2E.executeJavaScript({
      code: `vfs.write("/large.txt", "12345")`,
      limits: { maxFileBytes: 4 },
    }),
  );
  expect(oversizedJavaScriptFile.success).toBe(false);
  expect(oversizedJavaScriptFile.error).toContain("per-file limit is 4");

  const traversalInput = await page.evaluate(() =>
    window.interpreterE2E.executeJavaScript({
      code: `return "must-not-run"`,
      files: { "../escape.txt": { content: "escape" } },
    }),
  );
  expect(traversalInput.success).toBe(false);
  expect(traversalInput.error).toContain("invalid path");

  const aborted = await page.evaluate(async () => {
    const controller = new AbortController();
    const promise = window.interpreterE2E.executePython({ code: `while True: pass` }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    return promise;
  });
  expect(aborted).toMatchObject({ success: false, error: "Code execution aborted" });

  const recovered = await page.evaluate(() =>
    window.interpreterE2E.executePython({ code: `print("python-worker-recovered")` }),
  );
  expect(recovered).toMatchObject({ success: true, output: "python-worker-recovered" });
});

test("artifact OPFS round-trip commits files produced by the real Python worker", async ({ page }) => {
  await openFixture(page);
  const chatId = `playwright-${crypto.randomUUID()}`;

  const result = await page.evaluate((id) => window.interpreterE2E.runArtifactFlow(id), chatId);

  expect(result.execution.success).toBe(true);
  expect(result.execution.output).toBe("hello from opfs");
  expect(result.commit?.createdPaths).toContain("/output.txt");
  expect(result.output).toMatchObject({ content: "HELLO FROM OPFS" });
});
