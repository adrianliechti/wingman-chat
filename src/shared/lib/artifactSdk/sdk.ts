/**
 * `window.wingman` — the page-side SDK injected into HTML artifact previews.
 *
 * This file is bundled to a single classic script (see
 * scripts/artifact-library-sources.ts) and served from the preview session at
 * `__wingman__/sdk.js`; it must stay dependency-free. A downloaded copy of an
 * artifact has no parent window, so the SDK installs nothing there and pages
 * are expected to feature-detect `window.wingman`.
 */

import type { SdkCapabilities, SdkRpcReply } from "./protocol";

type Params = unknown[];

(() => {
  const script = document.currentScript as HTMLScriptElement | null;
  const token = script?.dataset.token;
  const path = script?.dataset.path ?? "/";
  if (!token || window.parent === window) return;

  let capabilities: SdkCapabilities;
  try {
    capabilities = JSON.parse(script?.dataset.capabilities ?? "{}") as SdkCapabilities;
  } catch {
    capabilities = {} as SdkCapabilities;
  }

  const rpc = (method: string, params: Params): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        channel.port1.close();
        const reply = event.data as SdkRpcReply | undefined;
        if (reply && reply.ok) resolve(reply.value);
        else reject(new Error(reply && !reply.ok ? reply.error : "The artifact bridge did not answer."));
      };
      window.parent.postMessage({ type: "wingman:rpc", token, method, params }, location.origin, [channel.port2]);
    });

  const call =
    (method: string) =>
    (...params: Params) =>
      rpc(method, params);

  const api = {
    version: 1,
    path,
    capabilities,
    llm: call("llm"),
    vision: call("vision"),
    ocr: call("ocr"),
    translate: call("translate"),
    translateFile: call("translateFile"),
    render: call("render"),
    synthesize: call("synthesize"),
    transcribe: call("transcribe"),
    rasterizePdf: call("rasterizePdf"),
    files: {
      list: call("files.list"),
      exists: call("files.exists"),
      read: call("files.read"),
      readText: call("files.readText"),
      readJSON: call("files.readJSON"),
      write: call("files.write"),
      writeText: call("files.writeText"),
      writeJSON: call("files.writeJSON"),
      remove: call("files.remove"),
    },
    store: {
      get: call("store.get"),
      set: call("store.set"),
      remove: call("store.remove"),
      keys: call("store.keys"),
    },
    tools: {
      list: call("tools.list"),
      call: call("tools.call"),
    },
    duckdb: {
      /** A dedicated connection with its own session state; close it when done. */
      async connect() {
        const id = await rpc("duckdb.connect", []);
        return {
          query: (sql: string, params?: unknown[]) => rpc("duckdb.query", [id, sql, params]),
          close: () => rpc("duckdb.close", [id]),
        };
      },
      /** Runs on a shared default connection. */
      query: (sql: string, params?: unknown[]) => rpc("duckdb.query", [null, sql, params]),
      /** Workspace files mounted for SQL, by the names they can be queried under. */
      files: call("duckdb.files"),
    },
  };

  window.addEventListener("message", (event) => {
    const data = event.data as { type?: string; token?: string; capabilities?: SdkCapabilities } | null;
    if (event.source !== window.parent || data?.type !== "wingman:hello" || data.token !== token) return;
    if (data.capabilities) api.capabilities = data.capabilities;
  });

  Object.defineProperty(window, "wingman", { value: api, configurable: true, enumerable: true });
})();
