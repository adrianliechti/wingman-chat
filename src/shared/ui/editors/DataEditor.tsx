import type { SortingState } from "@tanstack/react-table";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { acquireDuckDbWorkspace, type DuckDbWorkspaceHost } from "@/features/artifacts/lib/duckdbWorkspace";
import type { FileSystemManager } from "@/features/artifacts/lib/fs";
import { DataTable, type DataTableColumn } from "./DataTable";

interface DataEditorProps {
  path: string;
}

/** Rows fetched per window query. */
const CHUNK = 500;

interface Mounted {
  fs: FileSystemManager;
  host: DuckDbWorkspaceHost;
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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read-only grid over any tabular artifact DuckDB can scan by name: CSV, TSV,
 * JSONL, Parquet, Arrow. Rows are fetched in windows as the grid scrolls and
 * sorted by DuckDB, so file size never matters to the page.
 */
export function DataEditor({ path }: DataEditorProps) {
  const { fs } = useArtifacts();
  const [mounted, setMounted] = useState<Mounted | null>(null);
  const [shape, setShape] = useState<Shape | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [error, setError] = useState<string | null>(null);
  const chunks = useRef(new Map<number, string[][]>());
  const pending = useRef(new Set<number>());
  // Bumped whenever the cache is cleared; answers from an older generation are dropped.
  const generation = useRef(0);
  const visible = useRef<[number, number] | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!fs) return;
    let cancelled = false;
    let host: DuckDbWorkspaceHost | null = null;
    setMounted(null);
    setShape(null);
    setError(null);
    setSorting([]);
    acquireDuckDbWorkspace(fs)
      .then((acquired) => {
        host = acquired;
        if (!cancelled) setMounted({ fs, host: acquired });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describe(cause));
      });
    return () => {
      cancelled = true;
      void host?.release();
    };
  }, [fs, path]);

  const source = mounted?.fs === fs ? quoteLiteral(path.replace(/^\/+/, "")) : null;

  // Columns and the row count.
  useEffect(() => {
    if (!mounted || !source) return;
    let cancelled = false;
    chunks.current.clear();
    pending.current.clear();
    setShape(null);
    setSorting([]);
    Promise.all([
      mounted.host.query(null, `DESCRIBE SELECT * FROM ${source}`),
      mounted.host.query(null, `SELECT count(*) AS n FROM ${source}`),
    ])
      .then(([described, counted]) => {
        if (cancelled) return;
        setShape({
          source,
          columns: described.rows.map((row) => ({ name: cellText(row.column_name), detail: cellText(row.column_type) })),
          total: Number(counted.rows[0]?.n ?? 0),
        });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describe(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [mounted, source]);

  const orderBy = useMemo(() => {
    const column = sorting[0] ? shape?.columns[Number(sorting[0].id)] : undefined;
    return column ? ` ORDER BY ${quoteIdentifier(column.name)} ${sorting[0].desc ? "DESC" : "ASC"}` : "";
  }, [sorting, shape]);

  const loadChunk = useCallback(
    (index: number) => {
      if (!mounted || !shape || chunks.current.has(index) || pending.current.has(index)) return;
      pending.current.add(index);
      const started = generation.current;
      const query = `SELECT * FROM ${shape.source}${orderBy} LIMIT ${CHUNK} OFFSET ${index * CHUNK}`;
      mounted.host
        .query(null, query)
        .then((result) => {
          // An answer for an earlier sort order is stale; drop it.
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
    [mounted, shape, orderBy],
  );

  const request = useCallback(
    (start: number, end: number) => {
      for (let index = Math.floor(start / CHUNK); index <= Math.floor(end / CHUNK); index++) loadChunk(index);
    },
    [loadChunk],
  );

  // A new sort order invalidates every loaded window; the rows on screen are
  // requested again right away rather than on the next scroll.
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
  if (!fs || !mounted || !shape) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-sm text-neutral-400 dark:text-neutral-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading data…
      </div>
    );
  }
  if (shape.columns.length === 0 || shape.total === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-400 dark:text-neutral-500">
        No rows
      </div>
    );
  }
  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      <DataTable
        key={shape.source}
        columns={shape.columns}
        rowCount={shape.total}
        getRow={getRow}
        onVisibleRange={onVisibleRange}
        sorting={sorting}
        onSortingChange={setSorting}
      />
    </div>
  );
}
