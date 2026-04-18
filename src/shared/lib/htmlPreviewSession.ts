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

import type { File } from "@/features/artifacts/types/file";
import { isDataUrlContent } from "@/shared/lib/artifactFiles";
import { isBinaryContentType } from "@/shared/lib/fileTypes";
import { parseDataUrl } from "@/shared/lib/utils";

const SW_URL = "/html-preview-sw.js";
const SCOPE_PREFIX = "/__preview__/";

export interface PreviewFilePayload {
  content?: string;
  contentType?: string;
  bytes?: ArrayBuffer;
}

export interface PreviewSession {
  readonly token: string;
  /** Build the iframe URL for a given entry path. */
  previewUrl(entryPath: string): string;
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

function serviceWorkerSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof window !== "undefined";
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
async function waitForActivation(reg: ServiceWorkerRegistration): Promise<void> {
  if (reg.active) return;
  const sw = reg.installing || reg.waiting;
  if (!sw) return;
  await new Promise<void>((resolve) => {
    const onChange = () => {
      if (sw.state === "activated") {
        sw.removeEventListener("statechange", onChange);
        resolve();
      }
    };
    sw.addEventListener("statechange", onChange);
  });
}

async function ensureRegistration(): Promise<ServiceWorkerRegistration> {
  if (!serviceWorkerSupported()) {
    throw new Error("Service workers are not available in this context.");
  }
  if (!registrationPromise) {
    registrationPromise = (async () => {
      try {
        const reg = await navigator.serviceWorker.register(SW_URL, { scope: SCOPE_PREFIX });
        await waitForActivation(reg);
        return reg;
      } catch (error) {
        registrationPromise = null;
        throw error;
      }
    })();
  }
  return registrationPromise;
}

async function postMessage(message: unknown): Promise<void> {
  const reg = await ensureRegistration();
  const worker = reg.active;
  if (!worker) throw new Error("Service worker unavailable.");
  worker.postMessage(message);
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

  if (isDataUrlContent(file.content)) {
    const parsed = parseDataUrl(file.content);
    if (parsed) {
      const bytes = base64ToArrayBuffer(parsed.data);
      return { bytes, contentType: parsed.mimeType || contentType };
    }
  }

  if (isBinaryContentType(contentType)) {
    // Binary-ish content type but stored as text — best effort: send as text.
    return { content: file.content, contentType };
  }

  return { content: file.content, contentType };
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) {
    view[i] = binary.charCodeAt(i);
  }
  return buffer;
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

export async function createPreviewSession(): Promise<PreviewSession> {
  await ensureRegistration();
  const token = generateToken();
  let destroyed = false;

  const session: PreviewSession = {
    token,

    previewUrl(entryPath: string): string {
      const path = encodePreviewPath(entryPath || "index.html");
      return `${SCOPE_PREFIX}${encodeURIComponent(token)}/${path}`;
    },

    async setFiles(input) {
      if (destroyed) return;
      const filesMap: Record<string, PreviewFilePayload> = {};
      const entries = Array.isArray(input) ? input : Object.values(input);
      for (const file of entries) {
        if (!file?.path) continue;
        const key = normalizeInputPath(file.path);
        if (!key) continue;
        filesMap[key] = toPayload(file);
      }
      await postMessage({
        type: "html-preview/register",
        token,
        files: filesMap,
      });
    },

    async updateFile(path, file) {
      if (destroyed) return;
      const key = normalizeInputPath(path);
      if (!key) return;
      await postMessage({
        type: "html-preview/update",
        token,
        path: key,
        file: toPayload(file),
      });
    },

    async deleteFile(path) {
      if (destroyed) return;
      const key = normalizeInputPath(path);
      if (!key) return;
      await postMessage({
        type: "html-preview/delete",
        token,
        path: key,
      });
    },

    async renameFile(fromPath, toPath) {
      if (destroyed) return;
      const fromKey = normalizeInputPath(fromPath);
      const toKey = normalizeInputPath(toPath);
      if (!fromKey || !toKey) return;
      await postMessage({
        type: "html-preview/rename",
        token,
        fromPath: fromKey,
        toPath: toKey,
      });
    },

    async destroy() {
      if (destroyed) return;
      destroyed = true;
      try {
        await postMessage({ type: "html-preview/unregister", token });
      } catch {
        // Ignore — SW may already be gone.
      }
    },
  };

  return session;
}
