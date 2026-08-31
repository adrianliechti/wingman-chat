import { useVirtualizer } from "@tanstack/react-virtual";
import { Loader2 } from "lucide-react";
import { memo, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/shared/lib/cn";
import {
  type XlsxCellView,
  type XlsxHtmlResult,
  type XlsxSheetHandle,
  type XlsxSheetView,
  xlsxToHtml,
} from "@/shared/lib/xlsxToHtml";
import { OfficeZoomControls } from "./OfficeZoomControls";
import { OfficeMarkdownEditor } from "./OfficeMarkdownEditor";
import { useOfficeConversion } from "./useOfficeConversion";

interface XlsxEditorProps {
  path: string;
  content: string;
  contentType?: string;
}

function useWorksheet(handle: XlsxSheetHandle | null): { sheet: XlsxSheetView | null; failed: boolean } {
  const [state, setState] = useState<{
    handle: XlsxSheetHandle | null;
    sheet: XlsxSheetView | null;
    failed: boolean;
  }>({
    handle: null,
    sheet: null,
    failed: false,
  });
  useEffect(() => {
    let cancelled = false;
    if (!handle) return;
    handle.load().then(
      (sheet) => {
        if (!cancelled) setState({ handle, sheet, failed: false });
      },
      () => {
        if (!cancelled) setState({ handle, sheet: null, failed: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [handle]);
  return state.handle === handle ? state : { sheet: null, failed: false };
}

interface CellPoint {
  row: number;
  column: number;
}

interface CellSelection {
  anchor: CellPoint;
  focus: CellPoint;
}

interface SelectionBounds {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

const ROW_HEADER_WIDTH = 46;
const COLUMN_HEADER_HEIGHT = 22;
const MAX_COPY_CELLS = 10_000;
const MAX_PINNED_ROWS = 128;
const MAX_PINNED_COLUMNS = 64;

function selectionBounds(selection: CellSelection): SelectionBounds {
  return {
    top: Math.min(selection.anchor.row, selection.focus.row),
    left: Math.min(selection.anchor.column, selection.focus.column),
    bottom: Math.max(selection.anchor.row, selection.focus.row),
    right: Math.max(selection.anchor.column, selection.focus.column),
  };
}

function pointInBounds(point: CellPoint, bounds: SelectionBounds): boolean {
  return (
    point.row >= bounds.top && point.row <= bounds.bottom && point.column >= bounds.left && point.column <= bounds.right
  );
}

function selectionTsv(sheet: XlsxSheetView, selection: CellSelection): string {
  const bounds = selectionBounds(selection);
  const width = Math.min(bounds.right - bounds.left + 1, MAX_COPY_CELLS);
  const right = bounds.left + width - 1;
  const height = Math.min(bounds.bottom - bounds.top + 1, Math.max(1, Math.floor(MAX_COPY_CELLS / width)));
  const bottom = bounds.top + height - 1;
  const lines: string[] = [];
  for (let row = bounds.top; row <= bottom; row++) {
    const values: string[] = [];
    for (let column = bounds.left; column <= right; column++) {
      values.push(sheet.cellAt(row, column)?.text.replace(/\r?\n/g, " ") ?? "");
    }
    lines.push(values.join("\t"));
  }
  return lines.join("\n");
}

/**
 * Spreadsheet preview backed by a sparse worksheet model. TanStack Virtual
 * mounts only the visible row/column cross-product while pinned panes,
 * selection, keyboard copy, and zoom remain React-owned interactions.
 */
export const XlsxEditor = memo(function XlsxEditor({ path, content, contentType }: XlsxEditorProps) {
  const { result, failed } = useOfficeConversion(path, content, contentType, xlsxToHtml);
  const [viewState, setViewState] = useState<{
    workbook: XlsxHtmlResult | null;
    activeSheet: number;
    zoom: number;
  }>({ workbook: null, activeSheet: 0, zoom: 1 });
  const view = viewState.workbook === result ? viewState : { workbook: result, activeSheet: 0, zoom: 1 };
  const { activeSheet, zoom } = view;
  const sheetIndex = result ? Math.max(0, Math.min(activeSheet, result.sheets.length - 1)) : 0;
  const sheetHandle = result?.sheets[sheetIndex] ?? null;
  const { sheet, failed: sheetFailed } = useWorksheet(sheetHandle);

  if (failed) return <OfficeMarkdownEditor path={path} content={content} contentType={contentType} />;
  if (!result) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-sm text-neutral-400 dark:text-neutral-500 p-8">
        <Loader2 size={16} className="animate-spin" />
        Rendering spreadsheet…
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col bg-white dark:bg-neutral-950">
      {sheet ? (
        <VirtualWorksheet key={`${sheetIndex}:${sheet.name}`} sheet={sheet} zoom={zoom} />
      ) : (
        <div className="flex-1 min-h-0 flex items-center justify-center gap-2 p-8 text-sm text-neutral-400 dark:text-neutral-500">
          {sheetFailed ? (
            "This sheet could not be rendered. You can still open another sheet."
          ) : (
            <>
              <Loader2 size={16} className="animate-spin" />
              Loading {sheetHandle?.name ?? "sheet"}…
            </>
          )}
        </div>
      )}
      <div className="flex h-8 shrink-0 items-stretch border-t border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto px-2" aria-label="Worksheets">
          {result.sheets.map((candidate, index) => (
            <button
              key={`${candidate.name}:${index}`}
              type="button"
              onClick={() => setViewState({ ...view, activeSheet: index })}
              className={cn(
                "shrink-0 border-b-2 px-3 text-xs transition-colors",
                index === sheetIndex
                  ? "border-green-600 bg-white font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                  : "border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200",
              )}
              title={candidate.name}
            >
              {candidate.name}
            </button>
          ))}
        </div>
        {sheet?.truncated && (
          <span
            className="hidden shrink-0 items-center px-2 text-[11px] text-amber-700 sm:flex dark:text-amber-400"
            title="Content beyond safe worksheet bounds is not shown"
          >
            Preview limited
          </span>
        )}
        <OfficeZoomControls
          value={zoom}
          onChange={(value) => setViewState({ ...view, zoom: value })}
          className="border-l border-neutral-200 dark:border-neutral-800"
        />
      </div>
    </div>
  );
});

function VirtualWorksheet({ sheet, zoom }: { sheet: XlsxSheetView; zoom: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const columnHeaderTrackRef = useRef<HTMLDivElement>(null);
  const rowHeaderTrackRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<CellSelection>({
    anchor: { row: 0, column: 0 },
    focus: { row: 0, column: 0 },
  });
  const [dragging, setDragging] = useState(false);

  const rowVirtualizer = useVirtualizer({
    count: sheet.rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => sheet.rowHeights[index] * zoom,
    overscan: 8,
  });
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: sheet.columnCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => sheet.columnWidths[index] * zoom,
    overscan: 4,
  });

  const syncWorksheetScroll = useCallback((element: HTMLDivElement) => {
    const left = element.scrollLeft;
    const top = element.scrollTop;
    columnHeaderTrackRef.current?.style.setProperty("transform", `translate3d(${-left}px,0,0)`);
    rowHeaderTrackRef.current?.style.setProperty("transform", `translate3d(0,${-top}px,0)`);
    element.style.setProperty("--xlsx-scroll-left", `${left}px`);
    element.style.setProperty("--xlsx-scroll-top", `${top}px`);
  }, []);

  useEffect(() => {
    rowVirtualizer.measure();
    columnVirtualizer.measure();
    if (scrollRef.current) syncWorksheetScroll(scrollRef.current);
  }, [columnVirtualizer, rowVirtualizer, syncWorksheetScroll, zoom]);

  useEffect(() => {
    if (!dragging) return;
    const stop = () => setDragging(false);
    window.addEventListener("pointerup", stop, { once: true });
    return () => window.removeEventListener("pointerup", stop);
  }, [dragging]);

  const bounds = selectionBounds(selection);
  const rowItems = rowVirtualizer.getVirtualItems();
  const columnItems = columnVirtualizer.getVirtualItems();
  const frozenRows = Math.min(sheet.frozenRows, MAX_PINNED_ROWS);
  const frozenColumns = Math.min(sheet.frozenColumns, MAX_PINNED_COLUMNS);

  const baseRowOffsets = useMemo(() => {
    const offsets = [0];
    for (const height of sheet.rowHeights) offsets.push(offsets[offsets.length - 1] + height);
    return offsets;
  }, [sheet]);
  const baseColumnOffsets = useMemo(() => {
    const offsets = [0];
    for (const width of sheet.columnWidths) offsets.push(offsets[offsets.length - 1] + width);
    return offsets;
  }, [sheet]);

  const selectCell = useCallback((point: CellPoint, extend: boolean) => {
    setSelection((current) => ({ anchor: extend ? current.anchor : point, focus: point }));
  }, []);

  const startSelection = (event: ReactPointerEvent, point: CellPoint) => {
    if ((event.target as Element).closest("a")) return;
    event.preventDefault();
    scrollRef.current?.focus({ preventScroll: true });
    selectCell(point, event.shiftKey);
    setDragging(true);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta =
      event.key === "ArrowUp"
        ? { row: -1, column: 0 }
        : event.key === "ArrowDown"
          ? { row: 1, column: 0 }
          : event.key === "ArrowLeft"
            ? { row: 0, column: -1 }
            : event.key === "ArrowRight"
              ? { row: 0, column: 1 }
              : undefined;
    if (!delta) return;
    event.preventDefault();
    const point = {
      row: Math.max(0, Math.min(sheet.rowCount - 1, selection.focus.row + delta.row)),
      column: Math.max(0, Math.min(sheet.columnCount - 1, selection.focus.column + delta.column)),
    };
    selectCell(point, event.shiftKey);
    rowVirtualizer.scrollToIndex(point.row, { align: "auto" });
    columnVirtualizer.scrollToIndex(point.column, { align: "auto" });
  };

  const renderCell = (row: number, column: number, pinnedRow: boolean, pinnedColumn: boolean) => {
    const cell = sheet.cellAt(row, column);
    if (!cell) return null;
    const baseWidth =
      baseColumnOffsets[Math.min(sheet.columnCount, column + cell.columnSpan)] - baseColumnOffsets[column];
    const baseHeight = baseRowOffsets[Math.min(sheet.rowCount, row + cell.rowSpan)] - baseRowOffsets[row];
    const left = baseColumnOffsets[column] * zoom;
    const top = baseRowOffsets[row] * zoom;
    const point = { row, column };
    const selected = pointInBounds(point, bounds);
    const key = `${row}:${column}`;
    return (
      <div
        key={`${pinnedRow ? "r" : ""}${pinnedColumn ? "c" : ""}:${key}`}
        role="gridcell"
        aria-rowindex={cell.sourceRow + 1}
        aria-colindex={cell.sourceColumn + 1}
        aria-selected={selected}
        className="absolute text-[14.67px] text-neutral-900"
        style={{
          left,
          top,
          width: baseWidth * zoom,
          height: baseHeight * zoom,
          zIndex: pinnedRow && pinnedColumn ? 24 : pinnedRow || pinnedColumn ? 20 : cell.spill ? 2 : 1,
          overflow: "visible",
          transform: `translate3d(${pinnedColumn ? "var(--xlsx-scroll-left, 0px)" : "0px"},${pinnedRow ? "var(--xlsx-scroll-top, 0px)" : "0px"},0)`,
        }}
        onPointerDown={(event) => startSelection(event, point)}
        onPointerEnter={() => {
          if (dragging) setSelection((current) => ({ ...current, focus: point }));
        }}
      >
        <CellContents
          cell={cell}
          width={baseWidth}
          height={baseHeight}
          zoom={zoom}
          pinned={pinnedRow || pinnedColumn}
        />
        {selected && (
          <span
            className="absolute inset-0 pointer-events-none"
            style={{
              background: "rgba(59,130,246,0.12)",
              boxShadow: "inset 0 0 0 1.5px rgb(37 99 235)",
            }}
          />
        )}
      </div>
    );
  };

  const frozenRowIndexes = Array.from({ length: frozenRows }, (_, index) => index);
  const frozenColumnIndexes = Array.from({ length: frozenColumns }, (_, index) => index);
  const visibleRows = rowItems.filter((item) => item.index >= frozenRows);
  const visibleColumns = columnItems.filter((item) => item.index >= frozenColumns);

  return (
    <div className="min-h-0 flex-1">
      <div
        className="grid h-full min-h-0"
        style={{
          gridTemplateColumns: `${ROW_HEADER_WIDTH}px minmax(0,1fr)`,
          gridTemplateRows: `${COLUMN_HEADER_HEIGHT}px minmax(0,1fr)`,
        }}
      >
        <button
          type="button"
          className="z-30 border-r border-b border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800"
          onClick={() =>
            setSelection({
              anchor: { row: 0, column: 0 },
              focus: { row: sheet.rowCount - 1, column: sheet.columnCount - 1 },
            })
          }
          aria-label="Select sheet"
        />
        <div className="relative overflow-hidden border-b border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800">
          <div
            ref={columnHeaderTrackRef}
            data-testid="xlsx-column-header-track"
            className="absolute inset-y-0 left-0"
            style={{ width: columnVirtualizer.getTotalSize(), willChange: "transform" }}
          >
            {visibleColumns.map((item) => (
              <HeaderCell
                key={item.key}
                label={sheet.columnLabels[item.index]}
                start={item.start}
                size={item.size}
                axis="column"
              />
            ))}
          </div>
          {frozenColumnIndexes.map((column) => (
            <HeaderCell
              key={`frozen:${column}`}
              label={sheet.columnLabels[column]}
              start={baseColumnOffsets[column] * zoom}
              size={sheet.columnWidths[column] * zoom}
              axis="column"
              pinned
            />
          ))}
        </div>
        <div className="relative overflow-hidden border-r border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800">
          <div
            ref={rowHeaderTrackRef}
            data-testid="xlsx-row-header-track"
            className="absolute inset-x-0 top-0"
            style={{ height: rowVirtualizer.getTotalSize(), willChange: "transform" }}
          >
            {visibleRows.map((item) => (
              <HeaderCell
                key={item.key}
                label={String(sheet.rowNumbers[item.index])}
                start={item.start}
                size={item.size}
                axis="row"
              />
            ))}
          </div>
          {frozenRowIndexes.map((row) => (
            <HeaderCell
              key={`frozen:${row}`}
              label={String(sheet.rowNumbers[row])}
              start={baseRowOffsets[row] * zoom}
              size={sheet.rowHeights[row] * zoom}
              axis="row"
              pinned
            />
          ))}
        </div>

        <div
          ref={scrollRef}
          role="grid"
          tabIndex={0}
          aria-rowcount={sheet.rowCount}
          aria-colcount={sheet.columnCount}
          data-testid="xlsx-grid-scroll"
          className="relative overflow-auto outline-none bg-white focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400"
          onScroll={(event) => syncWorksheetScroll(event.currentTarget)}
          onKeyDown={onKeyDown}
          onCopy={(event) => {
            event.preventDefault();
            event.clipboardData.setData("text/plain", selectionTsv(sheet, selection));
          }}
        >
          <div
            className="relative font-[Calibri,'Segoe_UI',system-ui,sans-serif text-neutral-900"
            style={{ width: columnVirtualizer.getTotalSize(), height: rowVirtualizer.getTotalSize() }}
          >
            {visibleRows.flatMap((row) =>
              visibleColumns.map((column) => renderCell(row.index, column.index, false, false)),
            )}
            {frozenRowIndexes.flatMap((row) =>
              visibleColumns.map((column) => renderCell(row, column.index, true, false)),
            )}
            {visibleRows.flatMap((row) =>
              frozenColumnIndexes.map((column) => renderCell(row.index, column, false, true)),
            )}
            {frozenRowIndexes.flatMap((row) =>
              frozenColumnIndexes.map((column) => renderCell(row, column, true, true)),
            )}
            {sheet.overlayHtml && (
              <div
                className="absolute left-0 top-0 origin-top-left pointer-events-none z-10"
                style={{
                  width: baseColumnOffsets.at(-1),
                  height: baseRowOffsets.at(-1),
                  transform: `scale(${zoom})`,
                }}
                dangerouslySetInnerHTML={{ __html: sheet.overlayHtml }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CellContents({
  cell,
  width,
  height,
  zoom,
  pinned,
}: {
  cell: XlsxCellView;
  width: number;
  height: number;
  zoom: number;
  pinned: boolean;
}) {
  const background = pinned ? "background:#fff;" : "";
  return (
    <div
      className="origin-top-left"
      style={{ width, height, transform: `scale(${zoom})` }}
      dangerouslySetInnerHTML={{
        __html: `<div style="${background}box-sizing:border-box;display:flex;align-items:flex-end;width:${width}px;height:${height}px;padding:1px 4px;overflow:hidden;white-space:nowrap;text-overflow:clip;line-height:1.2;${cell.css}"><span style="display:block;width:100%;min-width:0;">${cell.html}</span></div>`,
      }}
    />
  );
}

function HeaderCell({
  label,
  start,
  size,
  axis,
  pinned = false,
}: {
  label: string;
  start: number;
  size: number;
  axis: "row" | "column";
  pinned?: boolean;
}) {
  return (
    <div
      className={cn(
        "absolute flex items-center justify-center select-none text-[11px] text-neutral-500 border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800",
        axis === "column" ? "h-full border-r" : "w-full border-b",
        pinned && "z-20",
      )}
      style={axis === "column" ? { left: start, width: size } : { top: start, height: size }}
    >
      {label}
    </div>
  );
}
