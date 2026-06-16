/**
 * Pyodide interpreter worker.
 *
 * Runs all Python execution off the main thread so CPU-bound code (PDF
 * parsing, dataframe crunching, ...) cannot freeze the UI. The main-thread
 * counterpart is `interpreter.ts`; the message protocol lives in
 * `interpreterProtocol.ts`. Capabilities that need the main thread (the `llm`,
 * `ocr`, `vision`, `render`, `synthesize`, and `transcribe` Python globals,
 * Plotly DOM rendering) are proxied back over RPC.
 */

import { loadPyodide as loadPyodideRuntime, type PyodideInterface } from "pyodide";
import { bytesToDataUrl, dataUrlToBytes, isDataUrl } from "@/shared/lib/fileContent";
import { inferContentTypeFromPath, isTextContentType } from "@/shared/lib/fileTypes";
import { SANDBOX_HOME } from "@/shared/lib/sandbox";
import ASYNCIO_SHIM from "./asyncioShim.py?raw";
import type {
  ArtifactFile,
  ArtifactFiles,
  CodeExecutionRequest,
  CodeExecutionResult,
  ExecuteMessage,
  LlmCallOptions,
  PlotlyManifest,
  PlotlyResult,
  RenderInput,
  RpcReply,
  WorkerToMainMessage,
} from "./interpreterProtocol";
import LLM_SHIM from "./llmShim.py?raw";
import OCR_SHIM from "./ocrShim.py?raw";
import PLOTLY_IMAGE_SHIM from "./plotlyShim.py?raw";
import RENDER_SHIM from "./renderShim.py?raw";
import SYNTHESIZE_SHIM from "./synthesizeShim.py?raw";
import TRANSCRIBE_SHIM from "./transcribeShim.py?raw";
import TRANSLATE_SHIM from "./translateShim.py?raw";
import VISION_SHIM from "./visionShim.py?raw";

// Typed view of the dedicated-worker global scope (the project compiles
// against the DOM lib, so we avoid referencing the webworker lib globally).
const ctx = self as unknown as {
  postMessage(message: WorkerToMainMessage, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<ExecuteMessage>) => void): void;
};

// Maps Python import names to the package (lock) name to load. Only consulted
// for the explicit `packages` arg: code imports resolve via Pyodide's lock index
// automatically (so `import cv2`/`import docx` need no alias). The model is told
// to pass pip names, but if it passes an *import* name it goes to loadPackage,
// which only knows lock/package names — these map the common slips back.
const PACKAGE_ALIASES: Record<string, string> = {
  docx: "python-docx",
  pptx: "python-pptx",
  pdfminer: "pdfminer-six",
  msoffcrypto: "msoffcrypto-tool",
  pil: "pillow",
  cv2: "opencv-python",
  sklearn: "scikit-learn",
  skimage: "scikit-image",
  bs4: "beautifulsoup4",
  yaml: "pyyaml",
};

const NO_OUTPUT_MESSAGE = "Code executed successfully (no output)";

function normalizePackageName(name: string): string {
  // Callers pass top-level module / pip names; strip a "." defensively in case
  // of "docx.shared", then PEP 503-normalize (e.g. `scikit_learn` → lock key
  // `scikit-learn`). Aliases run on the un-normalized root for `PIL`/`bs4` renames.
  const root = name.trim().toLowerCase().split(".")[0];
  if (!root) return root;
  return PACKAGE_ALIASES[root] ?? root.replace(/[_.]+/g, "-");
}

// stdlib `zoneinfo` and pandas read the IANA tz database from the `tzdata`
// package in WASM (no system zoneinfo dir), but never import it by name — so
// find_imports can't see it. Detect the usual timezone entry points and request
// tzdata explicitly. Matches: `zoneinfo`/`ZoneInfo`, pandas `.tz_localize(`/
// `.tz_convert(`, and a `tz="…"` kwarg. pytz ships its own data and is skipped.
const TZDATA_USAGE = /\bzoneinfo\b|\bZoneInfo\(|\.tz_localize\(|\.tz_convert\(|\btz\s*=\s*['"]/;
function needsTzdata(code: string): boolean {
  return TZDATA_USAGE.test(code);
}

let pyodideReady: Promise<PyodideInterface> | null = null;
let plotlyShimApplied = false;

// `_wingman_rewrite_async` from asyncioShim.py — rewrites blocking asyncio
// entrypoints (asyncio.run, run_until_complete) into top-level await, which
// runPythonAsync supports while synchronous blocking needs JSPI (unavailable
// in Safari). Cached as a callable proxy at load time.
let rewriteAsyncEntrypoints: ((code: string) => string) | null = null;

// The Pyodide FS is a session-long singleton, so we reconcile its /home/user
// tree incrementally instead of wiping and rewriting every file on each call.
// `lastSyncedFiles` mirrors what is currently materialized in the FS (the full
// set collected after the previous run); diffing the next input against it lets
// us skip rewriting unchanged files and only delete ones that went away. A null
// value (first run, a new Pyodide instance, or after an error) forces a full
// clean rebuild so stale files never leak across chats.
let lastSyncedFiles: ArtifactFiles | null = null;
let lastSyncedPyodide: PyodideInterface | null = null;

function artifactFsPath(path: string): string {
  return `${SANDBOX_HOME}/${path.startsWith("/") ? path.slice(1) : path}`;
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
  // `prev` is what we last materialized in the FS. A different instance or a
  // missing record means we can't trust the tree, so wipe it and treat every
  // input as new (the delete loop below is then a no-op over an empty `prev`).
  let prev = lastSyncedPyodide === pyodide ? lastSyncedFiles : null;
  lastSyncedPyodide = pyodide;
  if (prev === null) {
    clearDirectory(pyodide, SANDBOX_HOME);
    prev = {};
  }
  ensureDir(pyodide, SANDBOX_HOME);

  // Remove files that were present last time but are gone now.
  for (const path of Object.keys(prev)) {
    if (!(path in files)) {
      try {
        pyodide.FS.unlink(artifactFsPath(path));
      } catch {
        // Already gone (e.g. removed by the previous run).
      }
    }
  }

  // Write only files whose content or type changed since the last sync.
  for (const [path, file] of Object.entries(files)) {
    const before = prev[path];
    if (before && before.content === file.content && before.contentType === file.contentType) continue;
    writeFileToPyodide(pyodide, path, file);
  }
}

// Only a genuine Date older than the run start proves the file was untouched by
// user code. Anything else (unexpected type, equal/newer timestamp) falls
// through to a fresh read — we never risk returning stale content.
function isUnmodifiedSince(mtime: unknown, runStart: number): boolean {
  return mtime instanceof Date && mtime.getTime() < runStart;
}

function collectPyodideFiles(pyodide: PyodideInterface, sourceFiles: ArtifactFiles, runStart: number): ArtifactFiles {
  const files: ArtifactFiles = {};

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
      } catch {
        // Skip unreadable files.
      }
    }
  };

  walk(SANDBOX_HOME);
  return files;
}

/**
 * Load everything the code needs from the offline lock in /pyodide/.
 *
 * The bundler injects the bundled PyPI wheels (seaborn, pdfplumber, python-docx,
 * …) into pyodide-lock.json alongside the Pyodide built-ins, so a single
 * mechanism — Pyodide's own lock-driven loader — resolves them all by import
 * name. No manifest, micropip, or dep bookkeeping. (sqlite3, ssl, and lzma need
 * no loading at all since Pyodide 314 — they ship in the base interpreter.)
 */
async function ensurePackagesLoaded(
  pyodide: PyodideInterface,
  code: string,
  explicitPackages: string[],
): Promise<void> {
  const warn = (msg: string) => console.warn(`package load: ${msg}`);

  // Everything imported in the code — built-ins, stdlib companions, and bundled
  // PyPI wheels — resolves from the lock index by import name, with transitive
  // deps pulled via each package's `depends`.
  await pyodide.loadPackagesFromImports(code, { errorCallback: warn });

  // Extras the import scan can't see: tzdata (data-only, read by zoneinfo/pandas
  // but never imported by name) and packages the model lists explicitly (mainly
  // for lazily-imported deps like a pandas Excel engine).
  const extra = new Set<string>();
  if (needsTzdata(code)) extra.add("tzdata");
  for (const raw of explicitPackages) {
    const pkg = normalizePackageName(raw);
    if (pkg) extra.add(pkg);
  }

  // Load each independently and tolerantly: `loadPackage` *throws* on an unknown
  // name (a model-guessed package, or a stdlib module like `json`), even with an
  // errorCallback — that must not abort the others or the run. A genuinely
  // missing module still raises ModuleNotFoundError when the code imports it.
  for (const pkg of extra) {
    try {
      await pyodide.loadPackage(pkg, { errorCallback: warn });
    } catch (err) {
      console.warn(`package load: skipped ${pkg} (${err})`);
    }
  }
}

async function runPythonCode(pyodide: PyodideInterface, code: string): Promise<string> {
  let output = "";
  const collect = (text: string) => {
    output += `${text}\n`;
  };

  pyodide.setStdout({ batched: collect });
  pyodide.setStderr({ batched: collect });

  const result = await pyodide.runPythonAsync(code);

  if (result !== undefined && result !== null && !output.trim()) {
    return String(result);
  }

  return output.trim() || NO_OUTPUT_MESSAGE;
}

function loadPyodide(): Promise<PyodideInterface> {
  if (!pyodideReady) {
    pyodideReady = loadPyodideRuntime({ indexURL: "/pyodide/" })
      .then(async (p) => {
        // Default cwd is /home/pyodide, which is outside the synced tree —
        // relative-path writes (open("out.csv", "w")) would be silently lost.
        p.FS.mkdirTree(SANDBOX_HOME);
        p.FS.chdir(SANDBOX_HOME);
        p.globals.set("_wingman_llm", requestLlm);
        p.globals.set("_wingman_ocr", (path: string) => requestOcr(p, path));
        p.globals.set("_wingman_vision", (path: string, prompt: string | null) => requestVision(p, path, prompt));
        p.globals.set("_wingman_render", (prompt: string, output: string, inputsJson: string) =>
          requestRenderImage(p, prompt, output, inputsJson),
        );
        p.globals.set("_wingman_synthesize", (text: string, output: string, voice: string | null) =>
          requestSynthesize(p, text, output, voice),
        );
        p.globals.set("_wingman_transcribe", (path: string) => requestTranscribe(p, path));
        p.globals.set("_wingman_translate_text", (lang: string, text: string) => requestTranslateText(lang, text));
        p.globals.set("_wingman_translate_file", (lang: string, output: string, input: string) =>
          requestTranslateFile(p, lang, output, input),
        );
        await p.runPythonAsync(LLM_SHIM);
        await p.runPythonAsync(OCR_SHIM);
        await p.runPythonAsync(VISION_SHIM);
        await p.runPythonAsync(RENDER_SHIM);
        await p.runPythonAsync(SYNTHESIZE_SHIM);
        await p.runPythonAsync(TRANSCRIBE_SHIM);
        await p.runPythonAsync(TRANSLATE_SHIM);
        await p.runPythonAsync(ASYNCIO_SHIM);
        rewriteAsyncEntrypoints = p.globals.get("_wingman_rewrite_async") as (code: string) => string;
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

async function executeCode(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
  const { packages = [], files = {} } = request;

  try {
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

    syncFilesToPyodide(pyodide, files);
    await ensurePackagesLoaded(pyodide, code, packages);

    // Apply plotly shim after packages are loaded (once per session)
    if (!plotlyShimApplied && "plotly" in pyodide.loadedPackages) {
      await pyodide.runPythonAsync(PLOTLY_IMAGE_SHIM);
      plotlyShimApplied = true;
    }

    clearRenderQueue(pyodide);
    const runStart = Date.now();
    const output = await runPythonCode(pyodide, code);
    await processRenderQueue(pyodide);

    const resultFiles = collectPyodideFiles(pyodide, files, runStart);
    // Remember the materialized tree so the next call can sync incrementally.
    lastSyncedFiles = resultFiles;

    return {
      success: true,
      output,
      files: resultFiles,
    };
  } catch (error) {
    console.error("Code execution error:", error);
    // FS state may be inconsistent — force a clean rebuild on the next call.
    lastSyncedFiles = null;
    return {
      success: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// FS helpers

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

function callMain<T>(build: (port: MessagePort) => WorkerToMainMessage): Promise<T> {
  const { port1, port2 } = new MessageChannel();
  return new Promise<T>((resolve, reject) => {
    port1.onmessage = (event: MessageEvent<RpcReply>) => {
      port1.close();
      const reply = event.data;
      if (reply.ok) {
        resolve(reply.value as T);
      } else {
        reject(new Error(reply.error));
      }
    };
    ctx.postMessage(build(port2), [port2]);
  });
}

/**
 * Bridge behind the Python `llm` helper (see llmShim.py); resolved by the
 * main thread. Options arrive as a JSON string because Pyodide doesn't
 * forward Python kwargs to JS functions.
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

/**
 * Bridge behind the Python `ocr` helper (see ocrShim.py). The file bytes are
 * read from the worker's FS here; the main thread ships them to the backend
 * extractor service (which needs the chat client/config).
 */
async function requestOcr(pyodide: PyodideInterface, path: string): Promise<string> {
  const data = readWorkerFile(pyodide, path, "ocr");
  return callMain<string>((port) => ({ type: "ocr-request", data, path, port }));
}

/**
 * Bridge behind the Python `vision` helper (see visionShim.py). The image
 * bytes are read from the worker's FS here; the main thread sends them to a
 * vision-capable chat model.
 */
async function requestVision(pyodide: PyodideInterface, path: string, prompt: string | null): Promise<string> {
  const data = readWorkerFile(pyodide, path, "vision");
  return callMain<string>((port) => ({ type: "vision-request", data, path, prompt: prompt ?? undefined, port }));
}

/**
 * Bridge behind the Python `render` helper (see renderShim.py). Input images
 * are read from the worker's FS; the main thread calls the backend renderer
 * service and the resulting image is written back to `output` here.
 */
async function requestRenderImage(
  pyodide: PyodideInterface,
  prompt: string,
  output: string,
  inputsJson: string,
): Promise<string> {
  const inputs: RenderInput[] = (JSON.parse(inputsJson) as string[]).map((path) => ({
    data: readWorkerFile(pyodide, path, "render"),
    path,
  }));

  const data = await callMain<Uint8Array>((port) => ({ type: "render-request", prompt, inputs, port }));
  writeWorkerFile(pyodide, output, data);
  return output;
}

/**
 * Bridge behind the Python `synthesize` helper (see synthesizeShim.py). The
 * main thread calls the backend TTS service; the resulting WAV audio is
 * written back to `output` here.
 */
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

/**
 * Bridge behind the Python `transcribe` helper (see transcribeShim.py). The
 * audio bytes are read from the worker's FS here; the main thread ships them
 * to the backend speech-to-text service.
 */
async function requestTranscribe(pyodide: PyodideInterface, path: string): Promise<string> {
  const data = readWorkerFile(pyodide, path, "transcribe");
  return callMain<string>((port) => ({ type: "transcribe-request", data, path, port }));
}

/**
 * Bridge behind the Python `translate` helper (see translateShim.py); resolved
 * by the main thread, which calls the backend translation service.
 */
function requestTranslateText(lang: string, text: string): Promise<string> {
  return callMain<string>((port) => ({ type: "translate-text-request", lang, text, port }));
}

/**
 * Bridge behind the Python `translate_file` helper (see translateShim.py). The
 * file bytes are read from the worker's FS here; the main thread translates
 * them via the backend and the resulting file is written back to `output`.
 */
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

// Plotly render queue — manifests are written by plotlyShim.py; the actual
// rendering needs a DOM, so it happens on the main thread.

const RENDER_QUEUE_DIR = "/tmp/__plotly_render_queue__";
let plotlyJsSent = false;

function clearRenderQueue(pyodide: PyodideInterface): void {
  try {
    const entries = (pyodide.FS.readdir(RENDER_QUEUE_DIR) as string[]).filter((e: string) => e !== "." && e !== "..");
    for (const entry of entries) {
      pyodide.FS.unlink(`${RENDER_QUEUE_DIR}/${entry}`);
    }
  } catch {
    // Queue directory may not exist yet.
  }
}

function readRenderManifests(pyodide: PyodideInterface): PlotlyManifest[] {
  let entries: string[];
  try {
    entries = (pyodide.FS.readdir(RENDER_QUEUE_DIR) as string[])
      .filter((e: string) => e !== "." && e !== ".." && e.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }

  const manifests: PlotlyManifest[] = [];
  for (const entry of entries) {
    try {
      const json = pyodide.FS.readFile(`${RENDER_QUEUE_DIR}/${entry}`, { encoding: "utf8" }) as string;
      manifests.push(JSON.parse(json) as PlotlyManifest);
    } catch (error) {
      console.error(`Failed to read plotly manifest ${entry}:`, error);
    }
  }
  return manifests;
}

function readPlotlyJsSource(pyodide: PyodideInterface): string {
  const plotlyJsPath = String(
    pyodide.runPython(
      "import plotly, os; os.path.join(os.path.dirname(plotly.__file__), 'package_data', 'plotly.min.js')",
    ),
  ).trim();
  return pyodide.FS.readFile(plotlyJsPath, { encoding: "utf8" }) as string;
}

async function processRenderQueue(pyodide: PyodideInterface): Promise<void> {
  const manifests = readRenderManifests(pyodide);
  if (manifests.length === 0) return;

  try {
    const plotlyJs = plotlyJsSent ? undefined : readPlotlyJsSource(pyodide);
    const results = await callMain<PlotlyResult[]>((port) => ({
      type: "plotly-request",
      manifests,
      plotlyJs,
      port,
    }));
    plotlyJsSent = true;

    for (const result of results) {
      const dir = result.path.substring(0, result.path.lastIndexOf("/"));
      if (dir) ensureDir(pyodide, dir);
      pyodide.FS.writeFile(result.path, result.data);
    }
  } catch (error) {
    console.error("Failed to render plotly figures:", error);
  }

  clearRenderQueue(pyodide);
}

// Message loop — executions are serialized: the Pyodide FS and the
// package/sync bookkeeping are shared state, so concurrent runs would
// interleave at await points. RPC replies arrive on their own ports and
// bypass the chain, unblocking the run currently executing.
let executionChain: Promise<void> = Promise.resolve();

ctx.addEventListener("message", (event) => {
  const { request, port } = event.data;
  executionChain = executionChain.then(async () => {
    // executeCode never throws — errors come back as { success: false }.
    const result = await executeCode(request);
    try {
      port.postMessage(result);
    } catch (error) {
      // A non-cloneable result must not break the chain (every subsequent run
      // would hang) — report the failure on the same port instead.
      port.postMessage({
        success: false,
        output: "",
        error: `Failed to serialize execution result: ${error instanceof Error ? error.message : String(error)}`,
      } satisfies CodeExecutionResult);
    }
    port.close();
  });
});
