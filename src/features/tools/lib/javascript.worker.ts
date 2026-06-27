/**
 * JavaScript interpreter worker.
 *
 * Runs LLM-authored JavaScript off the main thread (so CPU-bound code can't
 * freeze the UI) and isolated from the app's DOM and origin globals. The
 * main-thread counterpart is `javascript.ts`; the shared worker lifecycle is in
 * `workerHost.ts`; the message protocol is `interpreterProtocol.ts` (shared with
 * the Pyodide worker).
 *
 * Sandbox model:
 *   - Network is disabled: `fetch`/`XMLHttpRequest`/`WebSocket`/… are replaced
 *     with throwing stubs. `fetch` is repurposed to read the in-memory VFS for
 *     relative paths (and still serves `data:`/`blob:` URLs, which never touch
 *     the network).
 *   - Files arrive as the run's VFS and are written back as artifacts; binary
 *     output is encoded as a data URL, exactly like the Pyodide worker.
 *   - Worker-scope Web APIs (WebCodecs, OffscreenCanvas, createImageBitmap,
 *     crypto.subtle, WebAssembly, …) are available to user code unchanged. The
 *     `mediabunny`/`echarts`/`jsPDF` modules are injected lazily when referenced.
 *   - Node-isms that LLM-authored code reaches for (`Buffer`, `process`,
 *     `global`, `setImmediate`) are shimmed so common snippets run unchanged.
 *   - AI helpers (`llm`, `ocr`, `vision`, `transcribe`, `synthesize`, `render`,
 *     `translate`/`translateFile`) are proxied to the main thread over RPC (they
 *     need the chat client/config), mirroring the Python globals.
 */

import { bytesToDataUrl, dataUrlToBytes, isDataUrl } from "@/shared/lib/fileContent";
import { inferContentTypeFromPath, isTextContentType } from "@/shared/lib/fileTypes";
import { normalizeArtifactPath } from "@/shared/lib/sandbox";
import type {
  ArtifactFile,
  ArtifactFiles,
  CodeExecutionRequest,
  CodeExecutionResult,
  ExecuteMessage,
  ExecuteReply,
  LlmCallOptions,
  RpcReply,
  WorkerToMainMessage,
} from "./interpreterProtocol";

// Typed view of the dedicated-worker global scope (the project compiles against
// the DOM lib, so we avoid referencing the webworker lib globally).
const ctx = self as unknown as {
  postMessage(message: WorkerToMainMessage, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<ExecuteMessage>) => void): void;
};

const NO_OUTPUT_MESSAGE = "Code executed successfully (no output)";
const NETWORK_DISABLED = "Network access is disabled in the JavaScript sandbox";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ── Virtual filesystem ──────────────────────────────────────────────────────
// Keyed by artifact path (leading slash). `dirty` distinguishes files the run
// wrote/changed (which must be re-encoded) from untouched inputs (returned
// verbatim from `original`, avoiding a needless decode/encode round trip).

interface VfsEntry {
  bytes: Uint8Array;
  contentType?: string;
  dirty: boolean;
  original?: ArtifactFile;
}

type Vfs = Map<string, VfsEntry>;

// The VFS for the run currently executing — the sandboxed `fetch` closes over
// this. Runs are serialized, so a single slot suffices.
let currentVfs: Vfs | null = null;

// Sink for the current run's `process.stdout`/`stderr` writes (raw, no newline),
// so Node-style CLI output lands in the run's captured output. Serialized runs.
let currentStdout: ((text: string) => void) | null = null;

function normalizePath(path: string): string | undefined {
  return normalizeArtifactPath(path);
}

function loadVfs(files: ArtifactFiles): Vfs {
  const vfs: Vfs = new Map();
  for (const [path, file] of Object.entries(files)) {
    const key = normalizePath(path);
    if (!key) continue;
    let bytes: Uint8Array;
    if (isDataUrl(file.content) || (file.contentType && !isTextContentType(file.contentType))) {
      const parsed = dataUrlToBytes(file.content);
      bytes = parsed ? parsed.bytes : encoder.encode(file.content);
    } else {
      bytes = encoder.encode(file.content);
    }
    vfs.set(key, { bytes, contentType: file.contentType, dirty: false, original: file });
  }
  return vfs;
}

function collectVfs(vfs: Vfs): ArtifactFiles {
  const files: ArtifactFiles = {};
  for (const [path, entry] of vfs) {
    if (!entry.dirty && entry.original) {
      files[path] = entry.original;
      continue;
    }
    const contentType = entry.contentType ?? inferContentTypeFromPath(path);
    if (isTextContentType(contentType)) {
      files[path] = { content: decoder.decode(entry.bytes), contentType };
    } else {
      const ct = contentType ?? "application/octet-stream";
      files[path] = { content: bytesToDataUrl(entry.bytes, ct), contentType: ct };
    }
  }
  return files;
}

function toBytes(data: unknown): Uint8Array {
  if (typeof data === "string") return encoder.encode(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new Error("write: data must be a string, Uint8Array, ArrayBuffer, or typed array");
}

// Path-normalized byte access over the VFS, shared by the `vfs` helper and the
// AI bridges (both read inputs and write outputs by path). `writeBytes` returns
// the normalized key so callers can echo the written path back.
function vfsAccess(vfs: Vfs) {
  const requireKey = (path: string): string => {
    const key = normalizePath(path);
    if (!key) throw new Error(`invalid path: ${path}`);
    return key;
  };
  const readBytes = (path: string): Uint8Array => {
    const entry = vfs.get(requireKey(path));
    if (!entry) throw new Error(`file not found: ${path}`);
    return entry.bytes;
  };
  const writeBytes = (path: string, data: unknown, contentType?: string): string => {
    const key = requireKey(path);
    const bytes = toBytes(data);
    const ct = contentType ?? inferContentTypeFromPath(key) ?? (typeof data === "string" ? "text/plain" : undefined);
    vfs.set(key, { bytes, contentType: ct, dirty: true });
    return key;
  };
  return { requireKey, readBytes, writeBytes };
}

// The `vfs` helper handed to user code. Paths are artifact paths (leading
// slash); inputs are normalized so "data.csv", "/data.csv", and
// "/home/user/data.csv" all resolve to the same file.
function buildVfs(vfs: Vfs) {
  const { requireKey, readBytes, writeBytes } = vfsAccess(vfs);
  return {
    list: (): string[] => [...vfs.keys()].sort(),
    exists: (path: string): boolean => vfs.has(requireKey(path)),
    readBytes,
    readText: (path: string): string => decoder.decode(readBytes(path)),
    read: (path: string): string => decoder.decode(readBytes(path)),
    readJSON: (path: string): unknown => JSON.parse(decoder.decode(readBytes(path))),
    write: (path: string, data: unknown, contentType?: string): string => writeBytes(path, data, contentType),
    writeBytes: (path: string, data: unknown, contentType?: string): string => writeBytes(path, data, contentType),
    writeText: (path: string, text: string, contentType?: string): string =>
      writeBytes(path, String(text), contentType ?? "text/plain"),
    writeJSON: (path: string, value: unknown): string =>
      writeBytes(path, JSON.stringify(value, null, 2), "application/json"),
    remove: (path: string): boolean => vfs.delete(requireKey(path)),
  };
}

// ── Network blocking ─────────────────────────────────────────────────────────

let networkPatched = false;

function patchNetwork(): void {
  if (networkPatched) return;
  networkPatched = true;

  const g = self as unknown as Record<string, unknown>;
  const originalFetch = typeof g.fetch === "function" ? (g.fetch as typeof fetch).bind(self) : undefined;

  const isRemote = (url: string) => /^(https?|wss?|ftp|ftps|ws|file):/i.test(url) || url.startsWith("//");
  const isLocalScheme = (url: string) => /^(blob|data):/i.test(url);

  const sandboxFetch = async (input: unknown, init?: unknown): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : typeof (input as { url?: string })?.url === "string"
            ? (input as { url: string }).url
            : String(input);

    if (isRemote(url)) throw new TypeError(NETWORK_DISABLED);
    // data:/blob: URLs never hit the network — serve them with the native fetch.
    if (isLocalScheme(url) && originalFetch) return originalFetch(input as RequestInfo, init as RequestInit);

    const key = normalizePath(url);
    const entry = key ? currentVfs?.get(key) : undefined;
    if (!entry) {
      return new Response(null, { status: 404, statusText: "Not Found" });
    }
    return new Response(entry.bytes as BufferSource, {
      status: 200,
      headers: { "Content-Type": entry.contentType ?? "application/octet-stream" },
    });
  };

  const blocked = () => {
    throw new TypeError(NETWORK_DISABLED);
  };

  try {
    g.fetch = sandboxFetch;
  } catch {
    // Some engines mark `fetch` non-writable on the global — best effort.
  }
  for (const name of [
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "importScripts",
    "WebTransport",
    "RTCPeerConnection",
    "Worker",
    "SharedWorker",
  ]) {
    try {
      g[name] = blocked;
    } catch {
      // Non-writable global — leave it; the worker still can't reach the page.
    }
  }
  try {
    const nav = (g.navigator ?? {}) as { sendBeacon?: unknown };
    if (nav && "sendBeacon" in nav) nav.sendBeacon = blocked;
  } catch {
    // navigator may expose read-only properties — ignore.
  }
}

// ── Bridges to the main thread (capabilities needing the chat client) ────────

function callMain<T>(build: (port: MessagePort) => WorkerToMainMessage): Promise<T> {
  const { port1, port2 } = new MessageChannel();
  return new Promise<T>((resolve, reject) => {
    port1.onmessage = (event: MessageEvent<RpcReply>) => {
      port1.close();
      const reply = event.data;
      if (reply.ok) resolve(reply.value as T);
      else reject(new Error(reply.error));
    };
    ctx.postMessage(build(port2), [port2]);
  });
}

/** Behind the `llm(prompt, options?)` helper; resolved by the main thread. */
function llm(prompt: string, options?: LlmCallOptions): Promise<string> {
  return callMain<string>((port) => ({ type: "llm-request", prompt, options, port }));
}

/**
 * The file-backed AI helpers, mirroring the Python globals. File inputs are read
 * from the VFS; file outputs are written back to it. Each is proxied to the main
 * thread (which has the chat client/config) and rejects with a clear error when
 * its backing service isn't configured. Built per-run so they bind to that run's
 * VFS.
 */
function buildBridges(vfs: Vfs) {
  const { readBytes, writeBytes } = vfsAccess(vfs);
  return {
    ocr: (path: string): Promise<string> =>
      callMain<string>((port) => ({ type: "ocr-request", data: readBytes(path), path, port })),
    vision: (path: string, prompt?: string): Promise<string> =>
      callMain<string>((port) => ({ type: "vision-request", data: readBytes(path), path, prompt, port })),
    transcribe: (path: string): Promise<string> =>
      callMain<string>((port) => ({ type: "transcribe-request", data: readBytes(path), path, port })),
    // Arg order mirrors the Python helpers: translate(text, lang) and
    // translateFile(input, lang, output).
    translate: (text: string, lang: string): Promise<string> =>
      callMain<string>((port) => ({ type: "translate-text-request", lang, text, port })),
    translateFile: async (input: string, lang: string, output: string): Promise<string> => {
      const data = await callMain<Uint8Array>((port) => ({
        type: "translate-file-request",
        lang,
        data: readBytes(input),
        path: input,
        port,
      }));
      return writeBytes(output, data);
    },
    synthesize: async (text: string, output: string, voice?: string): Promise<string> => {
      const data = await callMain<Uint8Array>((port) => ({ type: "synthesize-request", text, voice, port }));
      return writeBytes(output, data);
    },
    render: async (prompt: string, output: string, inputs: string[] = []): Promise<string> => {
      const renderInputs = inputs.map((path) => ({ data: readBytes(path), path }));
      const data = await callMain<Uint8Array>((port) => ({
        type: "render-request",
        prompt,
        inputs: renderInputs,
        port,
      }));
      return writeBytes(output, data);
    },
  };
}

/**
 * Rasterize an SVG string to PNG bytes via OffscreenCanvas — handed to user code
 * because echarts (and hand-written SVG) produce vector output but some targets
 * want a raster image.
 */
async function svgToPng(svg: string, options?: { width?: number; height?: number }): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([svg], { type: "image/svg+xml" }));
  const width = options?.width ?? bitmap.width;
  const height = options?.height ?? bitmap.height;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("svgToPng: 2D canvas context unavailable");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
}

// ── Console capture ──────────────────────────────────────────────────────────

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return value.toString();
  if (typeof value === "symbol") return value.toString();
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === "object") {
    try {
      // JSON.stringify throws on circular references — fall back to String().
      return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? `${v}n` : v), 2) ?? String(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function makeConsole(append: (line: string) => void) {
  const write = (args: unknown[]) => append(args.map((a) => formatValue(a)).join(" "));
  return {
    log: (...args: unknown[]) => write(args),
    info: (...args: unknown[]) => write(args),
    debug: (...args: unknown[]) => write(args),
    warn: (...args: unknown[]) => write(args),
    error: (...args: unknown[]) => write(args),
    table: (data: unknown) => append(formatValue(data)),
    dir: (data: unknown) => append(formatValue(data)),
    trace: (...args: unknown[]) => write(args),
    assert: (cond: unknown, ...args: unknown[]) => {
      if (!cond) append(`Assertion failed${args.length ? `: ${args.map((a) => formatValue(a)).join(" ")}` : ""}`);
    },
    group: (...args: unknown[]) => write(args),
    groupEnd: () => {},
  };
}

// ── Node-compatibility shims ─────────────────────────────────────────────────
// LLM-authored JS routinely reaches for Node globals a browser Worker doesn't
// define. We add them on `globalThis` (not as function params) so user code can
// still `const Buffer = …` without a duplicate-declaration error, and only for
// `process`/`Buffer` when a run references them — so the bundled libraries'
// own environment detection stays untouched on runs that don't.

// CommonJS `require` isn't supported (no npm in the sandbox). Provide it anyway
// so the failure is a clear, actionable message instead of a bare ReferenceError.
function sandboxRequire(name: unknown): never {
  throw new Error(
    `require(${JSON.stringify(name)}) is not available — the sandbox has no npm or CommonJS. ` +
      "Use the provided globals (vfs, llm, Buffer, mediabunny, echarts, jsPDF) and browser APIs.",
  );
}

function makeProcessStub() {
  const write = (chunk: unknown): boolean => {
    currentStdout?.(typeof chunk === "string" ? chunk : decoder.decode(toBytes(chunk)));
    return true;
  };
  const noop = () => {};
  return {
    browser: true,
    env: {} as Record<string, string | undefined>,
    argv: ["node", "sandbox.js"],
    platform: "browser",
    arch: "wasm32",
    pid: 1,
    title: "wingman-sandbox",
    version: "",
    versions: {} as Record<string, string>,
    cwd: () => "/",
    chdir: noop,
    exit: noop,
    nextTick: (cb: (...a: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => cb(...args)),
    stdout: { write, isTTY: false },
    stderr: { write, isTTY: false },
    on: noop,
    once: noop,
    off: noop,
    emit: () => false,
  };
}

async function ensureRuntimeCompat(code: string): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  // Libraries (e.g. echarts) and Node snippets read the Node-only `global` when
  // `window` is absent; a Worker has neither, so point it at globalThis.
  g.global ??= globalThis;
  g.setImmediate ??= (cb: (...a: unknown[]) => void, ...args: unknown[]) => setTimeout(cb, 0, ...args);
  // Fresh `process` each run so `process.env` writes don't leak between runs.
  if (/\bprocess\b/.test(code)) g.process = makeProcessStub();
  if (/\bBuffer\b/.test(code) && !g.Buffer) {
    try {
      g.Buffer = (await import("buffer")).Buffer;
    } catch (error) {
      console.error("Failed to load Buffer polyfill:", error);
    }
  }
}

// ── Execution ────────────────────────────────────────────────────────────────

// `new AsyncFunction(...)` lets user code use top-level await and `return` a
// value; the parameter helpers (vfs, console, …) stay lexically scoped to it.
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

// Bundled libraries injected as globals only when the code references them, so a
// run that doesn't use one pays neither its download nor its parse cost. Each
// dynamic import is a separate chunk that Vite code-splits. `name` is both the
// global handed to user code and the token matched against the source.
const LAZY_GLOBALS: { name: string; test: RegExp; load: () => Promise<unknown> }[] = [
  // Media containers + transcoding (WebCodecs based).
  { name: "mediabunny", test: /\bmediabunny\b/, load: () => import("mediabunny") },
  // Charts: headless SSR mode → SVG string (echarts.init(null, null,
  // { renderer: "svg", ssr: true, width, height }).renderToSVGString()). echarts
  // reads the Node-only `global` when `window` is absent; `ensureRuntimeCompat`
  // defines it before any library loads.
  { name: "echarts", test: /\becharts\b/, load: () => import("echarts") },
  // PDF generation: the `jsPDF` class (new jsPDF(); doc.output("arraybuffer")).
  { name: "jsPDF", test: /\bjsPDF\b/, load: async () => (await import("jspdf")).jsPDF },
];

async function executeJs(request: CodeExecutionRequest, onStarted?: () => void): Promise<CodeExecutionResult> {
  patchNetwork();
  const { code, files = {} } = request;

  const vfs = loadVfs(files);
  currentVfs = vfs;

  let output = "";
  currentStdout = (text) => {
    output += text;
  };
  const sandboxConsole = makeConsole((line) => {
    output += `${line}\n`;
  });

  // The AI helpers go on globalThis (not as AsyncFunction parameters) so user
  // code can still declare locals named `render`, `translate`, … without a
  // duplicate-parameter SyntaxError. Bound to this run's VFS; removed in finally.
  const g = globalThis as Record<string, unknown>;
  const bridges: Record<string, unknown> = { llm, ...buildBridges(vfs) };
  Object.assign(g, bridges);

  try {
    await ensureRuntimeCompat(code);

    // Resolve the bundled libraries this run actually references.
    const lazyValues = await Promise.all(
      LAZY_GLOBALS.map(async (lib) => {
        if (!lib.test.test(code)) return undefined;
        try {
          return await lib.load();
        } catch (error) {
          console.error(`Failed to load ${lib.name}:`, error);
          return undefined;
        }
      }),
    );

    // Helpers passed as parameters (kept lexically scoped). `console` must be a
    // parameter — to shadow the worker console for capture without globally
    // replacing it; the others are uncommon enough as identifiers to be safe.
    // Keep these names aligned with the argument list below.
    const paramNames = ["vfs", "console", "svgToPng", "require", ...LAZY_GLOBALS.map((lib) => lib.name)];
    const fn = new AsyncFunction(...paramNames, code);

    onStarted?.();

    const value = await fn(buildVfs(vfs), sandboxConsole, svgToPng, sandboxRequire, ...lazyValues);

    const trimmed = output.trim();
    const resolvedOutput =
      trimmed || (value !== undefined && value !== null ? formatValue(value) : "") || NO_OUTPUT_MESSAGE;

    return { success: true, output: resolvedOutput, files: collectVfs(vfs) };
  } catch (error) {
    return {
      success: false,
      output: output.trim(),
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    };
  } finally {
    for (const key of Object.keys(bridges)) delete g[key];
    currentVfs = null;
    currentStdout = null;
  }
}

// ── Message loop ─────────────────────────────────────────────────────────────
// Executions are serialized: the VFS-backed `fetch` closes over a single
// `currentVfs` slot, so concurrent runs would interleave at await points. RPC
// replies arrive on their own ports and bypass this chain.
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
    // executeJs never throws — errors come back as { success: false }.
    const result = await executeJs(request, signalStarted);
    try {
      port.postMessage({ type: "result", result } satisfies ExecuteReply);
    } catch (error) {
      // A non-cloneable result must not break the chain — report the failure on
      // the same port instead.
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
