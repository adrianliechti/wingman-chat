import { Dialog, Transition } from "@headlessui/react";
import type { Components } from "hast-util-to-jsx-runtime";
import katex from "katex";
import { Copy, CopyCheck, Download, Maximize2, Printer, X } from "lucide-react";
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import rehypeKatex from "rehype-katex";
import rehypeReact from "rehype-react";
import remarkBreaks from "remark-breaks";
import remarkGemoji from "remark-gemoji";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { cn } from "@/shared/lib/cn";
import "katex/dist/katex.min.css";
import type { ReactNode } from "react";
import { copyToClipboard } from "@/shared/lib/copy";
import { isAudioUrl, isVideoUrl } from "@/shared/lib/mediaTypes";
import rehypeNotoEmoji from "@/shared/lib/rehype-noto-emoji";
import { useAssetUrlResolver } from "@/shared/lib/useAssetUrlResolver";
import { downloadBlob } from "@/shared/lib/utils";
import type { FileSystem } from "@/shared/types/file";
import { ACTION_ICON_SIZE, actionButtonClassName } from "./actionButton";
import { CodeRenderer } from "./CodeRenderer";
import { MediaPlayer } from "./MediaPlayer";
import { CsvRenderer } from "./renderers/CsvRenderer";
import { HtmlRenderer } from "./renderers/HtmlRenderer";
import { MarkdownRenderer } from "./renderers/MarkdownRenderer";
import { RendererFrame } from "./renderers/RendererFrame";
import { SvgRenderer } from "./renderers/SvgRenderer";

const markdownLinkClassName =
  "text-sky-700 dark:text-sky-300 underline decoration-2 underline-offset-3 decoration-sky-500/60 dark:decoration-sky-400/70 hover:text-sky-800 dark:hover:text-sky-200 hover:decoration-current focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50";

const slugify = (children: ReactNode): string => {
  const text = extractText(children);
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const getInternalHash = (url: string): string | null => {
  if (!url) return null;
  if (url.startsWith("#")) return decodeURIComponent(url.slice(1));
  if (typeof window === "undefined") return null;
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.origin === window.location.origin && parsed.pathname === window.location.pathname && parsed.hash) {
      return decodeURIComponent(parsed.hash.slice(1));
    }
  } catch {
    /* ignore */
  }
  return null;
};

const extractText = (node: ReactNode): string => {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
};

function LatexRenderer({ code, filename }: { code: string; filename?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    try {
      katex.render(code, container, {
        displayMode: true,
        throwOnError: false,
        strict: "ignore",
        errorColor: "transparent",
        trust: true,
        fleqn: false,
      });
      setFailed(false);
    } catch (error) {
      console.warn("KaTeX rendering failed:", error);
      setFailed(true);
    }
  }, [code]);

  if (failed) {
    return <CodeRenderer code={code} language="latex" name={filename} />;
  }

  return (
    <div className="my-4">
      {filename && <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-2 font-mono">{filename}</div>}
      <div ref={containerRef} className="overflow-x-auto" />
    </div>
  );
}

const MIN_COLUMN_WIDTH = 60;
const TABLE_CSV_FILENAME = "table.csv";

const escapeCsvCell = (value: string): string => {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!/[",\n]/.test(normalized)) return normalized;
  return `"${normalized.replace(/"/g, '""')}"`;
};

const tableElementToCsv = (table: HTMLTableElement | null): string => {
  if (!table) return "";

  const rows = Array.from(table.rows)
    .map((row) =>
      Array.from(row.cells).flatMap((cell) => {
        const colSpan = Math.max(1, cell.colSpan || 1);
        const text = cell.innerText.replace(/\s+/g, " ").trim();
        return [text, ...Array.from({ length: colSpan - 1 }, () => "")];
      }),
    )
    .filter((row) => row.length > 0);

  if (rows.length === 0) return "";

  const columnCount = Math.max(...rows.map((row) => row.length));
  return rows
    .map((row) => Array.from({ length: columnCount }, (_, index) => escapeCsvCell(row[index] ?? "")).join(","))
    .join("\r\n");
};

const tableElementToTsv = (table: HTMLTableElement | null): string => {
  if (!table) return "";

  const rows = Array.from(table.rows)
    .map((row) =>
      Array.from(row.cells).flatMap((cell) => {
        const colSpan = Math.max(1, cell.colSpan || 1);
        const text = cell.innerText.replace(/\r?\n/g, " ").replace(/\t/g, " ").replace(/\s+/g, " ").trim();
        return [text, ...Array.from({ length: colSpan - 1 }, () => "")];
      }),
    )
    .filter((row) => row.length > 0);

  if (rows.length === 0) return "";

  const columnCount = Math.max(...rows.map((row) => row.length));
  return rows.map((row) => Array.from({ length: columnCount }, (_, index) => row[index] ?? "").join("\t")).join("\n");
};

const printTableElement = (table: HTMLTableElement | null): void => {
  if (!table) return;

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  const printDocument = iframe.contentDocument;
  if (!printDocument) {
    iframe.remove();
    return;
  }

  printDocument.open();
  printDocument.write(`<!doctype html>
<html>
  <head>
    <title>Table</title>
    <style>
      body { margin: 24px; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; }
      table { border-collapse: collapse; width: 100%; font-size: 12px; }
      th, td { border: 1px solid #d4d4d4; padding: 6px 8px; text-align: left; vertical-align: top; }
      th { background: #f5f5f5; font-weight: 600; }
    </style>
  </head>
  <body>${table.outerHTML}</body>
</html>`);
  printDocument.close();

  iframe.contentWindow?.focus();
  iframe.contentWindow?.print();
  window.setTimeout(() => iframe.remove(), 1000);
};

type ResizableTableProps = {
  children?: ReactNode;
  scrollClassName?: string;
  onTableElement?: (table: HTMLTableElement | null) => void;
} & React.TableHTMLAttributes<HTMLTableElement>;

function ResizableTable({
  children,
  className,
  onTableElement,
  scrollClassName = "overflow-x-auto",
  style,
  ...props
}: ResizableTableProps) {
  const tableRef = useRef<HTMLTableElement>(null);
  const [widths, setWidths] = useState<number[] | null>(null);
  const [columnRights, setColumnRights] = useState<number[]>([]);
  const resizingRef = useRef<{
    index: number;
    startX: number;
    widthsAtStart: number[];
  } | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const setTableElement = useCallback(
    (table: HTMLTableElement | null) => {
      tableRef.current = table;
      onTableElement?.(table);
    },
    [onTableElement],
  );

  const measureColumnRights = useCallback(() => {
    const table = tableRef.current;
    if (!table) return;
    const headers = table.querySelectorAll<HTMLTableCellElement>("thead tr:first-child > *");
    if (headers.length === 0) return;
    const tableLeft = table.getBoundingClientRect().left;
    const rights = Array.from(headers).map((h) => h.getBoundingClientRect().right - tableLeft);
    setColumnRights((prev) => {
      if (prev.length === rights.length && prev.every((v, i) => Math.abs(v - rights[i]) < 0.5)) {
        return prev;
      }
      return rights;
    });
  }, []);

  useLayoutEffect(() => {
    void children;
    void widths;
    measureColumnRights();
  }, [measureColumnRights, children, widths]);

  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const ro = new ResizeObserver(() => measureColumnRights());
    ro.observe(table);
    return () => ro.disconnect();
  }, [measureColumnRights]);

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: PointerEvent) => {
      const state = resizingRef.current;
      if (!state) return;
      const delta = e.clientX - state.startX;
      const next = [...state.widthsAtStart];
      next[state.index] = Math.max(MIN_COLUMN_WIDTH, state.widthsAtStart[state.index] + delta);
      setWidths(next);
    };
    const onUp = () => {
      resizingRef.current = null;
      setIsResizing(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [isResizing]);

  const startResize = (index: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const table = tableRef.current;
    if (!table) return;
    const headers = table.querySelectorAll<HTMLTableCellElement>("thead tr:first-child > *");
    if (headers.length === 0) return;
    const currentWidths = Array.from(headers).map((h) => h.getBoundingClientRect().width);
    resizingRef.current = {
      index,
      startX: e.clientX,
      widthsAtStart: currentWidths,
    };
    setWidths(currentWidths);
    setIsResizing(true);
  };

  const measureNeededColumnWidth = useCallback((index: number): number | null => {
    const table = tableRef.current;
    if (!table) return null;

    const columnCount =
      table.querySelectorAll<HTMLTableCellElement>("thead tr:first-child > *").length ||
      table.querySelectorAll<HTMLTableCellElement>("tr:first-child > *").length;
    if (columnCount === 0 || index >= columnCount) return null;

    const clone = table.cloneNode(true) as HTMLTableElement;
    clone.querySelectorAll("colgroup").forEach((colgroup) => {
      colgroup.remove();
    });
    clone.classList.remove("w-full");
    clone.style.position = "absolute";
    clone.style.left = "-10000px";
    clone.style.top = "0";
    clone.style.visibility = "hidden";
    clone.style.pointerEvents = "none";
    clone.style.width = "max-content";
    clone.style.minWidth = "0";
    clone.style.tableLayout = "auto";

    clone.querySelectorAll<HTMLElement>("th,td").forEach((cell) => {
      cell.style.width = "auto";
      cell.style.minWidth = "0";
      cell.style.maxWidth = "none";
      cell.style.whiteSpace = "nowrap";
    });

    document.body.appendChild(clone);
    try {
      let neededWidth = MIN_COLUMN_WIDTH;

      Array.from(clone.rows).forEach((row) => {
        let columnIndex = 0;
        Array.from(row.cells).some((cell) => {
          const colSpan = Math.max(1, cell.colSpan || 1);
          const containsTarget = index >= columnIndex && index < columnIndex + colSpan;
          columnIndex += colSpan;
          if (!containsTarget) return false;

          neededWidth = Math.max(neededWidth, Math.ceil(cell.getBoundingClientRect().width / colSpan));
          return true;
        });
      });

      return neededWidth;
    } finally {
      clone.remove();
    }
  }, []);

  const fitColumnToContent = (index: number) => (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const table = tableRef.current;
    if (!table) return;

    const neededWidth = measureNeededColumnWidth(index);
    if (!neededWidth) return;

    const headers = table.querySelectorAll<HTMLTableCellElement>("thead tr:first-child > *");
    const currentWidths = widths ?? Array.from(headers).map((h) => h.getBoundingClientRect().width);
    const next = [...currentWidths];
    next[index] = Math.max(MIN_COLUMN_WIDTH, neededWidth);

    resizingRef.current = null;
    setIsResizing(false);
    setWidths(next);
  };

  const totalWidth = widths ? widths.reduce((a, b) => a + b, 0) : undefined;
  const tableStyle = widths ? { ...style, tableLayout: "fixed" as const, width: totalWidth } : style;

  return (
    <div className={scrollClassName}>
      <div className="relative inline-block min-w-full align-top">
        <table
          ref={setTableElement}
          {...props}
          className={cn("border-collapse", !widths && "w-full", isResizing && "select-none", className)}
          style={tableStyle}
        >
          {widths && (
            <colgroup>
              {widths.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
          )}
          {children}
        </table>
        {columnRights.map((right, i) => (
          <div
            key={i}
            aria-hidden="true"
            className="group/handle absolute top-0 bottom-0 w-2 -ml-1 cursor-col-resize z-10 touch-none"
            style={{ left: right }}
            onPointerDown={startResize(i)}
            onDoubleClick={fitColumnToContent(i)}
          >
            <div
              className={cn(
                "absolute inset-y-0 left-1/2 -translate-x-1/2 w-px transition-colors",
                isResizing && resizingRef.current?.index === i
                  ? "bg-neutral-950 dark:bg-neutral-100"
                  : "bg-transparent group-hover/handle:bg-neutral-800 dark:group-hover/handle:bg-neutral-300",
              )}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function MarkdownTable({ children, ...props }: React.TableHTMLAttributes<HTMLTableElement> & { children?: ReactNode }) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const inlineTableRef = useRef<HTMLTableElement | null>(null);

  const setInlineTableElement = useCallback((table: HTMLTableElement | null) => {
    inlineTableRef.current = table;
  }, []);

  const downloadCsv = useCallback(() => {
    const csv = tableElementToCsv(inlineTableRef.current);
    if (!csv) return;
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, TABLE_CSV_FILENAME);
  }, []);

  const printTable = useCallback(() => {
    printTableElement(inlineTableRef.current);
  }, []);

  const copyTable = useCallback(async () => {
    const tsv = tableElementToTsv(inlineTableRef.current);
    if (!tsv) return;

    try {
      await copyToClipboard({ text: tsv });
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("failed to copy table", error);
    }
  }, []);

  return (
    <>
      <RendererFrame
        label=""
        actions={
          <>
            <button
              type="button"
              onClick={copyTable}
              className={actionButtonClassName}
              title="Copy table for Excel"
              aria-label="Copy table for Excel"
            >
              {copied ? <CopyCheck size={ACTION_ICON_SIZE} /> : <Copy size={ACTION_ICON_SIZE} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
            <button
              type="button"
              onClick={() => setIsFullscreen(true)}
              className={actionButtonClassName}
              title="Open in full screen"
              aria-label="Open table in full screen"
            >
              <Maximize2 size={ACTION_ICON_SIZE} />
              <span>Full screen</span>
            </button>
          </>
        }
      >
        <ResizableTable {...props} onTableElement={setInlineTableElement}>
          {children}
        </ResizableTable>
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
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={copyTable}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                    title="Copy table for Excel"
                    aria-label="Copy table for Excel"
                  >
                    {copied ? <CopyCheck size={14} /> : <Copy size={14} />}
                    <span>{copied ? "Copied" : "Copy"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={downloadCsv}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                    title="Download table as CSV"
                    aria-label="Download table as CSV"
                  >
                    <Download size={14} />
                    <span>CSV</span>
                  </button>
                  <button
                    type="button"
                    onClick={printTable}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                    title="Print table"
                    aria-label="Print table"
                  >
                    <Printer size={14} />
                    <span>Print</span>
                  </button>
                </div>
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
              <div className="flex-1 overflow-auto">
                <ResizableTable {...props} scrollClassName="overflow-visible">
                  {children}
                </ResizableTable>
              </div>
            </Dialog.Panel>
          </Transition.Child>
        </Dialog>
      </Transition>
    </>
  );
}

function createComponents(
  scopeId: string,
  isStreaming: boolean,
  resolveAsset: (url: string) => string | undefined,
  blockCounterRef: { current: number },
  compact = false,
): Partial<Components> {
  return {
    pre: ({ children }) => {
      return <>{children}</>;
    },
    p: ({ children, ...props }) => {
      return (
        <p className={cn("first:mt-0 last:mb-0", compact ? "my-2 leading-normal" : "my-3.5 leading-7")} {...props}>
          {children}
        </p>
      );
    },
    input: ({ type, checked, className, ...props }) => {
      if (type === "checkbox") {
        return (
          <input
            type="checkbox"
            checked={checked}
            readOnly
            disabled
            className={cn(className, "task-checkbox", checked && "checked")}
            {...props}
          />
        );
      }
      return <input type={type} checked={checked} className={className} {...props} />;
    },
    li: ({ children, className, ...props }) => {
      const isTask = typeof className === "string" && className.includes("task-list-item");
      return (
        <li
          className={cn("ml-0", compact ? "py-0.5 leading-normal" : "py-0.5 leading-7", isTask && "task-list-item")}
          {...props}
        >
          {children}
        </li>
      );
    },
    ul: ({ children, className, ...props }) => {
      const isTaskList = typeof className === "string" && className.includes("contains-task-list");
      return (
        <ul className={cn(isTaskList ? "task-list ml-0 pl-0" : "custom-list ml-5 pl-0")} {...props}>
          {children}
        </ul>
      );
    },
    ol: ({ children, ...props }) => {
      return (
        <ol className="list-decimal list-outside pl-6 ml-0" {...props}>
          {children}
        </ol>
      );
    },
    strong: ({ children, ...props }) => {
      return (
        <span className="font-semibold" {...props}>
          {children}
        </span>
      );
    },
    a: ({ children, href, ...props }) => {
      let url = href || "";
      const internalHash = getInternalHash(url);

      if (url && !url.startsWith("http") && !url.startsWith("#")) {
        url = `https://${url}`;
      }

      if (isAudioUrl(url)) {
        return (
          <MediaPlayer url={url} type="audio">
            {children}
          </MediaPlayer>
        );
      }

      if (isVideoUrl(url)) {
        return (
          <MediaPlayer url={url} type="video">
            {children}
          </MediaPlayer>
        );
      }

      if (internalHash) {
        return (
          <a
            className={markdownLinkClassName}
            href={`#${internalHash}`}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(internalHash)?.scrollIntoView({ behavior: "smooth" });
            }}
            {...props}
          >
            {children}
          </a>
        );
      }

      return (
        <a className={markdownLinkClassName} href={url} target="_blank" rel="noreferrer noopener" {...props}>
          {children}
        </a>
      );
    },
    h1: ({ children, ...props }) => {
      return (
        <h1
          id={slugify(children)}
          className={
            compact ? "text-base font-semibold mt-4 mb-1 first:mt-0" : "text-3xl font-semibold mt-8 mb-3 first:mt-0"
          }
          {...props}
        >
          {children}
        </h1>
      );
    },
    h2: ({ children, ...props }) => {
      return (
        <h2
          id={slugify(children)}
          className={
            compact ? "text-sm font-semibold mt-4 mb-1 first:mt-0" : "text-2xl font-semibold mt-8 mb-3 first:mt-0"
          }
          {...props}
        >
          {children}
        </h2>
      );
    },
    h3: ({ children, ...props }) => {
      return (
        <h3
          id={slugify(children)}
          className={
            compact ? "text-sm font-semibold mt-3 mb-1 first:mt-0" : "text-xl font-semibold mt-6 mb-2 first:mt-0"
          }
          {...props}
        >
          {children}
        </h3>
      );
    },
    h4: ({ children, ...props }) => {
      return (
        <h4
          id={slugify(children)}
          className={
            compact ? "text-sm font-semibold mt-2 mb-1 first:mt-0" : "text-lg font-semibold mt-6 mb-2 first:mt-0"
          }
          {...props}
        >
          {children}
        </h4>
      );
    },
    h5: ({ children, ...props }) => {
      return (
        <h5
          id={slugify(children)}
          className={
            compact ? "text-sm font-semibold mt-2 mb-1 first:mt-0" : "text-base font-semibold mt-5 mb-1 first:mt-0"
          }
          {...props}
        >
          {children}
        </h5>
      );
    },
    h6: ({ children, ...props }) => {
      return (
        <h6
          id={slugify(children)}
          className={
            compact ? "text-xs font-semibold mt-2 mb-1 first:mt-0" : "text-sm font-semibold mt-5 mb-1 first:mt-0"
          }
          {...props}
        >
          {children}
        </h6>
      );
    },
    table: ({ children, ...props }) => {
      return <MarkdownTable {...props}>{children}</MarkdownTable>;
    },
    thead: ({ children, ...props }) => {
      return (
        <thead className="bg-neutral-100 dark:bg-neutral-900" {...props}>
          {children}
        </thead>
      );
    },
    tbody: ({ children, ...props }) => {
      return <tbody {...props}>{children}</tbody>;
    },
    tr: ({ children, ...props }) => {
      return <tr {...props}>{children}</tr>;
    },
    th: ({ children, ...props }) => {
      return (
        <th
          className="px-3 py-2 text-left text-sm font-semibold border-r last:border-r-0 border-neutral-200 dark:border-neutral-600"
          {...props}
        >
          {children}
        </th>
      );
    },
    td: ({ children, ...props }) => {
      return (
        <td
          className="px-3 py-2 text-sm border-r last:border-r-0 border-neutral-200 dark:border-neutral-600"
          {...props}
        >
          {children}
        </td>
      );
    },
    blockquote: ({ children, ...props }) => {
      return (
        <blockquote
          className="border-l-[3px] border-neutral-300 dark:border-neutral-700 pl-4 my-4 leading-7 text-neutral-600 dark:text-neutral-400 [&>:first-child]:mt-0 [&>:last-child]:mb-0"
          {...props}
        >
          {children}
        </blockquote>
      );
    },
    hr: ({ ...props }) => {
      return <hr className="my-4 border-neutral-300 dark:border-neutral-700" {...props} />;
    },
    img: ({ src, alt, ...props }) => {
      const rawSrc = typeof src === "string" ? src : "";
      const resolved = rawSrc ? resolveAsset(rawSrc) : undefined;
      return (
        <img
          src={resolved ?? rawSrc}
          alt={alt || "Image"}
          className="max-h-60 my-2 rounded-md"
          loading="lazy"
          {...props}
        />
      );
    },
    code({ children, className, ...rest }) {
      const match = /language-(\w+)/.exec(className || "");
      const text = extractText(children).replace(/\n$/, "");
      const isMultiLine = text.includes("\n");

      if (!match && !isMultiLine) {
        return (
          <code
            {...rest}
            className={`${className || ""} bg-neutral-200 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono`}
          >
            {children}
          </code>
        );
      }

      const blockId = `${scopeId}:code:${blockCounterRef.current++}`;

      if (!match) {
        return <CodeRenderer key={blockId} code={text} language="text" blockId={blockId} isStreaming={isStreaming} />;
      }

      const language = match[1].toLowerCase();

      if (language === "latex" || language === "tex" || language === "math" || language === "katex") {
        const filename = extractFilename(text);
        return <LatexRenderer code={text} filename={filename} />;
      }

      if (language === "svg") {
        return <SvgRenderer svg={text} language={language} />;
      }

      if (language === "html" || language === "htm") {
        return <HtmlRenderer html={text} language={language} />;
      }

      if (language === "csv" || language === "tsv") {
        return <CsvRenderer csv={text} language={language} />;
      }

      if (language === "undefined" || language === "text" || language === "plain") {
        return <CodeRenderer key={blockId} code={text} language="text" blockId={blockId} isStreaming={isStreaming} />;
      }

      if (language === "markdown" || language === "md") {
        return <MarkdownRenderer content={text} language={language} />;
      }

      const filename = extractFilename(text);
      return (
        <CodeRenderer
          key={blockId}
          code={text}
          language={language}
          name={filename}
          blockId={blockId}
          isStreaming={isStreaming}
        />
      );
    },
  };
}

const katexPluginOptions: Parameters<typeof rehypeKatex>[0] = {
  strict: "ignore",
  errorColor: "transparent",
};

const baseRehypeReactOptions: Parameters<typeof rehypeReact>[0] = {
  Fragment,
  jsx,
  jsxs,
  ignoreInvalidStyle: true,
  passKeys: true,
  passNode: true,
};

const STREAM_RENDER_THROTTLE_MS = 120;

const findMatchingLinkDestinationEnd = (content: string, start: number): number => {
  let depth = 1;

  for (let index = start; index < content.length; index += 1) {
    const char = content[index];

    if (char === "\\") {
      index += 1;
      continue;
    }

    if (char === "(") {
      depth += 1;
      continue;
    }

    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
};

const stabilizeStreamingLinks = (content: string): string => {
  const bracketStack: number[] = [];
  let inInlineCode = false;
  let inFence = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const nextThree = content.slice(index, index + 3);
    const lineStart = index === 0 || content[index - 1] === "\n";

    if (!inInlineCode && lineStart && nextThree === "```") {
      inFence = !inFence;
      index += 2;
      continue;
    }

    if (inFence) {
      continue;
    }

    if (char === "`" && content[index - 1] !== "\\") {
      inInlineCode = !inInlineCode;
      continue;
    }

    if (inInlineCode) {
      continue;
    }

    if (char === "[") {
      bracketStack.push(index);
      continue;
    }

    if (char === "]" && content[index + 1] === "(" && bracketStack.length > 0) {
      const labelStart = bracketStack.pop();
      if (labelStart === undefined) {
        continue;
      }
      const label = content.slice(labelStart + 1, index);
      const destinationEnd = findMatchingLinkDestinationEnd(content, index + 2);

      if (destinationEnd === -1) {
        const imageStart = labelStart > 0 && content[labelStart - 1] === "!" ? labelStart - 1 : labelStart;
        return `${content.slice(0, imageStart)}${label}`;
      }
    }
  }

  return content;
};

const preprocessMarkdown = (content: string, isStreaming = false): string => {
  let processedContent = content;

  if (isStreaming) {
    processedContent = stabilizeStreamingLinks(processedContent);
  }

  // Convert LaTeX-style display math \[...\] to $$...$$
  processedContent = processedContent.replace(/\\\[([\s\S]+?)\\\]/g, (_match, mathContent) => {
    return `$$${mathContent}$$`;
  });

  // Convert LaTeX-style inline math \(...\) to $$...$$ (since single $ is disabled)
  processedContent = processedContent.replace(/\\\(([\s\S]+?)\\\)/g, (_match, mathContent) => {
    return `$$${mathContent}$$`;
  });

  // Ensure blank line before code blocks that come after headings
  processedContent = processedContent.replace(/^(#{1,6}\s+.+)\n```/gm, "$1\n\n```");

  // Ensure blank line after code blocks before headings
  processedContent = processedContent.replace(/```\n(#{1,6}\s+)/gm, "```\n\n$1");

  return processedContent;
};

function createMarkdownProcessor(
  scopeId: string,
  isStreaming: boolean,
  resolveAsset: (url: string) => string | undefined,
  blockCounterRef: { current: number },
  compact = false,
) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkBreaks)
    .use(remarkGemoji)
    .use(remarkMath, { singleDollarTextMath: false })
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeKatex, katexPluginOptions)
    .use(rehypeNotoEmoji)
    .use(rehypeReact, {
      ...baseRehypeReactOptions,
      components: createComponents(scopeId, isStreaming, resolveAsset, blockCounterRef, compact),
    });
}

type MarkdownProps = {
  children: string;
  isStreaming?: boolean;
  /**
   * When true, renders headings at reduced sizes suitable for compact UI contexts.
   */
  compact?: boolean;
  /**
   * Optional filesystem for resolving relative `<img>` references. When
   * provided, relative image URLs are looked up in `fs` and served as blob
   * URLs so artifact-local images render without needing a real web server.
   */
  fs?: FileSystem;
  /**
   * Absolute path of the document being rendered. Used as the base for
   * resolving relative asset URLs. Only meaningful when `fs` is provided.
   */
  basePath?: string;
};

let markdownInstanceCounter = 0;

const NonMemoizedMarkdown = ({ children, isStreaming = false, compact = false, fs, basePath }: MarkdownProps) => {
  const [throttled, setThrottled] = useState(children);
  const lastFlushRef = useRef(0);
  const timerRef = useRef<number>(undefined);
  const scopeIdRef = useRef<string | null>(null);
  const blockCounterRef = useRef(0);

  if (!scopeIdRef.current) {
    scopeIdRef.current = `markdown-${markdownInstanceCounter++}`;
  }

  const resolveAsset = useAssetUrlResolver(fs, basePath);

  const processor = useMemo(
    () =>
      createMarkdownProcessor(scopeIdRef.current ?? "markdown", isStreaming, resolveAsset, blockCounterRef, compact),
    [isStreaming, resolveAsset, compact],
  );

  useEffect(() => {
    if (!isStreaming) {
      window.clearTimeout(timerRef.current);
      return;
    }

    const delay = Math.max(0, STREAM_RENDER_THROTTLE_MS - (Date.now() - lastFlushRef.current));

    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      lastFlushRef.current = Date.now();
      setThrottled(children);
    }, delay);

    return () => window.clearTimeout(timerRef.current);
  }, [children, isStreaming]);

  // Throttle limits parse frequency during streaming; useDeferredValue
  // lets React interrupt long renders to keep the UI responsive.
  const input = useDeferredValue(isStreaming ? throttled : children);
  if (!input) return null;

  // Reset block counter before each processSync so code block keys are
  // stable across re-renders (code:0, code:1, …), preventing CodeRenderer
  // from unmounting/remounting on every streaming update.
  blockCounterRef.current = 0;
  return processor.processSync(preprocessMarkdown(input, isStreaming)).result;
};

export const Markdown = memo(
  NonMemoizedMarkdown,
  (prev, next) =>
    prev.children === next.children &&
    prev.isStreaming === next.isStreaming &&
    prev.compact === next.compact &&
    prev.fs === next.fs &&
    prev.basePath === next.basePath,
);

const extractFilename = (code: string): string | undefined => {
  const lines = code.split("\n");
  if (lines.length === 0) return undefined;

  const firstLine = lines[0].trim();

  // Pattern to match various comment styles with filepath
  const patterns = [
    /^\/\/\s*filepath:\s*(.+)$/i, // // filepath: main.go
    /^\/\/\s*file:\s*(.+)$/i, // // file: main.go
    /^#\s*filepath:\s*(.+)$/i, // # filepath: main.py
    /^#\s*file:\s*(.+)$/i, // # file: main.py
    /^<!--\s*filepath:\s*(.+?)\s*-->$/i, // <!-- filepath: index.html -->
    /^<!--\s*file:\s*(.+?)\s*-->$/i, // <!-- file: index.html -->
    /^\/\*\s*filepath:\s*(.+?)\s*\*\/$/i, // /* filepath: styles.css */
    /^\/\*\s*file:\s*(.+?)\s*\*\/$/i, // /* file: styles.css */
  ];

  for (const pattern of patterns) {
    const match = firstLine.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return undefined;
};
