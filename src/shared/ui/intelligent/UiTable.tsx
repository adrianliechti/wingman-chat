import {
  type ColumnDef,
  createSortedRowModel,
  rowSortingFeature,
  type SortingState,
  sortFns,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/shared/lib/cn";
import { formatValue, stringify } from "@/shared/lib/intelligentUi/expression";

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns,
});

export interface UiTableColumn {
  key: string | number;
  label?: string;
  align?: "start" | "center" | "end";
  format?: string;
  currency?: string;
  digits?: number | string;
}

export interface UiTableProps {
  columns?: UiTableColumn[];
  rows: unknown;
  sortable?: boolean;
  pageSize?: number;
  emptyText?: string;
}

type Row = Record<string, unknown>;

const MAX_ROWS = 5_000;

function toRows(raw: unknown): Row[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_ROWS).map((row): Row => {
    if (row && typeof row === "object" && !Array.isArray(row)) return row as Row;
    if (Array.isArray(row)) return Object.fromEntries(row.map((cell, index) => [String(index), cell]));
    return { value: row };
  });
}

function cellText(value: unknown, column: UiTableColumn): string {
  if (column.format && column.format !== "text") {
    const digits = column.digits === undefined ? undefined : Number(column.digits);
    return formatValue(value, column.format, Number.isFinite(digits) ? digits : undefined, column.currency);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return stringify(value);
}

function isNumericColumn(rows: Row[], key: string): boolean {
  return (
    rows.length > 0 && rows.every((row) => row[key] === null || row[key] === undefined || typeof row[key] === "number")
  );
}

export function UiTable({ columns: declared, rows: raw, sortable = true, pageSize, emptyText }: UiTableProps) {
  "use no memo";

  const rows = useMemo(() => toRows(raw), [raw]);
  const columns = useMemo<UiTableColumn[]>(() => {
    if (declared?.length) return declared;
    const keys = new Set<string>();
    for (const row of rows.slice(0, 50)) for (const key of Object.keys(row)) keys.add(key);
    return [...keys].map((key) => ({ key, label: key }));
  }, [declared, rows]);

  const [sorting, setSorting] = useState<SortingState>([]);
  const [page, setPage] = useState(0);
  const size = Math.max(1, Math.min(200, pageSize ?? (rows.length > 25 ? 15 : rows.length || 1)));

  const columnDefs = useMemo<ColumnDef<typeof features, Row>[]>(
    () =>
      columns.map((column) => {
        const key = String(column.key);
        const numeric = isNumericColumn(rows, key);
        return {
          id: key,
          header: () => column.label ?? key,
          accessorFn: (row: Row) => row[key],
          sortingFn: numeric ? "basic" : "alphanumeric",
          sortUndefined: "last",
          meta: { column, numeric },
        };
      }),
    [columns, rows],
  );

  const table = useTable({
    features,
    data: rows,
    columns: columnDefs,
    state: { sorting },
    onSortingChange: (updater) => {
      setSorting(updater);
      setPage(0);
    },
    enableSorting: sortable,
  });

  const sorted = table.getRowModel().rows;
  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const current = Math.min(page, pages - 1);
  const visible = sorted.slice(current * size, current * size + size);

  if (rows.length === 0) {
    return <p className="py-3 text-center text-xs text-neutral-500">{emptyText ?? "No rows"}</p>;
  }

  return (
    <div className="w-full">
      <div className="overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-neutral-100/80 text-xs text-neutral-600 dark:bg-neutral-900/60 dark:text-neutral-400">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const meta = header.column.columnDef.meta as { column: UiTableColumn; numeric: boolean };
                  const align = meta.column.align ?? (meta.numeric ? "end" : "start");
                  const sortDir = header.column.getIsSorted();
                  const canSort = sortable && header.column.getCanSort();
                  return (
                    <th
                      key={header.id}
                      className={cn(
                        "px-3 py-2 font-medium whitespace-nowrap select-none",
                        align === "end" ? "text-right" : align === "center" ? "text-center" : "text-left",
                        canSort && "cursor-pointer hover:text-neutral-900 dark:hover:text-neutral-100",
                      )}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                      aria-sort={sortDir === "asc" ? "ascending" : sortDir === "desc" ? "descending" : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        {header.isPlaceholder ? null : (header.column.columnDef.header as () => string)()}
                        {sortDir === "asc" && <ArrowUp className="h-3 w-3" />}
                        {sortDir === "desc" && <ArrowDown className="h-3 w-3" />}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={row.id}
                className="border-t border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900/40"
              >
                {row.getAllCells().map((cell) => {
                  const meta = cell.column.columnDef.meta as { column: UiTableColumn; numeric: boolean };
                  const align = meta.column.align ?? (meta.numeric ? "end" : "start");
                  return (
                    <td
                      key={cell.id}
                      className={cn(
                        "px-3 py-1.5 text-neutral-800 dark:text-neutral-200",
                        align === "end" ? "text-right tabular-nums" : align === "center" ? "text-center" : "text-left",
                      )}
                    >
                      {cellText(cell.getValue(), meta.column)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="mt-1.5 flex items-center justify-end gap-2 text-xs text-neutral-500">
          <span>
            {current * size + 1}–{Math.min(sorted.length, (current + 1) * size)} of {sorted.length}
          </span>
          <button
            type="button"
            className="rounded p-0.5 hover:bg-neutral-200 disabled:opacity-40 dark:hover:bg-neutral-800"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={current === 0}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="rounded p-0.5 hover:bg-neutral-200 disabled:opacity-40 dark:hover:bg-neutral-800"
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            disabled={current >= pages - 1}
            aria-label="Next page"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
