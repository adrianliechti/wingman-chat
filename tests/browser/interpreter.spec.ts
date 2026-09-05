import { expect, test, type Page } from "@playwright/test";

type ExecutionResult = {
  success: boolean;
  output: string;
  error?: string;
  files?: Record<string, { content: string; contentType?: string }>;
};

type TextToolResult = Array<{ type: "text"; text: string }>;

declare global {
  interface Window {
    interpreterE2E: {
      executePython(request: unknown, options?: unknown): Promise<ExecutionResult>;
      executeJavaScript(request: unknown, options?: unknown): Promise<ExecutionResult>;
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

async function openFixture(page: Page): Promise<void> {
  await page.goto("/tests/browser/fixtures/interpreter.html");
  await page.waitForFunction(() => Boolean(window.interpreterE2E));
}

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
