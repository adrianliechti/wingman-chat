import type { SortingState } from "@tanstack/react-table";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useArtifacts } from "@/features/artifacts/hooks/useArtifacts";
import { createDuckDbWorkspace, type DuckDbWorkspaceHost } from "@/features/artifacts/lib/duckdbWorkspace";
import type { FileSystemManager } from "@/features/artifacts/lib/fs";
import { contentToBlob } from "@/shared/lib/fileContent";
import type { File as ArtifactFile } from "@/shared/types/file";
import { DataTable, type DataTableColumn } from "./DataTable";
import { cellText, createDataCellFormatter, isTemporalDataType } from "./dataCell";

interface DataEditorProps {
  path: string;
  snapshot?: ArtifactFile;
}

/** Rows fetched per window query. */
const CHUNK = 500;
const MAX_CACHED_CHUNKS = 8;

interface Mounted {
  path: string;
  fs: FileSystemManager;
  host: DuckDbWorkspaceHost;
}

interface Shape {
  source: string;
  columns: (DataTableColumn & { formatValue: (value: unknown) => string })[];
  total: number;
}

const quoteLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;
const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read-only grid over any tabular artifact DuckDB can scan by name: CSV, TSV,
 * JSONL, Parquet, Arrow. Rows are fetched in windows as the grid scrolls and
 * sorted by DuckDB, with a bounded cache of loaded windows.
 */
export function DataEditor({ path, snapshot }: DataEditorProps) {
  const { fs } = useArtifacts();
  const [mounted, setMounted] = useState<Mounted | null>(null);
  const [shape, setShape] = useState<Shape | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [error, setError] = useState<string | null>(null);
  const chunks = useRef(new Map<number, string[][]>());
  const pending = useRef(new Set<number>());
  // Bumped whenever the cache is cleared; answers from an older generation are dropped.
  const generation = useRef(0);
  const shapeGeneration = useRef(0);
  const visible = useRef<[number, number] | null>(null);
  const [version, setVersion] = useState(0);
  const [fileRevision, setFileRevision] = useState(0);
  const snapshotContent = snapshot?.content;
  const snapshotType = snapshot?.contentType;

  useEffect(() => {
    if (!fs) return;
    const host = createDuckDbWorkspace(fs, {
      snapshot:
        snapshotContent === undefined
          ? undefined
          : {
              path,
              file: new File([contentToBlob(snapshotContent, snapshotType)], path, { type: snapshotType }),
            },
    });
    generation.current++;
    shapeGeneration.current++;
    chunks.current.clear();
    pending.current.clear();
    visible.current = null;
    setMounted({ fs, path, host });
    setShape(null);
    setError(null);
    setSorting([]);
    const changed = (changedPath: string) => {
      if (changedPath !== path && !path.startsWith(`${changedPath}/`)) return;
      generation.current++;
      shapeGeneration.current++;
      chunks.current.clear();
      pending.current.clear();
      setShape(null);
      setError(null);
      setFileRevision((value) => value + 1);
    };
    const subscriptions =
      snapshotContent !== undefined
        ? []
        : [
            fs.subscribe("fileCreated", changed),
            fs.subscribe("fileUpdated", changed),
            fs.subscribe("fileDeleted", changed),
            fs.subscribe("fileRenamed", (from, to) => {
              changed(from);
              changed(to);
            }),
          ];
    return () => {
      generation.current++;
      shapeGeneration.current++;
      subscriptions.forEach((off) => off());
      host.dispose();
    };
  }, [fs, path, snapshotContent, snapshotType]);

  const source = mounted?.fs === fs && mounted?.path === path ? quoteLiteral(path.replace(/^\/+/, "")) : null;

  // Columns and the row count.
  useEffect(() => {
    if (!mounted || !source) return;
    let cancelled = false;
    const started = shapeGeneration.current;
    chunks.current.clear();
    pending.current.clear();
    setShape(null);
    setSorting([]);
    Promise.all([
      mounted.host.query(null, `DESCRIBE SELECT * FROM ${source}`),
      mounted.host.query(null, `SELECT count(*) AS n FROM ${source}`),
    ])
      .then(([described, counted]) => {
        if (cancelled || started !== shapeGeneration.current) return;
        setShape({
          source,
          columns: described.rows.map((row) => ({
            name: cellText(row.column_name),
            detail: cellText(row.column_type),
            formatValue: createDataCellFormatter(cellText(row.column_type)),
          })),
          total: Number(counted.rows[0]?.n ?? 0),
        });
      })
      .catch((cause: unknown) => {
        if (!cancelled && started === shapeGeneration.current) setError(describe(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [mounted, source, fileRevision]);

  const orderBy = useMemo(() => {
    const column = sorting[0] ? shape?.columns[Number(sorting[0].id)] : undefined;
    // Qualify the input column so sorting uses its original type, not the text alias.
    return column ? ` ORDER BY data.${quoteIdentifier(column.name)} ${sorting[0].desc ? "DESC" : "ASC"}` : "";
  }, [sorting, shape]);

  const projection = useMemo(
    () =>
      shape?.columns
        .map((column) => {
          const name = quoteIdentifier(column.name);
          // Arrow's date conversion loses timestamp precision and represents
          // TIME as an integer. Ask DuckDB for lossless text only in this preview.
          return isTemporalDataType(column.detail) ? `CAST(data.${name} AS VARCHAR) AS ${name}` : `data.${name}`;
        })
        .join(", "),
    [shape],
  );

  const loadChunk = useCallback(
    (index: number) => {
      if (!mounted || !shape || pending.current.has(index)) return;
      const cached = chunks.current.get(index);
      if (cached) {
        chunks.current.delete(index);
        chunks.current.set(index, cached);
        return;
      }
      pending.current.add(index);
      const started = generation.current;
      const query = `SELECT ${projection} FROM ${shape.source} AS data${orderBy} LIMIT ${CHUNK} OFFSET ${index * CHUNK}`;
      mounted.host
        .query(null, query)
        .then((result) => {
          // An answer for an earlier sort order is stale; drop it.
          if (started !== generation.current) return;
          pending.current.delete(index);
          chunks.current.set(
            index,
            result.rows.map((row) => shape.columns.map((column) => column.formatValue(row[column.name]))),
          );
          while (chunks.current.size > MAX_CACHED_CHUNKS) {
            chunks.current.delete(chunks.current.keys().next().value!);
          }
          setVersion((value) => value + 1);
        })
        .catch((cause: unknown) => {
          if (started !== generation.current) return;
          pending.current.delete(index);
          setError(describe(cause));
        });
    },
    [mounted, shape, orderBy, projection],
  );

  const request = useCallback(
    (start: number, end: number) => {
      if (!shape) return;
      const last = Math.min(end, shape.total - 1);
      for (let index = Math.floor(start / CHUNK); index <= Math.floor(last / CHUNK); index++) loadChunk(index);
    },
    [loadChunk, shape],
  );

  // A new sort order invalidates every loaded window; the rows on screen are
  // requested again right away rather than on the next scroll.
  useEffect(() => {
    generation.current += 1;
    chunks.current.clear();
    pending.current.clear();
    setVersion((value) => value + 1);
    if (visible.current) request(...visible.current);
    return () => {
      generation.current++;
    };
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
