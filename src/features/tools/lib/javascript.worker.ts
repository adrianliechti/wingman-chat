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
 *     `mediabunny` module is injected lazily when the code references it.
 *   - The `llm(...)` helper is proxied to the main thread over RPC (it needs the
 *     chat client/config), mirroring the Python `llm` global.
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

// The `vfs` helper handed to user code. Paths are artifact paths (leading
// slash); inputs are normalized so "data.csv", "/data.csv", and
// "/home/user/data.csv" all resolve to the same file.
function buildVfs(vfs: Vfs) {
  const requireKey = (path: string): string => {
    const key = normalizePath(path);
    if (!key) throw new Error(`invalid path: ${path}`);
    return key;
  };
  const readEntry = (path: string): VfsEntry => {
    const entry = vfs.get(requireKey(path));
    if (!entry) throw new Error(`file not found: ${path}`);
    return entry;
  };
  const writeBytes = (path: string, data: unknown, contentType?: string): void => {
    const key = requireKey(path);
    const bytes = toBytes(data);
    const ct = contentType ?? inferContentTypeFromPath(key) ?? (typeof data === "string" ? "text/plain" : undefined);
    vfs.set(key, { bytes, contentType: ct, dirty: true });
  };
  return {
    list: (): string[] => [...vfs.keys()].sort(),
    exists: (path: string): boolean => vfs.has(requireKey(path)),
    readBytes: (path: string): Uint8Array => readEntry(path).bytes,
    readText: (path: string): string => decoder.decode(readEntry(path).bytes),
    read: (path: string): string => decoder.decode(readEntry(path).bytes),
    readJSON: (path: string): unknown => JSON.parse(decoder.decode(readEntry(path).bytes)),
    write: (path: string, data: unknown, contentType?: string): void => writeBytes(path, data, contentType),
    writeBytes,
    writeText: (path: string, text: string, contentType?: string): void =>
      writeBytes(path, String(text), contentType ?? "text/plain"),
    writeJSON: (path: string, value: unknown): void =>
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

// ── Console capture ──────────────────────────────────────────────────────────

function formatValue(value: unknown, seen = new WeakSet<object>()): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return value.toString();
  if (typeof value === "symbol") return value.toString();
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    try {
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

// ── Execution ────────────────────────────────────────────────────────────────

// `new AsyncFunction(...)` lets user code use top-level await and `return` a
// value, while keeping injected helpers out of the global namespace.
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

async function executeJs(request: CodeExecutionRequest, onStarted?: () => void): Promise<CodeExecutionResult> {
  patchNetwork();
  const { code, files = {} } = request;

  const vfs = loadVfs(files);
  currentVfs = vfs;

  let output = "";
  const sandboxConsole = makeConsole((line) => {
    output += `${line}\n`;
  });

  try {
    // Inject the bundled media library only when referenced — it pulls in a
    // WebCodecs-heavy chunk we don't want to load on every run.
    let mediabunny: unknown;
    if (/\bmediabunny\b/.test(code)) {
      try {
        mediabunny = await import("mediabunny");
      } catch (error) {
        console.error("Failed to load mediabunny:", error);
      }
    }

    const fn = new AsyncFunction("vfs", "console", "llm", "mediabunny", code);

    onStarted?.();

    const value = await fn(buildVfs(vfs), sandboxConsole, llm, mediabunny);

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
    currentVfs = null;
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
