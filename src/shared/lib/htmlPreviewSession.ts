/**
 * Artifact Preview Session
 *
 * Helper for registering artifact files with the artifact-preview service
 * worker so they can be served as real HTTP-like resources under
 * `/__preview__/{token}/{path}`.
 *
 * Usage:
 *   const session = await createPreviewSession();
 *   await session.setFiles(files);
 *   iframe.src = session.previewUrl("index.html");
 *   ...
 *   session.updateFile(path, file);
 *   session.deleteFile(path);
 *   session.destroy();
 */

import { artifactLibraryUrls, rewriteAbsoluteLibraryReferences } from "@/shared/lib/artifactLibraries";
import { injectSdkScript } from "@/shared/lib/artifactSdk/inject";
import { SDK_PATH, SDK_PREFIX, type SdkCapabilities } from "@/shared/lib/artifactSdk/protocol";
import { isDataUrl } from "@/shared/lib/fileContent";
import { isBinaryContentType } from "@/shared/lib/fileTypes";
import { decodeBase64, parseDataUrl } from "@/shared/lib/utils";
import { withAbort } from "./abortSignals";
import { requestPortReply } from "./messagePortRpc";
import type { File } from "@/shared/types/file";

const SW_URL = "/html-preview-sw.js";
const SCOPE_PREFIX = "/__preview__/";
const WORKER_TIMEOUT_MS = 10_000;

export interface PreviewFilePayload {
  content?: string;
  contentType?: string;
  bytes?: ArrayBuffer;
}

/** Serve `window.wingman` into the session's HTML documents. */
export interface PreviewSdkOptions {
  /** The built SDK script (virtual:artifact-library-source/wingman-sdk). */
  source: string;
  capabilities: SdkCapabilities;
}

export interface PreviewSessionOptions {
  signal?: AbortSignal;
  sdk?: PreviewSdkOptions;
}

export interface PreviewSession {
  readonly token: string;
  /** Build the iframe URL for a given entry path. */
  previewUrl(entryPath: string): string;
  /** Change what the injected SDK advertises; re-serves every HTML document. */
  setCapabilities(capabilities: SdkCapabilities): Promise<void>;
  /** Register (or replace) the full file set for this session. */
  setFiles(files: File[] | Record<string, File>): Promise<void>;
  /** Upsert a single file. */
  updateFile(path: string, file: File): Promise<void>;
  /** Remove a single file. */
  deleteFile(path: string): Promise<void>;
  /** Rename / move (single file or folder). */
  renameFile(fromPath: string, toPath: string): Promise<void>;
  /** Tear down the session; any further calls become no-ops. */
  destroy(): Promise<void>;
}

let registrationPromise: Promise<ServiceWorkerRegistration> | null = null;
const sessionSnapshots = new Map<string, { files: Map<string, PreviewFilePayload>; revision: () => number }>();
let recoveryListenerInstalled = false;

function serviceWorkerSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof window !== "undefined";
}

/**
 * Service workers are disposable: the browser may stop one while the page is
 * still open, losing its in-memory session map. Keep the authoritative snapshot
 * in the page and let a restarted worker request it before serving a 404.
 */
function ensureRecoveryListener(): void {
  if (recoveryListenerInstalled || !serviceWorkerSupported()) return;
  recoveryListenerInstalled = true;

  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "html-preview/recover-request") return;
    const port = event.ports?.[0];
    if (!port) return;

    const snapshot = sessionSnapshots.get(String(event.data.token ?? ""));
    try {
      port.postMessage(
        snapshot
          ? {
              ok: true,
              files: Object.fromEntries(snapshot.files),
              revision: snapshot.revision(),
              libraries: artifactLibraryUrls(),
            }
          : { ok: false },
      );
    } catch {
      // Recovery may finish after its requesting worker has stopped.
    } finally {
      port.close();
    }
  });
}

/**
 * Wait for the registration's worker to reach the `activated` state.
 *
 * We can't use `navigator.serviceWorker.ready` here: it resolves with the
 * registration that controls the *current page*, but our SW's scope is
 * `/__preview__/` (the main app is served from `/`), so this page is never
 * controlled. The SW is still fully functional for fetches made from within
 * its scope (i.e. the preview iframe).
 */
async function waitForActivation(reg: ServiceWorkerRegistration, signal: AbortSignal): Promise<void> {
  const worker = reg.active || reg.installing || reg.waiting;
  if (!worker) throw new Error("Service worker unavailable.");
  if (worker.state === "activated") return;
  let onChange!: () => void;
  try {
    await withAbort(
      signal,
      () =>
        new Promise<void>((resolve, reject) => {
          onChange = () => {
            if (worker.state === "activated") resolve();
            else if (worker.state === "redundant") reject(new Error("Preview service worker activation failed."));
          };
          worker.addEventListener("statechange", onChange);
          onChange();
        }),
    );
  } finally {
    if (onChange) worker.removeEventListener("statechange", onChange);
  }
}

async function ensureRegistration(): Promise<ServiceWorkerRegistration> {
  if (!serviceWorkerSupported()) throw new Error("Service workers are not available in this context.");
  if (!registrationPromise) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error("Preview service worker activation timed out.")),
      WORKER_TIMEOUT_MS,
    );
    const pending = withAbort(controller.signal, async () => {
      const reg = await navigator.serviceWorker.register(SW_URL, { scope: SCOPE_PREFIX });
      await waitForActivation(reg, controller.signal);
      return reg;
    });
    registrationPromise = pending;
    void pending
      .catch(() => {
        if (registrationPromise === pending) registrationPromise = null;
      })
      .finally(() => clearTimeout(timer));
  }
  return registrationPromise;
}

async function postMessage(message: unknown, signal?: AbortSignal): Promise<void> {
  const reg = signal ? await withAbort(signal, ensureRegistration) : await ensureRegistration();
  signal?.throwIfAborted();
  const worker = reg.active;
  if (!worker || worker.state === "redundant") {
    registrationPromise = null;
    throw new Error("Service worker unavailable.");
  }
  const data = await requestPortReply<{ ok: boolean; error?: string }>((port) => worker.postMessage(message, [port]), {
    signal,
    timeoutMs: WORKER_TIMEOUT_MS,
    timeoutMessage: "Preview service worker stopped responding.",
  });
  if (!data?.ok) throw new Error(data?.error || "Service worker rejected message");
}

function generateToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback (very unlikely in modern browsers):
  return `tok-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

/**
 * Convert an artifact `File` into a payload the SW can serve directly.
 * Decodes data URLs to raw bytes so the browser sees a proper binary response.
 */
export function toPayload(file: File): PreviewFilePayload {
  const contentType = file.contentType || inferContentType(file.path) || "text/plain;charset=utf-8";

  if (isDataUrl(file.content)) {
    const parsed = parseDataUrl(file.content);
    if (parsed) {
      const bytes = decodeBase64(parsed.data).buffer as ArrayBuffer;
      return { bytes, contentType: parsed.mimeType || contentType };
    }
  }

  if (isBinaryContentType(contentType)) {
    // Binary-ish content type but stored as text — best effort: send as text.
    return { content: file.content, contentType };
  }

  return { content: file.content, contentType };
}

function inferContentType(path: string): string | undefined {
  const idx = path.lastIndexOf(".");
  if (idx < 0) return undefined;
  const ext = path.slice(idx + 1).toLowerCase();
  switch (ext) {
    case "html":
    case "htm":
      return "text/html;charset=utf-8";
    case "css":
      return "text/css;charset=utf-8";
    case "js":
    case "mjs":
      return "text/javascript;charset=utf-8";
    case "json":
      return "application/json;charset=utf-8";
    case "svg":
      return "image/svg+xml";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "ico":
      return "image/x-icon";
    case "txt":
    case "md":
      return "text/plain;charset=utf-8";
    case "wasm":
      return "application/wasm";
    default:
      return undefined;
  }
}

function normalizeInputPath(path: string): string {
  return path.replace(/^\.\//, "").replace(/^\/+/, "");
}

/** Encode a path for safe use in a URL, preserving "/" separators. */
export function encodePreviewPath(path: string): string {
  const normalized = normalizeInputPath(path);
  return normalized.split("/").map(encodeURIComponent).join("/");
}

export async function createPreviewSession(options: PreviewSessionOptions = {}): Promise<PreviewSession> {
  if (options.signal) await withAbort(options.signal, ensureRegistration);
  else await ensureRegistration();
  ensureRecoveryListener();
  const token = generateToken();
  let destroyed = false;
  let closing: Promise<void> | undefined;
  let revision = 0;
  const controller = new AbortController();
  // `originals` holds files as the artifact stores them; `snapshot` is what the
  // worker serves, with the SDK script tag added to HTML documents.
  const originals = new Map<string, PreviewFilePayload>();
  const snapshot = new Map<string, PreviewFilePayload>();
  sessionSnapshots.set(token, { files: snapshot, revision: () => revision });
  const sdk = options.sdk;
  let capabilities = sdk?.capabilities;

  const isReserved = (key: string) => key.startsWith(SDK_PREFIX);
  // `/.lib/x.js` would leave the worker's scope; point it at this session instead.
  const sessionRoot = `${SCOPE_PREFIX}${encodeURIComponent(token)}/`;
  const decorate = (key: string, payload: PreviewFilePayload): PreviewFilePayload => {
    if (payload.content === undefined || !payload.contentType?.toLowerCase().startsWith("text/html")) return payload;
    let content = rewriteAbsoluteLibraryReferences(payload.content, sessionRoot);
    if (sdk && capabilities) content = injectSdkScript(content, { token, path: `/${key}`, capabilities });
    return { ...payload, content };
  };
  const rebuild = () => {
    snapshot.clear();
    for (const [key, payload] of originals) snapshot.set(key, decorate(key, payload));
    if (sdk) snapshot.set(SDK_PATH, { content: sdk.source, contentType: "text/javascript;charset=utf-8" });
  };

  const session: PreviewSession = {
    token,

    previewUrl(entryPath: string): string {
      const path = encodePreviewPath(entryPath || "index.html");
      return `${SCOPE_PREFIX}${encodeURIComponent(token)}/${path}`;
    },

    async setCapabilities(next) {
      if (destroyed || !sdk) return;
      if (JSON.stringify(next) === JSON.stringify(capabilities)) return;
      capabilities = next;
      rebuild();
      await postMessage(
        {
          type: "html-preview/register",
          token,
          revision: ++revision,
          files: Object.fromEntries(snapshot),
          libraries: artifactLibraryUrls(),
        },
        controller.signal,
      );
    },

    async setFiles(input) {
      if (destroyed) return;
      originals.clear();
      const entries = Array.isArray(input) ? input : Object.values(input);
      for (const file of entries) {
        if (!file?.path) continue;
        const key = normalizeInputPath(file.path);
        if (!key || isReserved(key)) continue;
        originals.set(key, toPayload(file));
      }
      rebuild();
      await postMessage(
        {
          type: "html-preview/register",
          token,
          revision: ++revision,
          files: Object.fromEntries(snapshot),
          // Bundled libraries served for `.lib/<name>` references; see artifactLibraries.ts.
          libraries: artifactLibraryUrls(),
        },
        controller.signal,
      );
    },

    async updateFile(path, file) {
      if (destroyed) return;
      const key = normalizeInputPath(path);
      if (!key || isReserved(key)) return;
      const original = toPayload(file);
      originals.set(key, original);
      const payload = decorate(key, original);
      snapshot.set(key, payload);
      await postMessage(
        {
          type: "html-preview/update",
          token,
          revision: ++revision,
          path: key,
          file: payload,
        },
        controller.signal,
      );
    },

    async deleteFile(path) {
      if (destroyed) return;
      const key = normalizeInputPath(path);
      if (!key || isReserved(key)) return;
      for (const entry of originals.keys()) {
        if (entry === key || entry.startsWith(`${key}/`)) {
          originals.delete(entry);
          snapshot.delete(entry);
        }
      }
      await postMessage(
        {
          type: "html-preview/delete",
          token,
          revision: ++revision,
          path: key,
        },
        controller.signal,
      );
    },

    async renameFile(fromPath, toPath) {
      if (destroyed) return;
      const fromKey = normalizeInputPath(fromPath);
      const toKey = normalizeInputPath(toPath);
      if (!fromKey || !toKey || isReserved(fromKey) || isReserved(toKey)) return;
      const entry = originals.get(fromKey);
      if (entry) {
        originals.delete(fromKey);
        originals.set(toKey, entry);
      }
      const folderPrefix = `${fromKey}/`;
      const toPrefix = `${toKey}/`;
      for (const key of Array.from(originals.keys())) {
        if (!key.startsWith(folderPrefix)) continue;
        const child = originals.get(key);
        originals.delete(key);
        if (child) originals.set(`${toPrefix}${key.slice(folderPrefix.length)}`, child);
      }
      // The injected tag carries the document's own path, so HTML must be re-decorated.
      rebuild();
      await postMessage(
        {
          type: "html-preview/register",
          token,
          revision: ++revision,
          files: Object.fromEntries(snapshot),
          libraries: artifactLibraryUrls(),
        },
        controller.signal,
      );
    },

    destroy() {
      if (closing) return closing;
      destroyed = true;
      controller.abort();
      options.signal?.removeEventListener("abort", abort);
      sessionSnapshots.delete(token);
      originals.clear();
      snapshot.clear();
      closing = postMessage({ type: "html-preview/unregister", token }).catch(() => {
        // The browser may already have discarded the worker and its sessions.
      });
      return closing;
    },
  };

  const abort = () => {
    void session.destroy();
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) await session.destroy();
  return session;
}
