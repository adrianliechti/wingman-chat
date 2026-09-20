import {
  columnResizingFeature,
  columnSizingFeature,
  type ColumnDef,
  type OnChangeFn,
  rowSortingFeature,
  type SortingState,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/shared/lib/cn";

const features = tableFeatures({
  columnSizingFeature,
  columnResizingFeature,
  rowSortingFeature,
});

export interface DataTableColumn {
  name: string;
  /** Shown in the header tooltip, e.g. a SQL type. */
  detail?: string;
}

interface DataTableProps {
  columns: DataTableColumn[];
  /** Total rows, including ones not loaded yet. */
  rowCount: number;
  /** A row's cells as text, or undefined while it is still loading. */
  getRow: (index: number) => string[] | undefined;
  /** The window of row indexes on screen (with overscan), for windowed loading. */
  onVisibleRange?: (start: number, end: number) => void;
  sorting: SortingState;
  /** Sorting is the caller's job (e.g. an ORDER BY); the grid only shows the state. */
  onSortingChange: OnChangeFn<SortingState>;
}

const ROW_HEIGHT = 35;
const OVERSCAN = 20;
const EMPTY_ROWS: string[][] = [];

/**
 * A resizable, virtualised grid whose rows arrive from the caller on demand,
 * so a million-row file costs only the rows on screen. TanStack manages the
 * columns (sizing, sort state); the body is rendered from `getRow`.
 */
export function DataTable({ columns: inputColumns, rowCount, getRow, onVisibleRange, sorting, onSortingChange }: DataTableProps) {
  "use no memo";

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const columns = useMemo<ColumnDef<typeof features, string[]>[]>(
    () =>
      inputColumns.map((column, index) => ({
        id: String(index),
        header: () => column.name,
        accessorFn: (row: string[]) => row[index] ?? "",
        size: 150,
        minSize: 60,
        sortDescFirst: false,
        meta: { title: column.detail ? `${column.name} (${column.detail})` : column.name },
      })),
    [inputColumns],
  );

  const table = useTable({
    features,
    data: EMPTY_ROWS,
    columns,
    state: { sorting },
    onSortingChange,
    manualSorting: true,
    columnResizeMode: "onChange",
  });
  const leafColumns = table.getAllLeafColumns();

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const first = virtualItems[0]?.index ?? 0;
  const last = virtualItems.at(-1)?.index ?? -1;
  useEffect(() => {
    if (last >= first) onVisibleRange?.(first, last);
  }, [first, last, onVisibleRange]);

  return (
    <div ref={scrollContainerRef} className="flex-1 overflow-auto min-h-0">
      <table style={{ display: "grid", minWidth: "100%" }}>
        <thead
          className="sticky top-0 z-10 bg-gray-50 dark:bg-neutral-900 border-b border-gray-300 dark:border-neutral-600"
          style={{ display: "grid" }}
        >
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} style={{ display: "flex" }}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="relative px-3 py-2.5 text-left text-xs font-semibold text-gray-700 dark:text-neutral-200 uppercase tracking-wider border-r border-gray-200 dark:border-neutral-700 last:border-r-0 truncate select-none group cursor-default"
                  style={{ width: header.getSize(), flex: "none" }}
                  title={(header.column.columnDef.meta as { title: string } | undefined)?.title ?? ""}
                >
                  <button
                    type="button"
                    className={cn("text-left", header.column.getCanSort() && "cursor-pointer")}
                    onClick={header.column.getToggleSortingHandler()}
                    disabled={!header.column.getCanSort()}
                  >
                    <table.FlexRender header={header} />
                    {{ asc: " ▲", desc: " ▼" }[header.column.getIsSorted() as string] ?? ""}
                  </button>
                  <button
                    type="button"
                    onMouseDown={header.getResizeHandler()}
                    onTouchStart={header.getResizeHandler()}
                    onDoubleClick={() => header.column.resetSize()}
                    aria-label={`Resize ${
                      (header.column.columnDef.meta as { title: string } | undefined)?.title ?? header.id
                    } column`}
                    className={`absolute right-0 top-0 h-full w-2 z-10 select-none touch-none flex items-center justify-end ${
                      header.column.getIsResizing() ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                    style={{ cursor: "col-resize" }}
                  >
                    <span
                      className={`block h-full w-0.5 ${
                        header.column.getIsResizing() ? "bg-blue-500 dark:bg-blue-400" : "bg-gray-400 dark:bg-neutral-500"
                      }`}
                    />
                  </button>
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody style={{ display: "grid", height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualItems.map((virtualRow) => {
            const row = getRow(virtualRow.index);
            return (
              <tr
                key={virtualRow.index}
                data-index={virtualRow.index}
                style={{
                  display: "flex",
                  position: "absolute",
                  transform: `translateY(${virtualRow.start}px)`,
                  width: "100%",
                  height: ROW_HEIGHT,
                }}
              >
                {leafColumns.map((column, index) => {
                  const value = row?.[index];
                  return (
                    <td
                      key={column.id}
                      className={cn(
                        "px-3 py-2 text-sm border-r border-gray-200 dark:border-neutral-600 last:border-r-0 truncate",
                        row ? "text-gray-900 dark:text-neutral-100" : "text-gray-300 dark:text-neutral-700",
                      )}
                      style={{ width: column.getSize(), flex: "none" }}
                      title={value ?? ""}
                    >
                      {row ? value : "…"}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
