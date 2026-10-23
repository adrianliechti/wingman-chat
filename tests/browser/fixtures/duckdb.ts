import { createDuckDbWorkspace, type DuckDbWorkspaceHost } from "../../../src/features/artifacts/lib/duckdbWorkspace";
import { FileSystemManager } from "../../../src/features/artifacts/lib/fs";
import { dispatchBridgeRpc } from "../../../src/features/tools/lib/bridgeDispatch";
import { executeJavaScript } from "../../../src/features/tools/lib/javascript";

// Count actual workers and native requests, without substituting the WASM engine.
const workers = { created: 0, active: 0, queries: 0, connects: 0 };
const NativeWorker = window.Worker;
window.Worker = class extends NativeWorker {
  private readonly duckdb: boolean;
  private stopped = false;
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options);
    this.duckdb = String(url).includes("duckdb-browser");
    if (this.duckdb) {
      workers.created++;
      workers.active++;
    }
  }
  override postMessage(message: unknown, options: Transferable[] | StructuredSerializeOptions = []) {
    const type = (message as { type?: string })?.type;
    if (this.duckdb && type === "START_PENDING_QUERY") workers.queries++;
    if (this.duckdb && type === "CONNECT") workers.connects++;
    if (Array.isArray(options)) super.postMessage(message, options);
    else super.postMessage(message, options);
  }
  override terminate() {
    if (this.duckdb && !this.stopped) {
      workers.active--;
      this.stopped = true;
    }
    super.terminate();
  }
};

const hosts = new Map<string, DuckDbWorkspaceHost>();
const pending = new Map<string, Promise<unknown>>();
let subscriptions = 0;
let runController: AbortController | undefined;
let runResult: ReturnType<typeof executeJavaScript> | undefined;
const host = (id: string) => hosts.get(id)!;

const api = {
  stats: () => ({ ...workers, subscriptions }),
  create(chatId: string = crypto.randomUUID(), snapshot?: string) {
    const fs = new FileSystemManager(chatId);
    const subscribe = fs.subscribe.bind(fs);
    fs.subscribe = (type, handler) => {
      subscriptions++;
      const off = subscribe(type, handler);
      return () => {
        subscriptions--;
        off();
      };
    };
    const id = crypto.randomUUID();
    hosts.set(
      id,
      createDuckDbWorkspace(fs, {
        snapshot: snapshot === undefined ? undefined : { path: "/data.csv", file: new File([snapshot], "data.csv") },
      }),
    );
    return id;
  },
  query: (id: string, sql: string, params?: unknown[]) => host(id).query(null, sql, params),
  async closeAfterQuery(id: string) {
    const connection = await host(id).connect();
    const query = host(id).query(connection, "SELECT sum(i) AS n FROM range(1000000) t(i)");
    const close = host(id).close(connection);
    const result = await query;
    await close;
    return result;
  },
  begin(id: string, operation: "query" | "connect", sql = "SELECT 2 AS n") {
    const key = crypto.randomUUID();
    pending.set(
      key,
      (operation === "query" ? host(id).query(null, sql) : host(id).connect()).then(
        (value) => ({ value }),
        (error: unknown) => ({ error: error instanceof Error ? error.name : String(error) }),
      ),
    );
    return key;
  },
  outcome: (key: string) => pending.get(key)!,
  dispose: (id: string) => host(id).dispose(),
  async write(chatId: string, content: string) {
    await new FileSystemManager(chatId).createFile("/data.csv", content);
  },
  async abortedRequest() {
    const controller = new AbortController();
    controller.abort();
    const channel = new MessageChannel();
    try {
      await dispatchBridgeRpc(
        { type: "duckdb-query-request", port: channel.port1, sql: "CREATE TABLE aborted AS SELECT 1" },
        {
          signal: controller.signal,
          context: { chatId: "aborted" },
        },
      );
      return "executed";
    } catch {
      return "cancelled";
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
  },
  startRun(code: string) {
    runController = new AbortController();
    runResult = executeJavaScript({ code }, { signal: runController.signal, context: { chatId: "duckdb-run" } });
  },
  stopRun: () => runController?.abort(),
  runResult: () => runResult,
};
window.duckdbE2E = api;

declare global {
  interface Window {
    duckdbE2E: typeof api;
  }
}
