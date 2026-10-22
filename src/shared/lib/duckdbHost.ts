/** A consumer owns its worker, file namespace and connections for exactly its lifetime. */
import type { AsyncDuckDB, AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { withAbort } from "./abortSignals";
import { DuckDbRuntime, runDuckDbQuery } from "./duckdb";
import type { DuckDbQueryResult } from "./duckdbResult";

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

export interface DuckDbHost {
  readonly signal: AbortSignal;
  connect(): Promise<string>;
  close(connectionId: string): Promise<void>;
  query(connectionId: string | null, sql: string, params?: unknown[]): Promise<DuckDbQueryResult>;
  files(): Promise<string[]>;
  /** Cancel pending work and terminate this consumer's worker. Safe even during initialization. */
  dispose(): void;
}

/**
 * Brings the files SQL can address up to date before a query. `registered`
 * holds the names currently mounted; the mount adds and drops entries as it
 * registers and drops files.
 */
export type DuckDbMount = (db: AsyncDuckDB, registered: Set<string>, signal: AbortSignal) => Promise<void>;

/** Synchronous ownership, lazy initialization: cleanup never has to wait for acquisition. */
export function createDuckDbHost(mount: DuckDbMount, owner?: AbortSignal): DuckDbHost {
  const runtime = new DuckDbRuntime(owner);
  const connections = new Map<string, AsyncDuckDBConnection>();
  let shared: AsyncDuckDBConnection | undefined;
  const registered = new Set<string>();
  let pending: Promise<unknown> = Promise.resolve();
  runtime.signal.addEventListener(
    "abort",
    () => {
      connections.clear();
      shared = undefined;
      registered.clear();
    },
    { once: true },
  );

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
        await mount(db, registered, runtime.signal);
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
        await mount(db, registered, runtime.signal);
        return [...registered].sort();
      }),
    dispose: () => runtime.dispose(),
  };
}
