/** A lazy, single-threaded DuckDB worker owned by one consumer. No database outlives its owner. */
import type { AsyncDuckDB, AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import ehWorkerUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import ehWasmUrl from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import { withAbort } from "./abortSignals";
import { collectDuckDbResult, type DuckDbQueryResult } from "./duckdbResult";

export const DUCKDB_MEMORY_LIMIT = "256MB";
export const DUCKDB_OPERATION_TIMEOUT_MS = 120_000;

/** Where the bundled extensions live: `{origin}{base}duckdb/extensions/{version}/{platform}/…`. */
export function extensionRepository(): string {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
  return `${location.origin}${base}duckdb/extensions`;
}

export class DuckDbRuntime {
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private worker: Worker | null = null;
  private database: Promise<AsyncDuckDB> | null = null;
  private removeOwnerListener?: () => void;

  constructor(owner?: AbortSignal) {
    if (!owner) return;
    const abort = () => this.dispose(owner.reason);
    owner.addEventListener("abort", abort, { once: true });
    this.removeOwnerListener = () => owner.removeEventListener("abort", abort);
    if (owner.aborted) abort();
  }

  dispose(reason: unknown = new DOMException("DuckDB workspace closed", "AbortError")): void {
    if (this.signal.aborted) return;
    this.controller.abort(reason);
    this.removeOwnerListener?.();
    this.removeOwnerListener = undefined;
    // Closing native connections while a query/connect is in flight can corrupt
    // WASM memory. Terminating our worker cancels all of them atomically instead.
    this.worker?.terminate();
    this.worker = null;
    this.database = null;
  }

  run<T>(operation: (db: AsyncDuckDB) => Promise<T>): Promise<T> {
    return withAbort(this.signal, async () => {
      const timer = setTimeout(() => {
        this.dispose(new Error("DuckDB operation timed out. Reopen the artifact or run the code again."));
      }, DUCKDB_OPERATION_TIMEOUT_MS);
      try {
        const db = await (this.database ??= this.initialize());
        return await withAbort(this.signal, () => operation(db));
      } catch (error) {
        if (error instanceof Error && error.name === "RuntimeError") this.dispose(error);
        throw error;
      } finally {
        clearTimeout(timer);
      }
    });
  }

  private async initialize(): Promise<AsyncDuckDB> {
    try {
      const duckdb = await import("@duckdb/duckdb-wasm");
      this.signal.throwIfAborted();
      const worker = new Worker(ehWorkerUrl);
      this.worker = worker;
      worker.addEventListener("error", (event) => this.dispose(new Error(`DuckDB worker failed: ${event.message}`)));
      worker.addEventListener("messageerror", () =>
        this.dispose(new Error("DuckDB worker message could not be read.")),
      );
      const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
      await withAbort(this.signal, () => db.instantiate(ehWasmUrl));
      await withAbort(this.signal, () => db.open({ query: { castTimestampToDate: true, castDecimalToDouble: true } }));
      const connection = await withAbort(this.signal, () => db.connect());
      try {
        await withAbort(this.signal, () => connection.query(`SET memory_limit = '${DUCKDB_MEMORY_LIMIT}'`));
        await withAbort(this.signal, () =>
          connection.query(`SET custom_extension_repository = '${extensionRepository().replace(/'/g, "''")}'`),
        );
        for (const extension of ["parquet", "json"]) {
          await withAbort(this.signal, () => connection.query(`LOAD ${extension}`));
        }
      } finally {
        if (!this.signal.aborted) await withAbort(this.signal, () => connection.close());
      }
      return db;
    } catch (error) {
      this.dispose(error);
      throw error;
    }
  }
}

/** Read batches instead of materializing an unbounded Arrow table before copying it into JSON. */
export async function runDuckDbQuery(
  connection: AsyncDuckDBConnection,
  sql: string,
  params: unknown[] | undefined,
  signal: AbortSignal,
): Promise<DuckDbQueryResult> {
  signal.throwIfAborted();
  const statement = params?.length ? await withAbort(signal, () => connection.prepare(sql)) : undefined;
  let complete = false;
  try {
    const reader = await withAbort(signal, () => (statement ? statement.send(...params!) : connection.send(sql, true)));
    try {
      await withAbort(signal, () => reader.open());
      const result = await withAbort(signal, () => collectDuckDbResult(reader));
      complete = true;
      return result;
    } finally {
      await reader.cancel();
    }
  } finally {
    if (!signal.aborted) {
      if (!complete) await withAbort(signal, () => connection.cancelSent());
      if (statement) await withAbort(signal, () => statement.close());
    }
  }
}
