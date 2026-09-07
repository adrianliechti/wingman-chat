import {
  columnResizingFeature,
  columnSizingFeature,
  type ColumnDef,
  createSortedRowModel,
  rowSortingFeature,
  type SortingState,
  sortFns,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef, useState } from "react";
import { cn } from "@/shared/lib/cn";
import { parseDelimitedText } from "@/shared/lib/delimitedText";
import { fileExtension } from "@/shared/lib/utils";

const features = tableFeatures({
  columnSizingFeature,
  columnResizingFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns,
});

interface CsvEditorProps {
  content: string;
  path?: string;
  contentType?: string;
  viewMode?: "table" | "code";
  onViewModeChange?: (mode: "table" | "code") => void;
}

const ROW_HEIGHT = 35;
const OVERSCAN = 20;

export function CsvEditor({ content, path, contentType, viewMode = "table" }: CsvEditorProps) {
  "use no memo";

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [sorting, setSorting] = useState<SortingState>([]);

  const isTsv =
    fileExtension(path ?? "") === "tsv" ||
    contentType?.split(";", 1)[0].trim().toLowerCase() === "text/tab-separated-values";
  const parsed = useMemo(() => {
    if (viewMode === "code") return { data: [] as string[][], error: null as string | null };
    try {
      return { data: parseDelimitedText(content, isTsv ? { delimiter: "\t" } : {}), error: null };
    } catch (error) {
      return {
        data: [] as string[][],
        error: error instanceof Error ? error.message : "The delimited-text file is invalid",
      };
    }
  }, [content, isTsv, viewMode]);
  const parsedData = parsed.data;
  const rows = useMemo(() => parsedData.slice(1), [parsedData]);

  const columns = useMemo<ColumnDef<typeof features, string[]>[]>(() => {
    const headers = parsedData.length > 0 ? parsedData[0] : [];
    return headers.map((header, index) => ({
      id: String(index),
      header: () => header,
      accessorFn: (row: string[]) => row[index] ?? "",
      size: 150,
      minSize: 60,
      meta: { title: header },
    }));
  }, [parsedData]);

  const table = useTable({
    features,
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    columnResizeMode: "onChange",
  });

  const tableRows = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    // Use getBoundingClientRect for dynamic row measurement, except in Firefox
    // where it incorrectly measures table border height
    measureElement:
      typeof window !== "undefined" && !navigator.userAgent.includes("Firefox")
        ? (element) => element?.getBoundingClientRect().height
        : undefined,
  });

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      {viewMode === "code" ? (
        <div className="flex-1 overflow-auto min-h-0">
          <div className="p-4">
            <pre className="text-gray-800 dark:text-neutral-300 text-sm whitespace-pre-wrap overflow-x-auto font-mono">
              <code>{content}</code>
            </pre>
          </div>
        </div>
      ) : parsed.error ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-red-600 dark:text-red-400">
          {parsed.error}
        </div>
      ) : parsedData.length > 0 ? (
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
                            header.column.getIsResizing()
                              ? "bg-blue-500 dark:bg-blue-400"
                              : "bg-gray-400 dark:bg-neutral-500"
                          }`}
                        />
                      </button>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody
              style={{
                display: "grid",
                height: virtualizer.getTotalSize(),
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = tableRows[virtualRow.index];
                return (
                  <tr
                    key={row.id}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      display: "flex",
                      position: "absolute",
                      transform: `translateY(${virtualRow.start}px)`,
                      width: "100%",
                    }}
                  >
                    {row.getAllCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="px-3 py-2 text-sm text-gray-900 dark:text-neutral-100 border-r border-gray-200 dark:border-neutral-600 last:border-r-0 truncate"
                        style={{ width: cell.column.getSize(), flex: "none" }}
                        title={String(cell.getValue())}
                      >
                        <table.FlexRender cell={cell} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex-1 overflow-auto min-h-0">
          <div className="flex items-center justify-center h-24 text-gray-500 dark:text-neutral-500">
            <div className="text-center">
              <p>No CSV data to display</p>
              <p className="text-xs mt-1">The file appears to be empty or invalid</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
