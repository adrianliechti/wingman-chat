import { useRef, useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

interface CsvEditorProps {
  content: string;
  viewMode?: "table" | "code";
  onViewModeChange?: (mode: "table" | "code") => void;
}

// Utility function to detect separator (comma, semicolon, or tab)
const detectSeparator = (csv: string): string => {
  if (!csv.trim()) return ",";

  const firstLine = csv.trim().split("\n")[0];
  let commaCount = 0;
  let semicolonCount = 0;
  let tabCount = 0;
  let inQuotes = false;

  for (let i = 0; i < firstLine.length; i++) {
    const char = firstLine[i];
    const nextChar = firstLine[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        i++; // Skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes) {
      if (char === ",") commaCount++;
      if (char === ";") semicolonCount++;
      if (char === "\t") tabCount++;
    }
  }

  // Return the separator with the highest count
  if (tabCount > 0 && tabCount >= commaCount && tabCount >= semicolonCount) return "\t";
  if (semicolonCount > commaCount) return ";";
  return ",";
};

// Utility function to parse CSV content
const parseCSV = (csv: string): string[][] => {
  if (!csv.trim()) return []; // Return empty array for empty content

  const separator = detectSeparator(csv);
  const lines = csv.trim().split("\n");
  const result: string[][] = [];

  for (const line of lines) {
    const row: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote
          current += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === separator && !inQuotes) {
        // End of field
        row.push(current);
        current = "";
      } else {
        current += char;
      }
    }

    // Add the last field
    row.push(current);
    result.push(row);
  }

  return result;
};

const ROW_HEIGHT = 35;
const OVERSCAN = 20;

export function CsvEditor({ content, viewMode = "table" }: CsvEditorProps) {
  "use no memo";

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [sorting, setSorting] = useState<SortingState>([]);

  const parsedData = useMemo(() => parseCSV(content), [content]);
  const rows = useMemo(() => parsedData.slice(1), [parsedData]);

  const columns = useMemo<ColumnDef<string[]>[]>(() => {
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

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
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
      ) : parsedData.length > 0 ? (
        <div ref={scrollContainerRef} className="flex-1 overflow-auto min-h-0">
          <table style={{ display: "grid", minWidth: "100%" }}>
            <thead className="sticky top-0 z-10 bg-white dark:bg-neutral-900" style={{ display: "grid" }}>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} style={{ display: "flex" }}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="relative px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider border-r border-gray-200 dark:border-neutral-600 last:border-r-0 truncate select-none group"
                      style={{ width: header.getSize(), flex: "none" }}
                      title={(header.column.columnDef.meta as { title: string } | undefined)?.title ?? ""}
                    >
                      <span
                        className={header.column.getCanSort() ? "cursor-pointer" : ""}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {{ asc: " ▲", desc: " ▼" }[header.column.getIsSorted() as string] ?? ""}
                      </span>
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onDoubleClick={() => header.column.resetSize()}
                        className={`absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none opacity-0 group-hover:opacity-100 bg-gray-400 dark:bg-neutral-500 ${
                          header.column.getIsResizing() ? "!opacity-100 bg-blue-500 dark:bg-blue-400" : ""
                        }`}
                      />
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
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="px-3 py-2 text-sm text-gray-900 dark:text-neutral-100 border-r border-gray-200 dark:border-neutral-600 last:border-r-0 truncate"
                        style={{ width: cell.column.getSize(), flex: "none" }}
                        title={String(cell.getValue())}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
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
