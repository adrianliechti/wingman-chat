/** A consumer owns its worker, file namespace and connections for exactly its lifetime. */
import type { AsyncDuckDB, AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { withAbort } from "@/shared/lib/abortSignals";
import { DuckDbRuntime, runDuckDbQuery } from "@/shared/lib/duckdb";
import type { DuckDbQueryResult } from "@/shared/lib/duckdbResult";
import { isMountablePath } from "@/shared/lib/dataFiles";
import { getArtifactNativeFile, listArtifactEntries } from "@/shared/lib/opfs-artifacts";
import { FileSystemManager } from "./fs";

const isDataPath = isMountablePath;

/** Names a workspace path is mounted under: its path without the leading slash, plus the bare name when unique. */
export function mountNames(paths: string[]): Map<string, string[]> {
  const basenames = new Map<string, number>();
  for (const path of paths) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    basenames.set(name, (basenames.get(name) ?? 0) + 1);
  }
  const names = new Map<string, string[]>();
  for (const path of paths) {
    const full = path.replace(/^\/+/, "");
    const name = path.slice(path.lastIndexOf("/") + 1);
    names.set(path, full === name || basenames.get(name) !== 1 ? [full] : [full, name]);
  }
  return names;
}

/** Every name SQL can address right now, for the model's runtime context. */
export function queryableMountNames(paths: string[]): string[] {
  return [...mountNames(paths.filter(isDataPath)).values()].flat().sort();
}

export interface DuckDbWorkspaceHost {
  readonly signal: AbortSignal;
  connect(): Promise<string>;
  close(connectionId: string): Promise<void>;
  query(connectionId: string | null, sql: string, params?: unknown[]): Promise<DuckDbQueryResult>;
  files(): Promise<string[]>;
  /** Cancel pending work and terminate this consumer's worker. Safe even during initialization. */
  dispose(): void;
}

export interface DuckDbWorkspaceOptions {
  signal?: AbortSignal;
  /** An immutable revision, mounted privately without touching the live workspace. */
  snapshot?: { path: string; file: globalThis.File };
}

/** Synchronous ownership, lazy initialization: cleanup never has to wait for acquisition. */
export function createDuckDbWorkspace(
  fs: FileSystemManager,
  options: DuckDbWorkspaceOptions = {},
): DuckDbWorkspaceHost {
  const runtime = new DuckDbRuntime(options.signal);
  const connections = new Map<string, AsyncDuckDBConnection>();
  let shared: AsyncDuckDBConnection | undefined;
  const registered = new Set<string>();
  let revision = 0;
  let mountedRevision = -1;
  let pending: Promise<unknown> = Promise.resolve();
  const onChange = () => {
    revision++;
  };
  const subscriptions =
    options.snapshot || runtime.signal.aborted
      ? []
      : [
          fs.subscribe("fileCreated", onChange),
          fs.subscribe("fileUpdated", onChange),
          fs.subscribe("fileDeleted", onChange),
          fs.subscribe("fileRenamed", onChange),
        ];
  runtime.signal.addEventListener(
    "abort",
    () => {
      subscriptions.forEach((off) => off());
      connections.clear();
      shared = undefined;
      registered.clear();
    },
    { once: true },
  );

  async function refresh(db: AsyncDuckDB): Promise<void> {
    if (mountedRevision === revision) return;
    const { DuckDBDataProtocol } = await import("@duckdb/duckdb-wasm");
    const nextRevision = revision;
    // Interpreter runs already hold the filesystem transaction. Reading the
    // committed OPFS files directly avoids reentering that transaction.
    const paths = options.snapshot
      ? [options.snapshot.path]
      : (await listArtifactEntries(fs.chatId)).map((entry) => entry.path).filter(isDataPath);
    const wanted = mountNames(paths);
    for (const name of registered) {
      runtime.signal.throwIfAborted();
      await db.dropFile(name);
      registered.delete(name);
    }
    for (const [path, names] of wanted) {
      const file = options.snapshot?.file ?? (await getArtifactNativeFile(fs.chatId, path));
      if (!file) continue;
      for (const name of names) {
        runtime.signal.throwIfAborted();
        await db.registerFileHandle(name, file, DuckDBDataProtocol.BROWSER_FILEREADER, true);
        runtime.signal.throwIfAborted();
        registered.add(name);
      }
    }
    mountedRevision = nextRevision;
  }

  // One command stream per worker: native streams, close and file registration
  // cannot overlap. Other consumers have independent workers and never wait here.
  function command<T>(operation: (db: AsyncDuckDB) => Promise<T>): Promise<T> {
    const result = withAbort(runtime.signal, () => pending.then(() => runtime.run(operation)));
    pending = result.catch(() => undefined);
    return result;
  }

  return {
    signal: runtime.signal,
    connect: () =>
      command(async (db) => {
        const id = crypto.randomUUID();
        const connection = await db.connect();
        runtime.signal.throwIfAborted();
        connections.set(id, connection);
        return id;
      }),
    close: (id) =>
      command(async () => {
        const connection = connections.get(id);
        connections.delete(id);
        await connection?.close();
      }),
    query: (id, sql, params) =>
      command(async (db) => {
        await refresh(db);
        runtime.signal.throwIfAborted();
        if (id === null && !shared) {
          const connection = await db.connect();
          runtime.signal.throwIfAborted();
          shared = connection;
        }
        const connection = id === null ? shared : connections.get(id);
        if (!connection) throw new Error("Unknown DuckDB connection; call connect() first.");
        return runDuckDbQuery(connection, sql, params, runtime.signal);
      }),
    files: () =>
      command(async (db) => {
        await refresh(db);
        return [...registered].sort();
      }),
    dispose: () => runtime.dispose(),
  };
}

// The interpreter's execution signal is its lifetime, including successful
// completion. Consecutive SQL calls in a run share session state and one worker.
const runs = new WeakMap<AbortSignal, Map<string, DuckDbWorkspaceHost>>();

export async function queryDuckDbWorkspace(
  chatId: string,
  sql: string,
  params?: unknown[],
  signal?: AbortSignal,
): Promise<DuckDbQueryResult> {
  signal?.throwIfAborted();
  if (signal) {
    let workspaces = runs.get(signal);
    if (!workspaces) {
      workspaces = new Map();
      runs.set(signal, workspaces);
      signal.addEventListener("abort", () => runs.delete(signal), { once: true });
    }
    let host = workspaces.get(chatId);
    if (!host) {
      host = createDuckDbWorkspace(new FileSystemManager(chatId), { signal });
      workspaces.set(chatId, host);
    }
    return host.query(null, sql, params);
  }
  const host = createDuckDbWorkspace(new FileSystemManager(chatId));
  try {
    return await host.query(null, sql, params);
  } finally {
    host.dispose();
  }
}
