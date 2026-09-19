import type { SortingState } from "@tanstack/react-table";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { acquireDuckDbWorkspace, type DuckDbWorkspaceHost } from "@/features/artifacts/lib/duckdbWorkspace";
import { dataFileFormat } from "@/shared/lib/dataFiles";
import type { FileSystemManager } from "@/features/artifacts/lib/fs";
import { DataTable, type DataTableColumn } from "./DataTable";

interface DataEditorProps {
  path: string;
}

/** Rows fetched per window query. */
const CHUNK = 500;

interface Attached {
  fs: FileSystemManager;
  host: DuckDbWorkspaceHost;
  /** Catalog alias for database files; undefined for scanned files. */
  alias?: string;
  tables?: string[];
}

interface Shape {
  source: string;
  columns: DataTableColumn[];
  total: number;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return JSON.stringify(value);
}

const quoteLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;
const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

let attachCounter = 0;

/** A catalog name unique to this mount, so overlapping mounts (StrictMode, fast switches) never collide. */
function nextAlias(): string {
  attachCounter += 1;
  return `viewer_${attachCounter}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read-only grid over any data artifact DuckDB can read: CSV, TSV, JSONL,
 * Parquet, Arrow (scanned by name) and SQLite or DuckDB databases (attached,
 * with a table picker). Rows are fetched in windows as the grid scrolls and
 * sorted by DuckDB, so file size never matters to the page.
 */
export function DataEditor({ path }: DataEditorProps) {
  const { fs } = useArtifacts();
  const format = dataFileFormat(path);
  const [attached, setAttached] = useState<Attached | null>(null);
  const [table, setTable] = useState<string | null>(null);
  const [shape, setShape] = useState<Shape | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [error, setError] = useState<string | null>(null);
  const chunks = useRef(new Map<number, string[][]>());
  const pending = useRef(new Set<number>());
  // Bumped whenever the cache is cleared; answers from an older generation are dropped.
  const generation = useRef(0);
  const visible = useRef<[number, number] | null>(null);
  const [version, setVersion] = useState(0);

  // Mount the workspace and, for databases, attach the file and list its tables.
  useEffect(() => {
    if (!fs) return;
    let cancelled = false;
    let host: DuckDbWorkspaceHost | null = null;
    let alias: string | undefined;
    setAttached(null);
    setShape(null);
    setError(null);
    setSorting([]);
    (async () => {
      host = await acquireDuckDbWorkspace(fs);
      const name = path.replace(/^\/+/, "");
      let tables: string[] | undefined;
      if (format === "sqlite" || format === "duckdb") {
        if (format === "sqlite") await host.query(null, "LOAD sqlite_scanner");
        if (cancelled) return;
        alias = nextAlias();
        const type = format === "sqlite" ? "TYPE sqlite, " : "";
        await host.query(null, `ATTACH ${quoteLiteral(name)} AS ${alias} (${type}READ_ONLY)`);
        const listed = await host.query(
          null,
          `SELECT table_name FROM information_schema.tables WHERE table_catalog = ${quoteLiteral(alias)} ORDER BY table_name`,
        );
        tables = listed.rows.map((row) => cellText(row.table_name));
      }
      if (cancelled) return;
      setAttached({ fs, host, alias, tables });
      setTable(tables?.[0] ?? null);
    })().catch((cause: unknown) => {
      if (!cancelled) setError(describe(cause));
    });
    return () => {
      cancelled = true;
      const current = host;
      void (async () => {
        if (alias) await current?.query(null, `DETACH ${alias}`).catch(() => undefined);
        await current?.release();
      })();
    };
  }, [fs, path, format]);

  const source = useMemo(() => {
    if (!attached || attached.fs !== fs) return null;
    if (attached.alias) return table ? `${attached.alias}.${quoteIdentifier(table)}` : null;
    return quoteLiteral(path.replace(/^\/+/, ""));
  }, [attached, fs, table, path]);

  // Columns and the row count for the selected source.
  useEffect(() => {
    if (!attached || !source) return;
    let cancelled = false;
    chunks.current.clear();
    pending.current.clear();
    setShape(null);
    setSorting([]);
    (async () => {
      const [described, counted] = await Promise.all([
        attached.host.query(null, `DESCRIBE SELECT * FROM ${source}`),
        attached.host.query(null, `SELECT count(*) AS n FROM ${source}`),
      ]);
      if (cancelled) return;
      setShape({
        source,
        columns: described.rows.map((row) => ({ name: cellText(row.column_name), detail: cellText(row.column_type) })),
        total: Number(counted.rows[0]?.n ?? 0),
      });
    })().catch((cause: unknown) => {
      if (!cancelled) setError(describe(cause));
    });
    return () => {
      cancelled = true;
    };
  }, [attached, source]);

  const orderBy = useMemo(() => {
    const column = sorting[0] ? shape?.columns[Number(sorting[0].id)] : undefined;
    return column ? ` ORDER BY ${quoteIdentifier(column.name)} ${sorting[0].desc ? "DESC" : "ASC"}` : "";
  }, [sorting, shape]);

  const loadChunk = useCallback(
    (index: number) => {
      if (!attached || !shape || chunks.current.has(index) || pending.current.has(index)) return;
      pending.current.add(index);
      const started = generation.current;
      const query = `SELECT * FROM ${shape.source}${orderBy} LIMIT ${CHUNK} OFFSET ${index * CHUNK}`;
      attached.host
        .query(null, query)
        .then((result) => {
          // An answer for an earlier source or sort order is stale; drop it.
          if (started !== generation.current) return;
          pending.current.delete(index);
          chunks.current.set(
            index,
            result.rows.map((row) => shape.columns.map((column) => cellText(row[column.name]))),
          );
          setVersion((value) => value + 1);
        })
        .catch((cause: unknown) => {
          if (started !== generation.current) return;
          pending.current.delete(index);
          setError(describe(cause));
        });
    },
    [attached, shape, orderBy],
  );

  const request = useCallback(
    (start: number, end: number) => {
      for (let index = Math.floor(start / CHUNK); index <= Math.floor(end / CHUNK); index++) loadChunk(index);
    },
    [loadChunk],
  );

  // A new source or sort order invalidates every loaded window; the rows on
  // screen are requested again right away rather than on the next scroll.
  useEffect(() => {
    generation.current += 1;
    chunks.current.clear();
    pending.current.clear();
    setVersion((value) => value + 1);
    if (visible.current) request(...visible.current);
  }, [request]);

  const onVisibleRange = useCallback(
    (start: number, end: number) => {
      visible.current = [start, end];
      request(start, end);
    },
    [request],
  );

  const getRow = useCallback(
    (index: number) => chunks.current.get(Math.floor(index / CHUNK))?.[index % CHUNK],
    // `version` changes whenever a window arrives, so the grid re-reads the cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-red-600 dark:text-red-400">
        {error}
      </div>
    );
  }
  if (!fs || !attached || !shape) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-sm text-neutral-400 dark:text-neutral-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading data…
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      {attached.tables && (
        <div className="shrink-0 flex items-center gap-3 px-3 py-1.5 text-[11px] text-neutral-500 dark:text-neutral-400 border-b border-neutral-200/60 dark:border-neutral-800/60">
          <label className="flex items-center gap-1.5">
            <span>Table</span>
            <select
              aria-label="Table"
              value={table ?? ""}
              onChange={(event) => setTable(event.target.value)}
              className="rounded border border-neutral-300/70 dark:border-neutral-700 bg-transparent px-1.5 py-0.5 text-[11px] text-neutral-700 dark:text-neutral-200"
            >
              {attached.tables.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <span>
            {shape.total.toLocaleString("en")} {shape.total === 1 ? "row" : "rows"}
          </span>
        </div>
      )}
      {shape.columns.length === 0 || shape.total === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-neutral-400 dark:text-neutral-500">
          No rows
        </div>
      ) : (
        <DataTable
          key={shape.source}
          columns={shape.columns}
          rowCount={shape.total}
          getRow={getRow}
          onVisibleRange={onVisibleRange}
          sorting={sorting}
          onSortingChange={setSorting}
        />
      )}
    </div>
  );
}
