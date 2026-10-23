/**
 * Host side of `window.wingman` for shared pages. The page is someone else's
 * code, so it runs in a sandboxed frame with an opaque origin and reaches the
 * app only through these RPCs. The viewer is the signed-in client: AI helpers
 * run as the person viewing, files are the share's (read-only), the store lasts
 * for the visit and SQL runs over the share's data files. Helpers that save
 * files and chat tools stay in the app.
 */

import { runLlm } from "@/features/tools/lib/llmCommand";
import { runOcr } from "@/features/tools/lib/ocrCommand";
import { runTranscribe } from "@/features/tools/lib/transcribeCommand";
import { runTranslateText } from "@/features/tools/lib/translateCommand";
import { runVision } from "@/features/tools/lib/visionCommand";
import { withAbort } from "@/shared/lib/abortSignals";
import {
  isSdkRpcRequest,
  isSdkDocumentEvent,
  SDK_PREFIX,
  type SdkCapabilityName,
  type SdkRpcReply,
} from "@/shared/lib/artifactSdk/protocol";
import { isMountablePath } from "@/shared/lib/dataFiles";
import { createDuckDbHost, type DuckDbHost, type DuckDbMount, mountNames } from "@/shared/lib/duckdbHost";
import { normalizeArtifactPath } from "@/shared/lib/sandbox";
import { type ShareManifest, shareFileUrl } from "./manifest";

export type DuckDbHostFactory = (mount: DuckDbMount) => DuckDbHost;

interface Frame {
  readonly contentWindow: Window | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function text(value: unknown, name: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === undefined || value === null) return "";
  throw new TypeError(`${name} must be a string.`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ShareBridge {
  private readonly manifest: ShareManifest;
  private readonly createHost: DuckDbHostFactory;
  /** Workspace paths (`/data/sales.csv`) the page may read. */
  private readonly files: Set<string>;
  private readonly store = new Map<string, unknown>();
  private documentId: string | null = null;
  private readonly retired = new Set<string>();
  /** The current document's lifetime: requests, SQL and AI calls end with it. */
  private controller = new AbortController();
  private duckdb: DuckDbHost | null = null;

  constructor(manifest: ShareManifest, createHost: DuckDbHostFactory = (mount) => createDuckDbHost(mount)) {
    this.manifest = manifest;
    this.createHost = createHost;
    this.files = new Set(manifest.files.map((path) => `/${path.replace(/^\/+/, "")}`));
  }

  /** Answer RPCs from the page in `frame`; nothing else can address the bridge. */
  attach(frame: Frame, target: Window = window): () => void {
    const onMessage = (event: MessageEvent) => {
      if (!event.source || event.source !== frame.contentWindow) return;
      if (isSdkDocumentEvent(event.data) && event.data.token === this.manifest.id) {
        if (event.data.active) this.activate(event.data.documentId);
        else if (event.data.documentId === this.documentId) this.release();
        return;
      }
      if (!isSdkRpcRequest(event.data) || event.data.token !== this.manifest.id) return;
      const port = event.ports[0];
      if (!port) return;
      const reply = (message: SdkRpcReply) => {
        try {
          port.postMessage(message);
        } catch {
          // The page may have navigated away and closed its end.
        }
        port.close();
      };
      void this.dispatch(event.data.documentId, event.data.method, event.data.params).then(
        (value) => reply({ ok: true, value }),
        (error: unknown) => reply({ ok: false, error: errorMessage(error) }),
      );
    };
    target.addEventListener("message", onMessage);
    return () => {
      target.removeEventListener("message", onMessage);
      this.release();
    };
  }

  /**
   * One document lives in the frame at a time, so a new document id means the
   * page navigated: the previous document's work ends with it.
   */
  dispatch(documentId: string, method: string, params: unknown[]): Promise<unknown> {
    if (!this.activate(documentId)) return Promise.reject(new Error("Artifact document is no longer active"));
    const signal = this.controller.signal;
    return withAbort(signal, () => this.invoke(method, params, signal));
  }

  private activate(documentId: string): boolean {
    if (this.retired.has(documentId)) return false;
    if (documentId !== this.documentId) {
      this.release();
      this.documentId = documentId;
    }
    return true;
  }

  private release(): void {
    if (this.documentId) this.retired.add(this.documentId);
    this.documentId = null;
    this.reset();
  }

  private reset(): void {
    this.controller.abort(new DOMException("Artifact document is no longer active", "AbortError"));
    this.controller = new AbortController();
    this.duckdb?.dispose();
    this.duckdb = null;
  }

  private require(name: SdkCapabilityName): void {
    if (!this.manifest.capabilities[name]) throw new Error(`wingman.${name} is not available on shared pages.`);
  }

  private normalize(path: unknown): string {
    if (typeof path !== "string") throw new TypeError("An artifact path is required.");
    const normalized = normalizeArtifactPath(path);
    if (!normalized) throw new Error(`Invalid artifact path: ${path}`);
    if (normalized.startsWith(`/${SDK_PREFIX}`)) throw new Error(`${normalized} is reserved.`);
    return normalized;
  }

  private async fetchFile(path: string, signal: AbortSignal): Promise<Response> {
    if (!this.files.has(path)) throw new Error(`File not found: ${path}`);
    const response = await fetch(shareFileUrl(this.manifest.id, path), { signal });
    if (!response.ok) throw new Error(`File not found: ${path}`);
    return response;
  }

  private async readBytes(path: string, signal: AbortSignal): Promise<Uint8Array> {
    return new Uint8Array(await (await this.fetchFile(path, signal)).arrayBuffer());
  }

  private storeKey(key: unknown): string {
    if (typeof key !== "string" || !key) throw new TypeError("A store key is required.");
    if (key.startsWith(SDK_PREFIX)) throw new Error(`${key} is reserved.`);
    return key;
  }

  private host(): DuckDbHost {
    if (this.duckdb) return this.duckdb;
    const { id } = this.manifest;
    const paths = [...this.files].filter(isMountablePath);
    let mounted = false;
    // Shares never change: mount once, read over HTTP ranges instead of downloading whole files.
    this.duckdb = this.createHost(async (db, registered, signal) => {
      if (mounted) return;
      const { DuckDBDataProtocol } = await import("@duckdb/duckdb-wasm");
      for (const [path, names] of mountNames(paths)) {
        const url = new URL(shareFileUrl(id, path), location.href).href;
        for (const name of names) {
          signal.throwIfAborted();
          await db.registerFileURL(name, url, DuckDBDataProtocol.HTTP, false);
          registered.add(name);
        }
      }

      // Mounted names are an allowlist, not a network boundary: SQL readers
      // otherwise accept arbitrary URLs and send the viewer's cookies. Apply
      // DuckDB's file restrictions before running any page-provided SQL and
      // lock them so SET/RESET cannot grant access again.
      const connection = await db.connect();
      try {
        // XLSX normally autoloads this bundled extension. Load it before
        // disabling external access; shared pages cannot install extensions.
        if (paths.some((path) => /\.xlsx$/i.test(path))) await connection.query("LOAD excel");
        const allowed = [...registered].map((name) => `'${name.replace(/'/g, "''")}'`).join(", ");
        await connection.query(`SET allowed_paths = [${allowed}]::VARCHAR[]`);
        await connection.query("SET autoinstall_known_extensions = false");
        await connection.query("SET autoload_known_extensions = false");
        await connection.query("SET enable_external_access = false");
        await connection.query("SET lock_configuration = true");
      } finally {
        if (!signal.aborted) await connection.close();
      }
      mounted = true;
    });
    return this.duckdb;
  }

  private async invoke(method: string, params: unknown[], signal: AbortSignal): Promise<unknown> {
    switch (method) {
      case "llm": {
        this.require("llm");
        const [prompt, options] = params;
        return runLlm(text(prompt, "prompt"), isRecord(options) ? options : {}, { signal });
      }
      case "vision": {
        this.require("vision");
        const path = this.normalize(params[0]);
        const prompt = typeof params[1] === "string" ? params[1] : undefined;
        return runVision(await this.readBytes(path, signal), path, prompt, { signal });
      }
      case "ocr": {
        this.require("ocr");
        const path = this.normalize(params[0]);
        return runOcr(await this.readBytes(path, signal), path, { signal });
      }
      case "translate":
        this.require("translate");
        return runTranslateText(text(params[1], "lang"), text(params[0], "text"), { signal });
      case "transcribe": {
        this.require("transcribe");
        const path = this.normalize(params[0]);
        return runTranscribe(await this.readBytes(path, signal), path, { signal });
      }
      // These save their output into the workspace.
      case "translateFile":
      case "render":
      case "synthesize":
        throw new Error("Shared pages are read-only.");

      case "files.list":
        this.require("files");
        return [...this.files].sort();
      case "files.exists":
        this.require("files");
        return this.files.has(this.normalize(params[0]));
      case "files.read":
        this.require("files");
        return this.readBytes(this.normalize(params[0]), signal);
      case "files.readText":
        this.require("files");
        return (await this.fetchFile(this.normalize(params[0]), signal)).text();
      case "files.readJSON":
        this.require("files");
        return JSON.parse(await (await this.fetchFile(this.normalize(params[0]), signal)).text()) as unknown;
      case "files.write":
      case "files.writeText":
      case "files.writeJSON":
      case "files.remove":
        this.require("files");
        throw new Error("Shared pages are read-only.");
      case "rasterizePdf": {
        this.require("files");
        const options = isRecord(params[1]) ? params[1] : {};
        const bytes = await this.readBytes(this.normalize(params[0]), signal);
        const { rasterizePdf } = await import("@/shared/lib/pdf");
        return rasterizePdf(bytes, {
          signal,
          pages: Array.isArray(options.pages) ? (options.pages as number[]) : undefined,
          scale: typeof options.scale === "number" ? options.scale : undefined,
        });
      }

      case "store.get":
        this.require("store");
        return this.store.get(this.storeKey(params[0])) ?? null;
      case "store.set": {
        this.require("store");
        const key = this.storeKey(params[0]);
        if (params[1] === undefined) this.store.delete(key);
        else this.store.set(key, params[1]);
        return true;
      }
      case "store.remove":
        this.require("store");
        this.store.delete(this.storeKey(params[0]));
        return true;
      case "store.keys":
        this.require("store");
        return [...this.store.keys()];

      case "duckdb.connect":
        this.require("duckdb");
        return this.host().connect();
      case "duckdb.close":
        this.require("duckdb");
        return this.host().close(text(params[0], "connection"));
      case "duckdb.query": {
        this.require("duckdb");
        const [id, sql, args] = params;
        return this.host().query(
          typeof id === "string" ? id : null,
          text(sql, "sql"),
          Array.isArray(args) ? args : undefined,
        );
      }
      case "duckdb.files":
        this.require("duckdb");
        return this.host().files();

      case "tools.list":
      case "tools.call":
        throw new Error("wingman.tools is not available on shared pages.");

      default:
        throw new Error(`Unknown wingman method: ${method}`);
    }
  }
}
