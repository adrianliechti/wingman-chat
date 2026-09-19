/**
 * DuckDB-WASM hosted by the app: one database per page, created on first use.
 * The bundle ships with the app (no CDN), so SQL keeps working offline; the
 * single-threaded `eh` build is used because the threaded one needs a
 * cross-origin-isolated page.
 */

import type { AsyncDuckDB, AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import ehWorkerUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import ehWasmUrl from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import { serializeArrowTable, type DuckDbQueryResult } from "./duckdbResult";

let database: Promise<AsyncDuckDB> | null = null;

/** Where the bundled extensions live: `{origin}{base}duckdb/extensions/{version}/{platform}/…`. */
export function extensionRepository(): string {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
  return `${location.origin}${base}duckdb/extensions`;
}

export function getDuckDb(): Promise<AsyncDuckDB> {
  if (!database) {
    database = (async () => {
      const duckdb = await import("@duckdb/duckdb-wasm");
      const bundle = await duckdb.selectBundle({
        mvp: { mainModule: ehWasmUrl, mainWorker: ehWorkerUrl },
        eh: { mainModule: ehWasmUrl, mainWorker: ehWorkerUrl },
      });
      const worker = new Worker(bundle.mainWorker!);
      const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      // Plain JSON for consumers: decimals (incl. HUGEINT sums) as doubles, timestamps as dates.
      await db.open({ query: { castTimestampToDate: true, castDecimalToDouble: true } });
      // Extensions (excel, fts, icu) are bundled by scripts/bundle-duckdb-extensions.mjs
      // and served from the app's own origin, so LOAD and autoloading work offline.
      const connection = await db.connect();
      try {
        await connection.query(`SET custom_extension_repository = '${extensionRepository()}'`);
        // In the wasm build the parquet and json readers are extensions; load
        // them up front so a missing bundle surfaces here, not as an
        // "invalid signature" from an HTML 404 page during a query.
        for (const extension of ["parquet", "json"]) {
          await connection.query(`LOAD ${extension}`).catch((error: unknown) => {
            console.warn(`duckdb: could not load the ${extension} extension; run \`npm run bundle:duckdb\`.`, error);
          });
        }
      } finally {
        await connection.close();
      }
      return db;
    })().catch((error) => {
      database = null;
      throw error;
    });
  }
  return database;
}

/** Make a stored file queryable under `name`; DuckDB reads it lazily through the File object. */
export async function registerDuckDbFile(name: string, file: globalThis.File): Promise<void> {
  const [db, { DuckDBDataProtocol }] = await Promise.all([getDuckDb(), import("@duckdb/duckdb-wasm")]);
  await db.registerFileHandle(name, file, DuckDBDataProtocol.BROWSER_FILEREADER, true);
}

/** Make bytes queryable under `name`; databases need this because their engines open files read-write. */
export async function registerDuckDbBuffer(name: string, bytes: Uint8Array): Promise<void> {
  const db = await getDuckDb();
  await db.registerFileBuffer(name, bytes);
}

export async function dropDuckDbFile(name: string): Promise<void> {
  const db = await getDuckDb();
  await db.dropFile(name).catch(() => undefined);
}

export async function runDuckDbQuery(
  connection: AsyncDuckDBConnection,
  sql: string,
  params?: unknown[],
): Promise<DuckDbQueryResult> {
  if (params && params.length > 0) {
    const statement = await connection.prepare(sql);
    try {
      return serializeArrowTable(await statement.query(...params));
    } finally {
      await statement.close();
    }
  }
  return serializeArrowTable(await connection.query(sql));
}
