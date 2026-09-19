import { Dialog, Transition } from "@headlessui/react";
import type { Components } from "hast-util-to-jsx-runtime";
import type { Root as MarkdownRoot } from "mdast";
import { Copy, CopyCheck, Download, Maximize2, Printer, X } from "lucide-react";
import {
  memo,
  createContext,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import rehypeReact from "rehype-react";
import remarkBreaks from "remark-breaks";
import remarkGemoji from "remark-gemoji";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { type PluggableList, unified } from "unified";
import { cn } from "@/shared/lib/cn";
import type { ReactNode } from "react";
import { copyToClipboard } from "@/shared/lib/copy";
import { isAudioUrl, isVideoUrl } from "@/shared/lib/mediaTypes";
import rehypeNotoEmoji from "@/shared/lib/rehype-noto-emoji";
import { getArtifactLinkPath } from "@/shared/lib/sandbox";
import { useAssetUrlResolver } from "@/shared/lib/useAssetUrlResolver";
import { downloadBlob } from "@/shared/lib/utils";
import type { FileSystem } from "@/shared/types/file";
import { ACTION_ICON_SIZE, actionButtonClassName } from "./actionButton";
import { CodeRenderer } from "./CodeRenderer";
import { loadKatex, loadMathPlugins, type MathPlugins } from "./markdownMath";
import { prepareMarkdown } from "./markdownInput";
import { EmojiContext, type EmojiMode } from "@/shell/context/EmojiContext";
import { MediaPlayer } from "./MediaPlayer";
import { HtmlRenderer } from "./renderers/HtmlRenderer";
import { LazyCsvRenderer } from "./renderers/LazyCsvRenderer";
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
    if (!containerRef.current) {
      return;
    }

    let cancelled = false;
    // KaTeX is loaded on demand (split out of the initial bundle); render once
    // it resolves, guarding against cleanup while the chunk is in flight.
    loadKatex()
      .then((katex) => {
        const container = containerRef.current;
        if (cancelled || !container) return;
        katex.render(code, container, {
          displayMode: true,
          throwOnError: false,
          strict: "ignore",
          errorColor: "transparent",
          trust: true,
          fleqn: false,
        });
        setFailed(false);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("KaTeX rendering failed:", error);
        setFailed(true);
      });

    return () => {
      cancelled = true;
    };
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
    void downloadBlob(blob, TABLE_CSV_FILENAME);
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

const MarkdownRenderContext = createContext<{
  isStreaming: boolean;
  compact: boolean;
  resolveAsset: (url: string) => string | undefined;
  onOpenArtifact?: (path: string) => void;
}>({ isStreaming: false, compact: false, resolveAsset: () => undefined });

// Stable component types preserve tables, previews, and code blocks when math
// loads or streaming ends. Runtime options travel through context, not closures.
const markdownComponents: Partial<Components> = {
  pre: ({ children }) => {
    return <>{children}</>;
  },
  p: function Paragraph({ children, ...props }) {
    const { compact } = useContext(MarkdownRenderContext);
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
  li: function ListItem({ children, className, ...props }) {
    const { compact } = useContext(MarkdownRenderContext);
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
  a: function Link({ children, href, ...props }) {
    const { onOpenArtifact } = useContext(MarkdownRenderContext);
    let url = href || "";
    const internalHash = getInternalHash(url);

    const artifactPath = getArtifactLinkPath(url);
    if (artifactPath && onOpenArtifact) {
      return (
        <button
          type="button"
          className={cn(markdownLinkClassName, "cursor-pointer border-0 bg-transparent p-0 font-[inherit]")}
          onClick={() => onOpenArtifact(artifactPath)}
        >
          {children}
        </button>
      );
    }

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
  h1: function Heading1({ children, ...props }) {
    const { compact } = useContext(MarkdownRenderContext);
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
  h2: function Heading2({ children, ...props }) {
    const { compact } = useContext(MarkdownRenderContext);
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
  h3: function Heading3({ children, ...props }) {
    const { compact } = useContext(MarkdownRenderContext);
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
  h4: function Heading4({ children, ...props }) {
    const { compact } = useContext(MarkdownRenderContext);
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
  h5: function Heading5({ children, ...props }) {
    const { compact } = useContext(MarkdownRenderContext);
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
  h6: function Heading6({ children, ...props }) {
    const { compact } = useContext(MarkdownRenderContext);
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
      <td className="px-3 py-2 text-sm border-r last:border-r-0 border-neutral-200 dark:border-neutral-600" {...props}>
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
  img: function Image({ src, alt, ...props }) {
    const { resolveAsset } = useContext(MarkdownRenderContext);
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
  code: function Code({ children, className, ...rest }) {
    const { isStreaming } = useContext(MarkdownRenderContext);
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

    if (!match) {
      return <CodeRenderer code={text} language="text" isStreaming={isStreaming} />;
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
      return <LazyCsvRenderer csv={text} language={language} />;
    }

    if (language === "undefined" || language === "text" || language === "plain") {
      return <CodeRenderer code={text} language="text" isStreaming={isStreaming} />;
    }

    if (language === "markdown" || language === "md") {
      return <MarkdownRenderer content={text} language={language} />;
    }

    const filename = extractFilename(text);
    return <CodeRenderer code={text} language={language} name={filename} isStreaming={isStreaming} />;
  },
};

const baseRehypeReactOptions: Parameters<typeof rehypeReact>[0] = {
  Fragment,
  jsx,
  jsxs,
  ignoreInvalidStyle: true,
  passKeys: true,
};

function createMarkdownProcessor(math: MathPlugins | null, emojiMode: EmojiMode) {
  // remark-math + rehype-katex are wired in only once the content is known to
  // contain `$$…$$` math, keeping KaTeX out of first paint.
  const remarkPlugins: PluggableList = [remarkParse, remarkGfm, remarkBreaks, remarkGemoji];
  if (math) remarkPlugins.push([math.remarkMath, { singleDollarTextMath: false }]);

  const rehypePlugins: PluggableList = [];
  if (math) rehypePlugins.push([math.rehypeKatex, { strict: "ignore", errorColor: "transparent" }]);
  rehypePlugins.push([rehypeNotoEmoji, { mode: emojiMode }]);

  return unified()
    .use(remarkPlugins)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypePlugins)
    .use(rehypeReact, { ...baseRehypeReactOptions, components: markdownComponents });
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
  /** Opens a link the model emitted to a generated artifact (e.g. `sandbox:`) in the artifact panel. */
  onOpenArtifact?: (path: string) => void;
};

const NonMemoizedMarkdown = ({
  children,
  isStreaming = false,
  compact = false,
  fs,
  basePath,
  onOpenArtifact,
}: MarkdownProps) => {
  const [mathPlugins, setMathPlugins] = useState<MathPlugins | null>(null);
  const emojiMode = useContext(EmojiContext)?.emojiMode ?? "monochrome";
  const resolveAsset = useAssetUrlResolver(fs, basePath);
  const renderOptions = useMemo(
    () => ({ isStreaming, compact, resolveAsset, onOpenArtifact }),
    [isStreaming, compact, resolveAsset, onOpenArtifact],
  );
  const processor = useMemo(() => createMarkdownProcessor(mathPlugins, emojiMode), [mathPlugins, emojiMode]);

  // useChatRun already throttles incoming tokens. Memoization keeps the urgent
  // render of a deferred update from parsing the unchanged input again.
  const input = useDeferredValue(children);
  const { result, hasMath } = useMemo(() => {
    if (!input) return { result: null, hasMath: false };
    const parsed = processor.parse(input);
    const prepared = prepareMarkdown(input, parsed as MarkdownRoot, isStreaming);
    // Usually the original parse is enough. Reparse only when normalization
    // actually changed the source (math aliases or an unfinished link).
    const tree = prepared.content === input ? parsed : processor.parse(prepared.content);
    return {
      result: processor.stringify(processor.runSync(tree, { value: prepared.content })),
      hasMath: prepared.hasMath,
    };
  }, [input, isStreaming, processor]);

  // Load the KaTeX pipeline the first time content actually contains `$$…$$`
  // math, then re-render with math support. Until then the raw `$$` shows.
  useEffect(() => {
    if (mathPlugins || !hasMath) return;
    let cancelled = false;
    loadMathPlugins()
      .then((plugins) => {
        if (!cancelled) setMathPlugins(plugins);
      })
      .catch((error) => {
        // Leave math unrendered (raw `$$`) on a failed chunk load; the registry
        // evicts the failure so a later render can retry.
        console.warn("Failed to load math plugins:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [hasMath, mathPlugins]);

  return <MarkdownRenderContext value={renderOptions}>{result}</MarkdownRenderContext>;
};

export const Markdown = memo(
  NonMemoizedMarkdown,
  (prev, next) =>
    prev.children === next.children &&
    prev.isStreaming === next.isStreaming &&
    prev.compact === next.compact &&
    prev.fs === next.fs &&
    prev.basePath === next.basePath &&
    prev.onOpenArtifact === next.onOpenArtifact,
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
