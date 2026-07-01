import { Dialog, Transition } from "@headlessui/react";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Maximize2, X } from "lucide-react";
import { Fragment, memo, useMemo, useRef, useState } from "react";
import { ACTION_ICON_SIZE, actionButtonClassName } from "@/shared/ui/actionButton";
import { CopyButton } from "@/shared/ui/CopyButton";
import { RendererFrame } from "./RendererFrame";

interface CsvRendererProps {
  csv: string;
  language: string;
  name?: string;
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
  if (!csv.trim()) return [];

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
        row.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }

    // Add the last field
    row.push(current.trim());
    result.push(row);
  }

  return result;
};

const ROW_HEIGHT = 35;
const OVERSCAN = 20;

const cellBorder = "border-r last:border-r-0 border-neutral-200 dark:border-neutral-600";

// The virtualized table, rendered both inline (in the card) and full screen.
const CsvTable = ({ parsedData, scrollClassName }: { parsedData: string[][]; scrollClassName: string }) => {
  "use no memo";

  const scrollContainerRef = useRef<HTMLDivElement>(null);
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
    getCoreRowModel: getCoreRowModel(),
  });

  const tableRows = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  return (
    <div ref={scrollContainerRef} className={scrollClassName}>
      <table style={{ display: "grid", minWidth: "100%" }}>
        <thead className="sticky top-0 z-10 bg-neutral-100 dark:bg-neutral-900" style={{ display: "grid" }}>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} style={{ display: "flex" }}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className={`px-3 py-2 text-left text-sm font-semibold truncate ${cellBorder}`}
                  style={{ width: header.getSize(), flex: "none" }}
                  title={(header.column.columnDef.meta as { title: string } | undefined)?.title ?? ""}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
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
                className="hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60"
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
                    className={`px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 truncate ${cellBorder}`}
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
  );
};

const NonMemoizedCsvRenderer = ({ csv, language, name }: CsvRendererProps) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const parsedData = useMemo(() => parseCSV(csv), [csv]);
  const isEmpty = !csv.trim() || parsedData.length === 0;

  return (
    <>
      <RendererFrame
        label={language}
        name={name}
        actions={
          <>
            <CopyButton text={csv} label="Copy" />
            <button
              type="button"
              onClick={() => setIsFullscreen(true)}
              className={actionButtonClassName}
              title="Open in full screen"
              aria-label="Open CSV in full screen"
            >
              <Maximize2 size={ACTION_ICON_SIZE} />
              <span>Full screen</span>
            </button>
          </>
        }
      >
        {isEmpty ? (
          <div className="flex items-center justify-center h-24 text-neutral-500">
            <div className="flex items-center space-x-3">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-neutral-300 border-t-neutral-600 dark:border-neutral-600 dark:border-t-neutral-400" />
              <span>Loading CSV...</span>
            </div>
          </div>
        ) : (
          <CsvTable parsedData={parsedData} scrollClassName="overflow-auto max-h-96" />
        )}
      </RendererFrame>

      <Transition appear show={isFullscreen} as={Fragment}>
        <Dialog as="div" className="relative z-80" onClose={() => setIsFullscreen(false)}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/40 dark:bg-black/60" />
          </Transition.Child>

          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <Dialog.Panel className="fixed inset-0 flex flex-col bg-white dark:bg-neutral-950">
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
                <CopyButton text={csv} label="Copy" />
                <button
                  type="button"
                  onClick={() => setIsFullscreen(false)}
                  className="p-1.5 rounded-full text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                  title="Close"
                  aria-label="Close full screen"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 min-h-0">
                {!isEmpty && <CsvTable parsedData={parsedData} scrollClassName="overflow-auto h-full" />}
              </div>
            </Dialog.Panel>
          </Transition.Child>
        </Dialog>
      </Transition>
    </>
  );
};

export const CsvRenderer = memo(
  NonMemoizedCsvRenderer,
  (prevProps, nextProps) =>
    prevProps.csv === nextProps.csv && prevProps.language === nextProps.language && prevProps.name === nextProps.name,
);
