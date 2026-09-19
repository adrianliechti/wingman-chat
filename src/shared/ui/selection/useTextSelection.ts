import { useCallback, useEffect, useState } from "react";

export interface TextSelectionSnapshot {
  text: string;
  /** First line box of the selection, in the top-level viewport's coordinates. */
  rect: { top: number; left: number; width: number; height: number };
  /** 1-based lines when the root renders one `span.line` per source line (code views). */
  lines?: { start: number; end: number };
}

export type SelectionRoot = HTMLElement | null;

interface SelectionContext {
  doc: Document;
  win: Window;
  container: Element | null;
  iframe: HTMLIFrameElement | null;
}

function resolveContext(root: SelectionRoot): SelectionContext | null {
  if (!root) return null;
  if (root instanceof HTMLIFrameElement) {
    try {
      const doc = root.contentDocument;
      const win = root.contentWindow;
      if (!doc || !win) return null;
      return { doc, win, container: doc.body, iframe: root };
    } catch {
      // A cross-origin navigation inside the frame makes its document opaque.
      return null;
    }
  }
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  return win ? { doc, win, container: root, iframe: null } : null;
}

function isFormControl(element: Element | null): boolean {
  if (!element) return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (element as HTMLElement).isContentEditable;
}

/** Map a range onto shiki's `span.line` elements when the root renders code. */
function lineRange(container: Element | null, range: Range): TextSelectionSnapshot["lines"] {
  const lines = container?.querySelectorAll("code > span.line");
  if (!lines?.length) return undefined;
  const indexOf = (node: Node) => {
    const element = node instanceof Element ? node : node.parentElement;
    const line = element?.closest("span.line");
    return line ? Array.prototype.indexOf.call(lines, line) : -1;
  };
  const start = indexOf(range.startContainer);
  if (start < 0) return undefined;
  let end = indexOf(range.endContainer);
  if (end < 0) end = start;
  // A selection that stops at the very start of the next line does not include it.
  if (end > start && range.endOffset === 0) end -= 1;
  return { start: start + 1, end: Math.max(start, end) + 1 };
}

function snapshot(context: SelectionContext): TextSelectionSnapshot | null {
  const selection = context.win.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const text = selection.toString();
  if (!text.trim()) return null;
  const range = selection.getRangeAt(0);
  if (context.container && !context.container.contains(range.commonAncestorContainer)) return null;
  if (isFormControl(context.doc.activeElement)) return null;

  const rects = range.getClientRects();
  const rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  let { top, left } = rect;
  if (context.iframe) {
    if (rect.bottom < 0 || rect.top > context.iframe.clientHeight) return null;
    const frame = context.iframe.getBoundingClientRect();
    top += frame.top;
    left += frame.left;
  }
  return { text, rect: { top, left, width: rect.width, height: rect.height }, lines: lineRange(context.container, range) };
}

/**
 * Reports the text the user has highlighted inside `root`: an element, or a
 * same-origin iframe whose document is re-observed after every navigation.
 * Empty and whitespace-only selections, selections outside the root, and
 * typing inside form controls report null. `document` is the document being
 * observed (an iframe's own document), so a host can treat presses in it as
 * outside presses that never bubble to the top-level page.
 */
export function useTextSelection(
  root: SelectionRoot,
  options: { enabled?: boolean; debounceMs?: number } = {},
): { selection: TextSelectionSnapshot | null; clear: () => void; document: Document | null } {
  const { enabled = true, debounceMs = 150 } = options;
  const [selection, setSelection] = useState<TextSelectionSnapshot | null>(null);
  const [observed, setObserved] = useState<Document | null>(null);

  const clear = useCallback(() => {
    setSelection(null);
    try {
      resolveContext(root)?.win.getSelection()?.removeAllRanges();
    } catch {
      // Nothing to clear when the frame's document is unreachable.
    }
  }, [root]);

  useEffect(() => {
    if (!root || !enabled) {
      setSelection(null);
      setObserved(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    let detach: (() => void) | null = null;

    const attach = () => {
      detach?.();
      detach = null;
      const context = resolveContext(root);
      if (!context) {
        setObserved(null);
        return;
      }
      setObserved(context.doc);
      const update = () => {
        timer = null;
        setSelection(snapshot(context));
      };
      const schedule = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(update, debounceMs);
      };
      const flush = () => {
        if (timer) clearTimeout(timer);
        update();
      };
      const reset = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        setSelection(null);
      };
      const { doc, win } = context;
      doc.addEventListener("selectionchange", schedule);
      doc.addEventListener("mouseup", flush);
      doc.addEventListener("keyup", flush);
      doc.addEventListener("touchend", flush);
      // Scrolling or resizing moves the selection box; hide until it settles.
      doc.addEventListener("scroll", reset, true);
      win.addEventListener("resize", reset);
      detach = () => {
        doc.removeEventListener("selectionchange", schedule);
        doc.removeEventListener("mouseup", flush);
        doc.removeEventListener("keyup", flush);
        doc.removeEventListener("touchend", flush);
        doc.removeEventListener("scroll", reset, true);
        win.removeEventListener("resize", reset);
        if (timer) clearTimeout(timer);
        timer = null;
      };
    };

    attach();
    // A preview iframe navigates on every reload; listeners must follow the new document.
    const onLoad = () => {
      setSelection(null);
      attach();
    };
    const frame = root instanceof HTMLIFrameElement ? root : null;
    frame?.addEventListener("load", onLoad);
    return () => {
      frame?.removeEventListener("load", onLoad);
      detach?.();
      setSelection(null);
      setObserved(null);
    };
  }, [root, enabled, debounceMs]);

  return { selection, clear, document: observed };
}
