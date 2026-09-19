/**
 * Host side of `window.wingman`: answers RPC requests posted by an HTML
 * artifact page from its preview iframe. Media helpers reuse the interpreter
 * command runners; files go through the workspace; state lives in the
 * per-artifact store; SQL runs on the app's DuckDB with the workspace mounted.
 *
 * The preview is same-origin by necessity (service workers do not control
 * opaque-origin frames), so the token only routes messages to the right
 * bridge and the tool consent is a courtesy, not a security boundary.
 */

import { runLlm } from "@/features/tools/lib/llmCommand";
import { runOcr } from "@/features/tools/lib/ocrCommand";
import { runRenderImage } from "@/features/tools/lib/renderCommand";
import { runSynthesize } from "@/features/tools/lib/synthesizeCommand";
import { runTranscribe } from "@/features/tools/lib/transcribeCommand";
import { runTranslateFile, runTranslateText } from "@/features/tools/lib/translateCommand";
import { runVision } from "@/features/tools/lib/visionCommand";
import type { BridgeRequestOptions } from "@/features/tools/lib/workerHost";
import { getConfig } from "@/shared/config";
import {
  isSdkRpcRequest,
  SDK_HELLO_TYPE,
  SDK_PREFIX,
  type SdkCapabilities,
  type SdkCapabilityName,
  type SdkRpcReply,
} from "@/shared/lib/artifactSdk/protocol";
import { bytesToDataUrl, dataUrlToBytes } from "@/shared/lib/fileContent";
import { inferContentTypeFromPath } from "@/shared/lib/fileTypes";
import {
  ARTIFACT_STATE_RESERVED_PREFIX,
  readArtifactState,
  updateArtifactState,
} from "@/shared/lib/opfs-artifact-state";
import { normalizeArtifactPath } from "@/shared/lib/sandbox";
import type { Tool, ToolContext } from "@/shared/types/chat";
import { acquireDuckDbWorkspace, type DuckDbWorkspaceHost } from "./duckdbWorkspace";
import type { FileSystemManager, OverlayDelta } from "./fs";

export interface ArtifactBridgeOptions {
  fs: FileSystemManager;
  /** The artifact page's path, e.g. `/dashboard.html`. */
  path: string;
  capabilities: SdkCapabilities;
  /** Tools the page may call once the user agreed (the chat's enabled tools). */
  tools: () => Tool[];
  /** Ask the user to allow tool calls from this page; resolves with the decision. */
  consent: (toolNames: string[]) => Promise<boolean>;
  /** Default model for `llm`. */
  model: () => string | null;
}

/** A page write is not reloaded back into the same page within this window. */
const RECENT_WRITE_MS = 2000;
const CONSENT_KEY = `${ARTIFACT_STATE_RESERVED_PREFIX}tools-consent`;

type Config = ReturnType<typeof getConfig>;

export function resolveCapabilities(config: Config = getConfig(), options: { tools?: boolean } = {}): SdkCapabilities {
  return {
    llm: true,
    vision: !!config.vision,
    ocr: !!config.extractor,
    translate: !!config.translator,
    render: !!config.renderer,
    synthesize: !!config.tts,
    transcribe: !!config.stt,
    files: true,
    store: true,
    tools: !!options.tools,
    duckdb: config.artifacts?.duckdb !== false,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** A required string argument; numbers and booleans are accepted, objects are not. */
function text(value: unknown, name: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === undefined || value === null) return "";
  throw new TypeError(`${name} must be a string.`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ArtifactBridge {
  private readonly options: ArtifactBridgeOptions;
  private capabilities: SdkCapabilities;
  private readonly recentWrites = new Map<string, number>();
  private duckdb: Promise<DuckDbWorkspaceHost> | null = null;
  private controller = new AbortController();
  private detachListeners: (() => void) | null = null;
  private frame: { iframe: HTMLIFrameElement; token: string } | null = null;

  constructor(options: ArtifactBridgeOptions) {
    this.options = options;
    this.capabilities = options.capabilities;
  }

  /** Answer requests from `iframe` carrying `token`; returns a detach function. */
  attach(iframe: HTMLIFrameElement, token: string): () => void {
    this.detach();
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== iframe.contentWindow) return;
      if (!isSdkRpcRequest(event.data) || event.data.token !== token) return;
      const port = event.ports[0];
      if (!port) return;
      this.dispatch(event.data.method, event.data.params).then(
        (value) => port.postMessage({ ok: true, value } satisfies SdkRpcReply),
        (error: unknown) => port.postMessage({ ok: false, error: errorMessage(error) } satisfies SdkRpcReply),
      );
    };
    const onLoad = () => this.hello();
    window.addEventListener("message", onMessage);
    iframe.addEventListener("load", onLoad);
    this.frame = { iframe, token };
    this.detachListeners = () => {
      window.removeEventListener("message", onMessage);
      iframe.removeEventListener("load", onLoad);
    };
    return () => this.detach();
  }

  detach(): void {
    this.detachListeners?.();
    this.detachListeners = null;
    this.frame = null;
    this.controller.abort();
    this.controller = new AbortController();
    const host = this.duckdb;
    this.duckdb = null;
    void host?.then((value) => value.release()).catch(() => undefined);
  }

  setCapabilities(capabilities: SdkCapabilities): void {
    this.capabilities = capabilities;
    this.hello();
  }

  /** Whether the page itself wrote `path` a moment ago (so a reload would be self-inflicted). */
  recentlyWrote(path: string): boolean {
    const normalized = normalizeArtifactPath(path);
    const at = normalized ? this.recentWrites.get(normalized) : undefined;
    return at !== undefined && Date.now() - at < RECENT_WRITE_MS;
  }

  private hello(): void {
    if (!this.frame) return;
    this.frame.iframe.contentWindow?.postMessage(
      { type: SDK_HELLO_TYPE, token: this.frame.token, capabilities: this.capabilities },
      location.origin,
    );
  }

  private require(name: SdkCapabilityName): void {
    if (!this.capabilities[name]) throw new Error(`wingman.${name} is not available in this workspace.`);
  }

  private requestOptions(): BridgeRequestOptions {
    const signal = this.controller.signal;
    return {
      signal,
      context: { chatId: this.options.fs.chatId, model: this.options.model() ?? undefined },
    };
  }

  private normalize(path: unknown): string {
    if (typeof path !== "string") throw new TypeError("An artifact path is required.");
    const normalized = normalizeArtifactPath(path);
    if (!normalized) throw new Error(`Invalid artifact path: ${path}`);
    if (normalized.startsWith(`/${SDK_PREFIX}`)) throw new Error(`${normalized} is reserved.`);
    return normalized;
  }

  private async readBytes(path: string): Promise<Uint8Array> {
    const file = await this.options.fs.getFile(path);
    if (!file) throw new Error(`File not found: ${path}`);
    return dataUrlToBytes(file.content)?.bytes ?? new TextEncoder().encode(file.content);
  }

  private async readText(path: string): Promise<string> {
    const file = await this.options.fs.getFile(path);
    if (!file) throw new Error(`File not found: ${path}`);
    const decoded = dataUrlToBytes(file.content);
    return decoded ? new TextDecoder().decode(decoded.bytes) : file.content;
  }

  private async write(path: string, data: unknown, contentType?: unknown): Promise<string> {
    const type = typeof contentType === "string" ? contentType : undefined;
    let content: string;
    let resolvedType = type;
    if (typeof data === "string") {
      content = data;
      resolvedType ??= inferContentTypeFromPath(path);
    } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      const bytes =
        data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      resolvedType ??= inferContentTypeFromPath(path) ?? "application/octet-stream";
      content = bytesToDataUrl(bytes, resolvedType);
    } else {
      throw new TypeError("write() takes a string, an ArrayBuffer or a typed array.");
    }
    await this.commit({ upserts: { [path]: { content, contentType: resolvedType } }, deletes: [] });
    return path;
  }

  private async commit(delta: OverlayDelta): Promise<void> {
    // The model is deliberately not told about these writes: if it edits a
    // file the page changed, the staleness check makes it read again first.
    await this.options.fs.applyOverlayDelta(delta, { origin: { actor: "system", reason: "bridge" } });
    const now = Date.now();
    for (const path of [...Object.keys(delta.upserts), ...delta.deletes]) this.recentWrites.set(path, now);
  }

  private assertStoreKey(key: unknown): string {
    if (typeof key !== "string" || !key) throw new TypeError("A store key is required.");
    if (key.startsWith(ARTIFACT_STATE_RESERVED_PREFIX)) throw new Error(`${key} is reserved.`);
    return key;
  }

  private async ensureToolConsent(): Promise<void> {
    const { fs, path, consent, tools } = this.options;
    const state = await readArtifactState(fs.chatId, path);
    const decision = state[CONSENT_KEY] as { granted?: boolean } | undefined;
    if (decision?.granted === true) return;
    const granted = await consent(tools().map((tool) => tool.name));
    if (!granted) throw new Error("The user did not allow this artifact to use chat tools.");
    await updateArtifactState(fs.chatId, path, (current) => ({
      ...current,
      [CONSENT_KEY]: { granted: true, at: new Date().toISOString() },
    }));
  }

  private host(): Promise<DuckDbWorkspaceHost> {
    this.duckdb ??= acquireDuckDbWorkspace(this.options.fs);
    return this.duckdb;
  }

  async dispatch(method: string, params: unknown[]): Promise<unknown> {
    const { fs, path: pagePath } = this.options;
    const request = () => this.requestOptions();
    switch (method) {
      case "llm": {
        this.require("llm");
        const [prompt, options] = params;
        return runLlm(text(prompt, "prompt"), isRecord(options) ? options : {}, request());
      }
      case "ocr": {
        this.require("ocr");
        const path = this.normalize(params[0]);
        return runOcr(await this.readBytes(path), path, request());
      }
      case "vision": {
        this.require("vision");
        const path = this.normalize(params[0]);
        return runVision(await this.readBytes(path), path, typeof params[1] === "string" ? params[1] : undefined, request());
      }
      case "translate": {
        this.require("translate");
        return runTranslateText(text(params[1], "lang"), text(params[0], "text"), request());
      }
      case "translateFile": {
        this.require("translate");
        const input = this.normalize(params[0]);
        const output = this.normalize(params[2]);
        const bytes = await runTranslateFile(text(params[1], "lang"), await this.readBytes(input), input, request());
        return this.write(output, bytes);
      }
      case "render": {
        this.require("render");
        const output = this.normalize(params[1]);
        const inputPaths = Array.isArray(params[2]) ? params[2].map((item) => this.normalize(item)) : [];
        const inputs = await Promise.all(inputPaths.map(async (item) => ({ data: await this.readBytes(item), path: item })));
        const bytes = await runRenderImage(text(params[0], "prompt"), inputs, isRecord(params[3]) ? params[3] : undefined, request());
        return this.write(output, bytes);
      }
      case "synthesize": {
        this.require("synthesize");
        const output = this.normalize(params[1]);
        const bytes = await runSynthesize(text(params[0], "text"), typeof params[2] === "string" ? params[2] : undefined, request());
        return this.write(output, bytes);
      }
      case "transcribe": {
        this.require("transcribe");
        const path = this.normalize(params[0]);
        return runTranscribe(await this.readBytes(path), path, request());
      }
      case "rasterizePdf": {
        this.require("files");
        const path = this.normalize(params[0]);
        const options = isRecord(params[1]) ? params[1] : {};
        const { rasterizePdf } = await import("@/shared/lib/pdf");
        return rasterizePdf(await this.readBytes(path), {
          pages: Array.isArray(options.pages) ? (options.pages as number[]) : undefined,
          scale: typeof options.scale === "number" ? options.scale : undefined,
        });
      }

      case "files.list":
        this.require("files");
        return (await fs.listEntries()).map((entry) => entry.path);
      case "files.exists":
        this.require("files");
        return fs.fileExists(this.normalize(params[0]));
      case "files.read":
        this.require("files");
        return this.readBytes(this.normalize(params[0]));
      case "files.readText":
        this.require("files");
        return this.readText(this.normalize(params[0]));
      case "files.readJSON":
        this.require("files");
        return JSON.parse(await this.readText(this.normalize(params[0]))) as unknown;
      case "files.write":
        this.require("files");
        return this.write(this.normalize(params[0]), params[1], params[2]);
      case "files.writeText":
        this.require("files");
        return this.write(this.normalize(params[0]), text(params[1], "text"), params[2]);
      case "files.writeJSON":
        this.require("files");
        return this.write(this.normalize(params[0]), JSON.stringify(params[1] ?? null, null, 2), "application/json");
      case "files.remove": {
        this.require("files");
        const path = this.normalize(params[0]);
        await this.commit({ upserts: {}, deletes: [path] });
        return true;
      }

      case "store.get": {
        this.require("store");
        const key = this.assertStoreKey(params[0]);
        return (await readArtifactState(fs.chatId, pagePath))[key] ?? null;
      }
      case "store.set": {
        this.require("store");
        const key = this.assertStoreKey(params[0]);
        const value = params[1];
        await updateArtifactState(fs.chatId, pagePath, (state) => {
          const next = { ...state };
          if (value === undefined) delete next[key];
          else next[key] = value;
          return next;
        });
        return true;
      }
      case "store.remove": {
        this.require("store");
        const key = this.assertStoreKey(params[0]);
        await updateArtifactState(fs.chatId, pagePath, (state) => {
          const next = { ...state };
          delete next[key];
          return next;
        });
        return true;
      }
      case "store.keys":
        this.require("store");
        return Object.keys(await readArtifactState(fs.chatId, pagePath)).filter(
          (key) => !key.startsWith(ARTIFACT_STATE_RESERVED_PREFIX),
        );

      case "tools.list":
        this.require("tools");
        return this.options.tools().map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          parameters: tool.parameters,
        }));
      case "tools.call": {
        this.require("tools");
        const name = text(params[0], "name");
        const tool = this.options.tools().find((candidate) => candidate.name === name);
        if (!tool) throw new Error(`Unknown tool: ${name}`);
        await this.ensureToolConsent();
        const context: ToolContext = {
          chatId: fs.chatId,
          model: this.options.model() ?? undefined,
          signal: this.controller.signal,
          setMeta() {},
          updateMeta() {},
        };
        return tool.function(isRecord(params[1]) ? params[1] : {}, context);
      }

      case "duckdb.connect":
        this.require("duckdb");
        return (await this.host()).connect();
      case "duckdb.close":
        this.require("duckdb");
        return (await this.host()).close(text(params[0], "connection"));
      case "duckdb.query": {
        this.require("duckdb");
        const [id, sql, args] = params;
        return (await this.host()).query(typeof id === "string" ? id : null, text(sql, "sql"), Array.isArray(args) ? args : undefined);
      }
      case "duckdb.files":
        this.require("duckdb");
        return (await this.host()).files();

      default:
        throw new Error(`Unknown wingman method: ${method}`);
    }
  }
}
