/**
 * Mounts a chat's artifact workspace into the app's DuckDB instance so data
 * files are queryable by name: `SELECT * FROM 'flights.csv'` or
 * `'data/flights.csv'`. Files are registered through their stored File
 * objects (no copy, no lock) and re-registered when the workspace changes.
 * One mount is active at a time — the workspace of the chat being viewed.
 */

import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { dropDuckDbFile, getDuckDb, registerDuckDbFile, runDuckDbQuery } from "@/shared/lib/duckdb";
import type { DuckDbQueryResult } from "@/shared/lib/duckdbResult";
import { getArtifactNativeFile, listArtifactEntries } from "@/shared/lib/opfs-artifacts";
import { FileSystemManager } from "./fs";

const DATA_EXTENSIONS = new Set(["csv", "tsv", "json", "jsonl", "ndjson", "parquet", "arrow", "xlsx"]);

function isDataPath(path: string): boolean {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return path.includes(".") && DATA_EXTENSIONS.has(extension);
}

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

interface WorkspaceMount {
  chatId: string;
  fs: FileSystemManager;
  registered: Set<string>;
  unsubscribe: () => void;
  /** Serialises refreshes so a burst of file events cannot interleave registrations. */
  pending: Promise<void>;
}

let mount: WorkspaceMount | null = null;

async function refresh(target: WorkspaceMount): Promise<void> {
  // Read storage directly: an interpreter run calling sql() holds the
  // workspace lock, and going through the manager here would deadlock.
  const entries = await listArtifactEntries(target.chatId);
  const dataPaths = entries.map((entry) => entry.path).filter(isDataPath);
  const wanted = mountNames(dataPaths);
  // Drop everything first: a rewritten file's earlier File snapshot is stale.
  for (const name of target.registered) await dropDuckDbFile(name);
  target.registered.clear();
  for (const [path, names] of wanted) {
    const file = await getArtifactNativeFile(target.chatId, path);
    if (!file) continue;
    for (const name of names) {
      await registerDuckDbFile(name, file);
      target.registered.add(name);
    }
  }
}

function schedule(target: WorkspaceMount): Promise<void> {
  target.pending = target.pending.then(() => refresh(target)).catch((error) => {
    console.error("duckdb: workspace mount failed", error);
  });
  return target.pending;
}

async function ensureMount(fs: FileSystemManager): Promise<WorkspaceMount> {
  if (mount && mount.chatId === fs.chatId) {
    await mount.pending;
    return mount;
  }
  if (mount) {
    const previous = mount;
    mount = null;
    previous.unsubscribe();
    await previous.pending;
    for (const name of previous.registered) await dropDuckDbFile(name);
  }
  await getDuckDb();
  const target: WorkspaceMount = { chatId: fs.chatId, fs, registered: new Set(), unsubscribe: () => {}, pending: Promise.resolve() };
  const onChange = () => void schedule(target);
  const subscriptions = [
    fs.subscribe("fileCreated", onChange),
    fs.subscribe("fileUpdated", onChange),
    fs.subscribe("fileDeleted", onChange),
    fs.subscribe("fileRenamed", onChange),
  ];
  target.unsubscribe = () => subscriptions.forEach((off) => off());
  mount = target;
  await schedule(target);
  return target;
}

/** SQL access for one consumer (an artifact page or an interpreter run). */
export interface DuckDbWorkspaceHost {
  /** Open a dedicated connection; returns its id. */
  connect(): Promise<string>;
  close(connectionId: string): Promise<void>;
  /** Run on a connection, or on this host's shared default connection when `connectionId` is null. */
  query(connectionId: string | null, sql: string, params?: unknown[]): Promise<DuckDbQueryResult>;
  /** Mounted names, e.g. `["data/flights.csv", "flights.csv"]`. */
  files(): string[];
  /** Close this consumer's connections. The mount stays for the next consumer. */
  release(): Promise<void>;
}

export async function acquireDuckDbWorkspace(fs: FileSystemManager): Promise<DuckDbWorkspaceHost> {
  const target = await ensureMount(fs);
  const connections = new Map<string, AsyncDuckDBConnection>();
  let shared: Promise<AsyncDuckDBConnection> | null = null;
  const open = async () => (await getDuckDb()).connect();

  return {
    async connect() {
      const id = crypto.randomUUID();
      connections.set(id, await open());
      return id;
    },
    async close(connectionId) {
      const connection = connections.get(connectionId);
      connections.delete(connectionId);
      await connection?.close();
    },
    async query(connectionId, sql, params) {
      await target.pending;
      let connection: AsyncDuckDBConnection | undefined;
      if (connectionId === null) {
        shared ??= open();
        connection = await shared;
      } else {
        connection = connections.get(connectionId);
      }
      if (!connection) throw new Error("Unknown DuckDB connection; call connect() first.");
      return runDuckDbQuery(connection, sql, params);
    },
    files() {
      return [...target.registered].sort();
    },
    async release() {
      for (const connection of connections.values()) await connection.close().catch(() => undefined);
      connections.clear();
      if (shared) await (await shared).close().catch(() => undefined);
      shared = null;
    },
  };
}

/** One-off query for interpreter runs: mounts the chat's workspace and runs on a temporary connection. */
export async function queryDuckDbWorkspace(
  chatId: string,
  sql: string,
  params?: unknown[],
): Promise<DuckDbQueryResult> {
  const host = await acquireDuckDbWorkspace(new FileSystemManager(chatId));
  try {
    return await host.query(null, sql, params);
  } finally {
    await host.release();
  }
}
