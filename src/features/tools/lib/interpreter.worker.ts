/**
 * Pyodide interpreter worker — runs all Python off the main thread so CPU-bound
 * code can't freeze the UI. Main-thread counterpart is `interpreter.ts`; the
 * llm/ocr/vision/render/synthesize/transcribe globals proxy back over RPC.
 */

import { loadPyodide as loadPyodideRuntime, type PyodideInterface } from "pyodide";
import type { ImageRenderOptions } from "@/shared/lib/client";
import { bytesToDataUrl, dataUrlToBytes, isDataUrl } from "@/shared/lib/fileContent";
import { inferContentTypeFromPath, isTextContentType } from "@/shared/lib/fileTypes";
import type { RasterizedPage } from "@/shared/lib/pdf";
import { normalizeArtifactPath, SANDBOX_HOME } from "@/shared/lib/sandbox";
import ASYNCIO_SHIM from "./asyncioShim.py?raw";
import {
  BoundedOutput,
  CodeExecutionLimitError,
  DEFAULT_CODE_EXECUTION_LIMITS,
  resolveCodeExecutionLimits,
  validateArtifactFiles,
} from "./executionLimits";
import type {
  ArtifactFile,
  ArtifactFiles,
  CodeExecutionRequest,
  CodeExecutionResult,
  ExecuteMessage,
  ExecuteReply,
  LlmCallOptions,
  RenderInput,
  WorkerToMainMessage,
} from "./interpreterProtocol";
import { NO_OUTPUT_MESSAGE } from "./interpreterProtocol";
import { callMainThread } from "./interpreterRpc";
import LLM_SHIM from "./llmShim.py?raw";
import OCR_SHIM from "./ocrShim.py?raw";
import PDF_RASTERIZE_SHIM from "./pdfRasterizeShim.py?raw";
import RENDER_SHIM from "./renderShim.py?raw";
import SYNTHESIZE_SHIM from "./synthesizeShim.py?raw";
import TRANSCRIBE_SHIM from "./transcribeShim.py?raw";
import TRANSLATE_SHIM from "./translateShim.py?raw";
import VISION_SHIM from "./visionShim.py?raw";

// Typed view of the worker global scope (project compiles against the DOM lib, not webworker).
const ctx = self as unknown as {
  postMessage(message: WorkerToMainMessage, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<ExecuteMessage>) => void): void;
};

const workerGlobal = self as unknown as Record<string, unknown>;
const nativeFetch =
  typeof workerGlobal.fetch === "function" ? (workerGlobal.fetch as typeof fetch).bind(self) : undefined;
const NETWORK_DISABLED = "Direct network access is disabled in the Python sandbox";
const blockedNetwork = () => {
  throw new TypeError(NETWORK_DISABLED);
};

/** Keep Pyodide's package loader online only while it reads same-origin bundled assets. */
async function withRuntimeFetch<T>(run: () => Promise<T>): Promise<T> {
  if (nativeFetch) workerGlobal.fetch = nativeFetch;
  try {
    return await run();
  } finally {
    lockDownUserNetwork();
  }
}

function lockDownUserNetwork(): void {
  workerGlobal.fetch = blockedNetwork;
  for (const name of [
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "importScripts",
    "WebTransport",
    "RTCPeerConnection",
    "Worker",
    "SharedWorker",
    "BroadcastChannel",
    "indexedDB",
    "caches",
  ]) {
    try {
      Object.defineProperty(workerGlobal, name, { configurable: true, value: blockedNetwork });
    } catch {
      try {
        workerGlobal[name] = blockedNetwork;
      } catch {
        // Best effort for non-writable worker globals.
      }
    }
  }
  try {
    const nav = (workerGlobal.navigator ?? {}) as Record<string, unknown>;
    for (const name of ["sendBeacon", "storage", "locks", "serviceWorker", "credentials"]) {
      try {
        Object.defineProperty(nav, name, { configurable: true, value: blockedNetwork });
      } catch {
        // navigator may expose non-configurable properties.
      }
    }
  } catch {
    // navigator may expose read-only properties.
  }
}

// zoneinfo/pandas read the IANA tz db from `tzdata` but never import it by name,
// so find_imports misses it; detect timezone usage and load tzdata explicitly.
// (pytz ships its own data and is skipped.)
const TZDATA_USAGE = /\bzoneinfo\b|\bZoneInfo\(|\.tz_localize\(|\.tz_convert\(|\btz\s*=\s*['"]/;
function needsTzdata(code: string): boolean {
  return TZDATA_USAGE.test(code);
}

let pyodideReady: Promise<PyodideInterface> | null = null;

// `_wingman_rewrite_async` from asyncioShim.py rewrites blocking asyncio
// entrypoints (asyncio.run, ...) into top-level await; sync blocking would need
// JSPI, which Safari lacks. Cached as a callable proxy at load time.
let rewriteAsyncEntrypoints: ((code: string) => string) | null = null;

// The Pyodide FS is a session-long singleton, so we sync /home/user incrementally
// rather than wiping it each call. `lastSyncedFiles` mirrors what's materialized;
// diffing the next input skips unchanged files and deletes vanished ones. null
// (first run, new instance, or after an error) forces a clean rebuild so stale
// files never leak across chats.
let lastSyncedFiles: ArtifactFiles | null = null;
let lastSyncedPyodide: PyodideInterface | null = null;

function artifactFsPath(path: string): string {
  const normalized = normalizeArtifactPath(path);
  if (!normalized || normalized === "/") throw new Error(`Invalid artifact path: ${path}`);
  return `${SANDBOX_HOME}${normalized}`;
}

function writeFileToPyodide(pyodide: PyodideInterface, path: string, file: ArtifactFile): void {
  const fsPath = artifactFsPath(path);
  const dir = fsPath.substring(0, fsPath.lastIndexOf("/"));
  if (dir) ensureDir(pyodide, dir);

  if (isDataUrl(file.content) || (file.contentType && !isTextContentType(file.contentType))) {
    const parsed = dataUrlToBytes(file.content);
    pyodide.FS.writeFile(fsPath, parsed ? parsed.bytes : new TextEncoder().encode(file.content));
  } else {
    pyodide.FS.writeFile(fsPath, file.content);
  }
}

function syncFilesToPyodide(pyodide: PyodideInterface, files: ArtifactFiles): void {
  // `prev` is what we last materialized. A different instance or missing record
  // means we can't trust the tree, so wipe it and treat every input as new.
  let prev = lastSyncedPyodide === pyodide ? lastSyncedFiles : null;
  lastSyncedPyodide = pyodide;
  if (prev === null) {
    clearDirectory(pyodide, SANDBOX_HOME);
    prev = {};
  }
  ensureDir(pyodide, SANDBOX_HOME);

  for (const path of Object.keys(prev)) {
    if (!(path in files)) {
      try {
        pyodide.FS.unlink(artifactFsPath(path));
      } catch {
        // Already gone (e.g. removed by the previous run).
      }
    }
  }

  for (const [path, file] of Object.entries(files)) {
    const before = prev[path];
    if (before && before.content === file.content && before.contentType === file.contentType) continue;
    writeFileToPyodide(pyodide, path, file);
  }
}

// Only a genuine Date older than the run start proves the file was untouched;
// anything else falls through to a fresh read so we never return stale content.
function isUnmodifiedSince(mtime: unknown, runStart: number): boolean {
  return mtime instanceof Date && mtime.getTime() < runStart;
}

function collectPyodideFiles(
  pyodide: PyodideInterface,
  sourceFiles: ArtifactFiles,
  runStart: number,
  limits: ReturnType<typeof resolveCodeExecutionLimits>,
): ArtifactFiles {
  const files: ArtifactFiles = {};
  let fileCount = 0;
  let totalBytes = 0;

  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = (pyodide.FS.readdir(dir) as string[]).filter((e) => e !== "." && e !== "..");
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = `${dir}/${entry}`;
      try {
        const stat = pyodide.FS.stat(fullPath);
        if (pyodide.FS.isDir(stat.mode)) {
          walk(fullPath);
          continue;
        }

        fileCount++;
        if (fileCount > limits.maxFiles) {
          throw new CodeExecutionLimitError(`Interpreter filesystem has more than ${limits.maxFiles} files`);
        }
        const fileBytes = typeof stat.size === "number" ? stat.size : 0;
        if (fileBytes > limits.maxFileBytes) {
          throw new CodeExecutionLimitError(
            `${fullPath} is ${fileBytes} bytes; per-file limit is ${limits.maxFileBytes}`,
          );
        }
        totalBytes += fileBytes;
        if (totalBytes > limits.maxTotalFileBytes) {
          throw new CodeExecutionLimitError(
            `Interpreter filesystem is over the ${limits.maxTotalFileBytes}-byte total limit`,
          );
        }

        const artifactPath = `/${fullPath.slice(SANDBOX_HOME.length + 1)}`;
        if (artifactPath === "/") continue;

        // Input file the run never touched: reuse the caller's content verbatim
        // instead of reading the bytes back and re-encoding them.
        const source = sourceFiles[artifactPath];
        if (source && isUnmodifiedSince(stat.mtime, runStart)) {
          files[artifactPath] = source;
          continue;
        }

        const contentType = source?.contentType ?? inferContentTypeFromPath(artifactPath);

        if (isTextContentType(contentType)) {
          files[artifactPath] = {
            content: pyodide.FS.readFile(fullPath, { encoding: "utf8" }) as string,
            contentType,
          };
        } else {
          const bytes = pyodide.FS.readFile(fullPath) as Uint8Array;
          const ct = contentType ?? "application/octet-stream";
          files[artifactPath] = { content: bytesToDataUrl(bytes, ct), contentType: ct };
        }
      } catch (error) {
        if (error instanceof CodeExecutionLimitError) throw error;
        // Skip unreadable files.
      }
    }
  };

  walk(SANDBOX_HOME);
  return files;
}

/**
 * Load everything the code needs from the offline lock in /pyodide/. The bundler
 * injects the bundled PyPI wheels into pyodide-lock.json alongside the built-ins,
 * so Pyodide's own lock-driven loader resolves them all by import name — no
 * micropip or dep bookkeeping. (sqlite3/ssl/lzma ship in the base interpreter.)
 */
async function ensurePackagesLoaded(pyodide: PyodideInterface, code: string): Promise<void> {
  const warn = (msg: string) => console.warn(`package load: ${msg}`);

  await withRuntimeFetch(async () => {
    // All imports resolve from the lock index by name; transitive deps via `depends`.
    await pyodide.loadPackagesFromImports(code, { errorCallback: warn });

    // tzdata is data-only and therefore invisible to the import scan.
    if (needsTzdata(code)) await pyodide.loadPackage("tzdata", { errorCallback: warn });
  });
}

async function runPythonCode(
  pyodide: PyodideInterface,
  code: string,
  globals: PyodideInterface["globals"],
  maxOutputBytes: number,
): Promise<string> {
  const output = new BoundedOutput(maxOutputBytes);
  const collect = (text: string) => {
    output.append(`${text}\n`);
  };

  pyodide.setStdout({ batched: collect });
  pyodide.setStderr({ batched: collect });

  const result = await pyodide.runPythonAsync(code, { globals });
  try {
    const captured = output.value();
    if (result !== undefined && result !== null && !captured.trim()) {
      const value = new BoundedOutput(maxOutputBytes);
      value.append(String(result));
      return value.value();
    }
    return captured.trim() || NO_OUTPUT_MESSAGE;
  } finally {
    if (result && typeof result === "object" && "destroy" in result && typeof result.destroy === "function") {
      result.destroy();
    }
  }
}

const USER_SHIMS = [
  LLM_SHIM,
  OCR_SHIM,
  VISION_SHIM,
  RENDER_SHIM,
  SYNTHESIZE_SHIM,
  TRANSCRIBE_SHIM,
  TRANSLATE_SHIM,
  PDF_RASTERIZE_SHIM,
];

async function createExecutionGlobals(pyodide: PyodideInterface): Promise<PyodideInterface["globals"]> {
  const globals = pyodide.runPython("dict()") as PyodideInterface["globals"];
  globals.set("_wingman_llm", requestLlm);
  globals.set("_wingman_ocr", (path: string) => requestOcr(pyodide, path));
  globals.set("_wingman_vision", (path: string, prompt: string | null) => requestVision(pyodide, path, prompt));
  globals.set("_wingman_render", (prompt: string, output: string, inputsJson: string, optionsJson: string | null) =>
    requestRenderImage(pyodide, prompt, output, inputsJson, optionsJson),
  );
  globals.set("_wingman_synthesize", (text: string, output: string, voice: string | null) =>
    requestSynthesize(pyodide, text, output, voice),
  );
  globals.set("_wingman_transcribe", (path: string) => requestTranscribe(pyodide, path));
  globals.set("_wingman_translate_text", (lang: string, text: string) => requestTranslateText(lang, text));
  globals.set("_wingman_translate_file", (lang: string, output: string, input: string) =>
    requestTranslateFile(pyodide, lang, output, input),
  );
  globals.set("_wingman_rasterize_pdf", (path: string, optionsJson: string | null) =>
    requestRasterizePdf(pyodide, path, optionsJson),
  );
  for (const shim of USER_SHIMS) await pyodide.runPythonAsync(shim, { globals });
  return globals;
}

function loadPyodide(): Promise<PyodideInterface> {
  if (!pyodideReady) {
    pyodideReady = loadPyodideRuntime({ indexURL: "/pyodide/" })
      .then(async (p) => {
        // Default cwd is /home/pyodide, which is outside the synced tree —
        // relative-path writes (open("out.csv", "w")) would be silently lost.
        p.FS.mkdirTree(SANDBOX_HOME);
        p.FS.chdir(SANDBOX_HOME);
        // Matplotlib's default backend wants a DOM canvas the worker lacks, so figure
        // creation would fail. Force the headless Agg backend (savefig still works);
        // an explicit matplotlib.use(...) in user code still wins.
        p.runPython("import os; os.environ.setdefault('MPLBACKEND', 'Agg'); _wingman_base_environ = dict(os.environ)");
        await p.runPythonAsync(ASYNCIO_SHIM);
        rewriteAsyncEntrypoints = p.globals.get("_wingman_rewrite_async") as (code: string) => string;
        lockDownUserNetwork();
        console.log("Pyodide loaded successfully");
        return p;
      })
      .catch((error) => {
        console.error("Failed to load Pyodide:", error);
        pyodideReady = null; // allow retry on next call
        throw error;
      });
  }
  return pyodideReady;
}

async function executeCode(request: CodeExecutionRequest, onStarted?: () => void): Promise<CodeExecutionResult> {
  const { files = {} } = request;
  let maxOutputBytes = DEFAULT_CODE_EXECUTION_LIMITS.maxOutputBytes;

  try {
    const limits = resolveCodeExecutionLimits(request.limits);
    maxOutputBytes = limits.maxOutputBytes;
    validateArtifactFiles(files, limits, "Interpreter input filesystem");
    const pyodide = await loadPyodide();

    let code = request.code;
    if (rewriteAsyncEntrypoints) {
      try {
        code = rewriteAsyncEntrypoints(request.code);
      } catch (error) {
        // A rewrite failure must never block execution — run the original.
        console.error("asyncio entrypoint rewrite failed; running original code:", error);
      }
    }

    pyodide.FS.chdir(SANDBOX_HOME);
    pyodide.runPython("import os; os.environ.clear(); os.environ.update(_wingman_base_environ)");
    syncFilesToPyodide(pyodide, files);
    await ensurePackagesLoaded(pyodide, code);

    const globals = await createExecutionGlobals(pyodide);

    try {
      onStarted?.();

      const runStart = Date.now();
      const output = await runPythonCode(pyodide, code, globals, limits.maxOutputBytes);

      const resultFiles = collectPyodideFiles(pyodide, files, runStart, limits);
      validateArtifactFiles(resultFiles, limits);
      // Remember the materialized tree so the next call can sync incrementally.
      lastSyncedFiles = resultFiles;

      return {
        success: true,
        output,
        files: resultFiles,
      };
    } finally {
      globals.destroy();
      lockDownUserNetwork();
    }
  } catch (error) {
    console.error("Code execution error:", error);
    // FS state may be inconsistent — force a clean rebuild on the next call.
    lastSyncedFiles = null;
    const boundedError = new BoundedOutput(maxOutputBytes);
    boundedError.append(error instanceof Error ? (error.stack ?? error.message) : String(error));
    return {
      success: false,
      output: "",
      error: boundedError.value(),
    };
  }
}

function ensureDir(pyodide: PyodideInterface, dir: string): void {
  try {
    pyodide.FS.mkdirTree(dir);
  } catch {
    // Already exists.
  }
}

function clearDirectory(pyodide: PyodideInterface, dir: string): void {
  let entries: string[];
  try {
    entries = (pyodide.FS.readdir(dir) as string[]).filter((e) => e !== "." && e !== "..");
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = `${dir}/${entry}`;
    const stat = pyodide.FS.stat(fullPath);

    if (pyodide.FS.isDir(stat.mode)) {
      clearDirectory(pyodide, fullPath);
      pyodide.FS.rmdir(fullPath);
    } else {
      pyodide.FS.unlink(fullPath);
    }
  }
}

// RPC to the main thread — each call ships its own reply port, so responses
// need no correlation or routing.

const callMain = <T>(build: (port: MessagePort) => WorkerToMainMessage): Promise<T> =>
  callMainThread<T>((message, transfer) => ctx.postMessage(message, transfer), build);

/**
 * Bridge behind the Python `llm` helper (llmShim.py), resolved by the main thread.
 * Options arrive as a JSON string because Pyodide doesn't forward Python kwargs.
 */
function requestLlm(prompt: string, optionsJson?: string | null): Promise<string> {
  let options: LlmCallOptions | undefined;
  if (optionsJson) {
    try {
      options = JSON.parse(optionsJson) as LlmCallOptions;
    } catch {
      // Malformed options — proceed with defaults rather than failing the call.
    }
  }
  return callMain<string>((port) => ({ type: "llm-request", prompt, options, port }));
}

function readWorkerFile(pyodide: PyodideInterface, path: string, helper: string): Uint8Array {
  try {
    return pyodide.FS.readFile(path) as Uint8Array;
  } catch {
    throw new Error(`${helper}: cannot read file: ${path}`);
  }
}

function writeWorkerFile(pyodide: PyodideInterface, path: string, data: Uint8Array): void {
  const dir = path.substring(0, path.lastIndexOf("/"));
  if (dir) ensureDir(pyodide, dir);
  pyodide.FS.writeFile(path, data);
}

/** Bridge behind the Python `ocr` helper (ocrShim.py); reads file bytes from the FS, runs the backend extractor on the main thread. */
async function requestOcr(pyodide: PyodideInterface, path: string): Promise<string> {
  const data = readWorkerFile(pyodide, path, "ocr");
  return callMain<string>((port) => ({ type: "ocr-request", data, path, port }));
}

/** Bridge behind the Python `vision` helper (visionShim.py); reads image bytes from the FS, runs a vision model on the main thread. */
async function requestVision(pyodide: PyodideInterface, path: string, prompt: string | null): Promise<string> {
  const data = readWorkerFile(pyodide, path, "vision");
  return callMain<string>((port) => ({ type: "vision-request", data, path, prompt: prompt ?? undefined, port }));
}

/** Bridge behind the Python `render` helper (renderShim.py); reads inputs from the FS, writes the rendered image back to `output`. */
async function requestRenderImage(
  pyodide: PyodideInterface,
  prompt: string,
  output: string,
  inputsJson: string,
  optionsJson?: string | null,
): Promise<string> {
  const inputs: RenderInput[] = (JSON.parse(inputsJson) as string[]).map((path) => ({
    data: readWorkerFile(pyodide, path, "render"),
    path,
  }));

  let options: ImageRenderOptions | undefined;
  if (optionsJson) {
    try {
      options = JSON.parse(optionsJson) as ImageRenderOptions;
    } catch {
      // Malformed options — proceed with defaults rather than failing the call.
    }
  }

  const data = await callMain<Uint8Array>((port) => ({ type: "render-request", prompt, inputs, options, port }));
  writeWorkerFile(pyodide, output, data);
  return output;
}

/** Bridge behind the Python `synthesize` helper (synthesizeShim.py); writes the backend's WAV audio back to `output`. */
async function requestSynthesize(
  pyodide: PyodideInterface,
  text: string,
  output: string,
  voice: string | null,
): Promise<string> {
  const data = await callMain<Uint8Array>((port) => ({
    type: "synthesize-request",
    text,
    voice: voice ?? undefined,
    port,
  }));
  writeWorkerFile(pyodide, output, data);
  return output;
}

/** Bridge behind the Python `transcribe` helper (transcribeShim.py); reads audio bytes from the FS, runs backend speech-to-text. */
async function requestTranscribe(pyodide: PyodideInterface, path: string): Promise<string> {
  const data = readWorkerFile(pyodide, path, "transcribe");
  return callMain<string>((port) => ({ type: "transcribe-request", data, path, port }));
}

/** Bridge behind the Python `translate` helper (translateShim.py), resolved by the main thread. */
function requestTranslateText(lang: string, text: string): Promise<string> {
  return callMain<string>((port) => ({ type: "translate-text-request", lang, text, port }));
}

/** Bridge behind the Python `translate_file` helper (translateShim.py); reads input from the FS, writes the translated file back to `output`. */
async function requestTranslateFile(
  pyodide: PyodideInterface,
  lang: string,
  output: string,
  input: string,
): Promise<string> {
  const data = readWorkerFile(pyodide, input, "translate");
  const result = await callMain<Uint8Array>((port) => ({
    type: "translate-file-request",
    lang,
    data,
    path: input,
    port,
  }));
  writeWorkerFile(pyodide, output, result);
  return output;
}

/**
 * Bridge behind the Python `rasterize_pdf` helper (pdfRasterizeShim.py); reads
 * the PDF from the FS, renders the requested pages to PNG on the main thread via
 * pdf.js, writes each `{stem}-{page}.png` back, and returns the paths as JSON.
 */
async function requestRasterizePdf(
  pyodide: PyodideInterface,
  path: string,
  optionsJson: string | null,
): Promise<string> {
  const data = readWorkerFile(pyodide, path, "rasterize_pdf");
  let pages: number[] | undefined;
  let scale: number | undefined;
  if (optionsJson) {
    try {
      const opts = JSON.parse(optionsJson) as { pages?: number[] | null; scale?: number };
      if (Array.isArray(opts.pages)) pages = opts.pages;
      if (typeof opts.scale === "number") scale = opts.scale;
    } catch {
      // Malformed options — render every page at the default scale.
    }
  }
  const rendered = await callMain<RasterizedPage[]>((port) => ({
    type: "pdf-rasterize-request",
    data,
    pages,
    scale,
    port,
  }));
  const stem = path.replace(/\.pdf$/i, "");
  const paths = rendered.map(({ page, data: png }) => {
    const output = `${stem}-${page}.png`;
    writeWorkerFile(pyodide, output, png);
    return output;
  });
  return JSON.stringify(paths);
}

// Executions are serialized: the Pyodide FS and sync bookkeeping are shared
// state, so concurrent runs would interleave at await points. RPC replies arrive
// on their own ports and bypass the chain, unblocking the running execution.
let executionChain: Promise<void> = Promise.resolve();

ctx.addEventListener("message", (event) => {
  const { request, port } = event.data;
  executionChain = executionChain.then(async () => {
    const signalStarted = () => {
      try {
        port.postMessage({ type: "started" } satisfies ExecuteReply);
      } catch {
        // best-effort
      }
    };
    // executeCode never throws — errors come back as { success: false }.
    const result = await executeCode(request, signalStarted);
    try {
      port.postMessage({ type: "result", result } satisfies ExecuteReply);
    } catch (error) {
      // A non-cloneable result must not break the chain (every subsequent run
      // would hang) — report the failure on the same port instead.
      port.postMessage({
        type: "result",
        result: {
          success: false,
          output: "",
          error: `Failed to serialize execution result: ${error instanceof Error ? error.message : String(error)}`,
        },
      } satisfies ExecuteReply);
    }
    port.close();
  });
});
