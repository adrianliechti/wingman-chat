import { Fragment, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  lineAt,
  referenceDefinitions,
  removeBlankBlock,
  sourceOffsetFromRendered,
  splitMarkdownBlocks,
} from "@/shared/lib/markdownBlocks";
import { toggleTask } from "@/shared/lib/markdownFormatting";
import { cn } from "@/shared/lib/cn";
import type { FileSystem } from "@/shared/types/file";
import { Markdown } from "@/shared/ui/Markdown";
import { SelectionActionPopover } from "@/shared/ui/selection/SelectionActionPopover";
import { useTextSelection, type TextSelectionSnapshot } from "@/shared/ui/selection/useTextSelection";
import { SourceEditor } from "./SourceEditor";
import type { TextDraft } from "./useTextDraft";

/** The block whose source is being edited, as a range of the draft text. */
interface ActiveBlock {
  id: number;
  start: number;
  end: number;
  /** Caret to place on activation, relative to `start`. */
  caret: number;
  /** Draft generation the range belongs to; an outside change retires it. */
  generation: number;
  /** Spacing and type of the rendered block, so its source appears where its text was. */
  style?: React.CSSProperties;
}

interface RenderedBlock {
  key: string;
  start: number;
  end: number;
  text: string;
}

/** Elements inside rendered blocks that keep their own click behaviour. */
const INTERACTIVE = "button, input, select, textarea, summary, label, [role='button'], [contenteditable='true']";

// Rendered blocks sit directly in the prose flow, as in the preview, so
// position-dependent spacing (`first:mt-0`, `last:mb-0`) matches it exactly.
// A hidden marker before each block carries its source range.

const isMarker = (element: Element): boolean => element.hasAttribute("data-block-start");

/** The marker opening the rendered block that contains `node`. */
function blockMarker(flow: HTMLElement, node: Node): HTMLElement | null {
  let child: Node | null = node;
  while (child && child.parentNode !== flow) child = child.parentNode;
  for (let sibling = child instanceof Element ? child : null; sibling; sibling = sibling.previousElementSibling) {
    if (isMarker(sibling)) return sibling as HTMLElement;
    if (sibling.hasAttribute("data-active-block")) return null;
  }
  return null;
}

/** The rendered elements of the block opened by `marker`. */
function blockElements(marker: HTMLElement): HTMLElement[] {
  const elements: HTMLElement[] = [];
  for (let next = marker.nextElementSibling; next instanceof HTMLElement; next = next.nextElementSibling) {
    if (isMarker(next) || next.hasAttribute("data-active-block")) break;
    elements.push(next);
  }
  return elements;
}

/**
 * Margins of the rendered blocks starting at `start` and ending at `end`,
 * with the type of a single-line heading, a paragraph or a code block.
 */
function measureBlock(flow: HTMLElement, start: number, end: number, singleLine: boolean): React.CSSProperties {
  const view = flow.ownerDocument.defaultView;
  const opening = blockElements(flow.querySelector<HTMLElement>(`[data-block-start="${start}"]`) ?? flow).at(0);
  const closingMarker = flow.querySelector<HTMLElement>(`[data-block-end="${end}"]`);
  const closing = closingMarker ? blockElements(closingMarker).at(-1) : undefined;
  if (!view) return {};
  const style: React.CSSProperties = {};
  if (closing) style.marginBottom = view.getComputedStyle(closing).marginBottom;
  if (!opening) return style;
  style.marginTop = view.getComputedStyle(opening).marginTop;
  const heading = /^H[1-6]$/.test(opening.tagName) && singleLine;
  const source = heading || opening.tagName === "P" ? opening : opening.querySelector<HTMLElement>("pre code");
  if (source) {
    const type = view.getComputedStyle(source);
    style.fontFamily = type.fontFamily;
    style.fontSize = type.fontSize;
    style.fontWeight = type.fontWeight;
    style.lineHeight = type.lineHeight;
    style.letterSpacing = type.letterSpacing;
    style.color = type.color;
  }
  return style;
}

/** Rendered text from the start of the block opened by `marker` to the point under the pointer. */
function renderedPrefixAt(marker: HTMLElement, x: number, y: number): string | null {
  const doc = marker.ownerDocument;
  let node: Node | null = null;
  let offset = 0;
  if (typeof doc.caretPositionFromPoint === "function") {
    const position = doc.caretPositionFromPoint(x, y);
    node = position ? position.offsetNode : null;
    offset = position ? position.offset : 0;
  } else if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(x, y);
    node = range ? range.startContainer : null;
    offset = range ? range.startOffset : 0;
  }
  const target = node;
  if (!target || !blockElements(marker).some((element) => element.contains(target))) return null;
  const range = doc.createRange();
  range.setStartAfter(marker);
  range.setEnd(target, offset);
  return range.toString();
}

/** Blocks of `source`, keyed by their text so unchanged blocks keep their rendered output. */
function renderBlocks(source: string, base: number, seen: Map<string, number>): RenderedBlock[] {
  return splitMarkdownBlocks(source).map((block) => {
    const text = source.slice(block.start, block.end);
    const occurrence = seen.get(text) ?? 0;
    seen.set(text, occurrence + 1);
    return { key: `${occurrence}:${text}`, start: base + block.start, end: base + block.end, text };
  });
}

interface MarkdownBlockEditorProps {
  draft: TextDraft;
  fs?: FileSystem;
  path?: string;
  onAsk?: (instruction: string, selection: TextSelectionSnapshot) => void;
}

/**
 * Hybrid markdown editing: the source stays the document, every block is
 * shown rendered, and the block under the caret switches to its source.
 * Edits replace only that block's range, so the rest of the file keeps its
 * exact bytes, and rendering reuses the preview's renderer (diagrams, math,
 * workspace images) for every inactive block.
 */
export function MarkdownBlockEditor({ draft, fs, path, onAsk }: MarkdownBlockEditorProps) {
  const { text, generation, change } = draft;
  const [active, setActive] = useState<ActiveBlock | null>(null);
  const activations = useRef(0);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const region = active && active.generation === generation && change ? active : null;
  const regionStart = region ? region.start : -1;
  const regionEnd = region ? region.end : -1;

  const definitions = useMemo(() => referenceDefinitions(text), [text]);
  const { before, after } = useMemo(() => {
    const seen = new Map<string, number>();
    if (regionStart < 0) return { before: renderBlocks(text, 0, seen), after: [] };
    return {
      before: renderBlocks(text.slice(0, regionStart), 0, seen),
      after: renderBlocks(text.slice(regionEnd), regionEnd, seen),
    };
  }, [text, regionStart, regionEnd]);

  // Highlights in rendered blocks offer the same instruction control as the preview.
  const {
    selection: renderedSelection,
    clear: clearRenderedSelection,
    document: selectionDocument,
  } = useTextSelection(root, { enabled: !!onAsk });

  /** Leaves the current block, dropping it when its source was cleared. */
  const leave = (): ((offset: number) => number) => {
    if (!region || !change) return (offset) => offset;
    const removed = removeBlankBlock(text, region.start, region.end);
    if (!removed) return (offset) => offset;
    change(removed.source);
    return removed.shift;
  };

  const activate = (start: number, end: number, caret: number) => {
    if (!change) return;
    // Measure before leaving: the rendered blocks still carry the current offsets.
    const flow = flowRef.current;
    const measured = flow ? measureBlock(flow, start, end, !text.slice(start, end).includes("\n")) : {};
    // An edge shared with the current block keeps that block's measurements.
    const kept = region?.style ?? {};
    const style: React.CSSProperties = {
      ...(start === region?.start
        ? {
            marginTop: kept.marginTop,
            fontFamily: kept.fontFamily,
            fontSize: kept.fontSize,
            fontWeight: kept.fontWeight,
            lineHeight: kept.lineHeight,
            letterSpacing: kept.letterSpacing,
            color: kept.color,
          }
        : {}),
      ...(end === region?.end ? { marginBottom: kept.marginBottom } : {}),
      ...measured,
    };
    const shift = leave();
    activations.current += 1;
    setActive({
      id: activations.current,
      start: shift(start),
      end: shift(end),
      caret: shift(caret) - shift(start),
      generation,
      style,
    });
  };

  const deactivate = () => {
    leave();
    setActive(null);
  };

  const edit = (value: string) => {
    if (!region || !change) return;
    change(text.slice(0, region.start) + value + text.slice(region.end));
    setActive({ ...region, end: region.start + value.length });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!region) return;
    if (event.key === "Escape") {
      event.preventDefault();
      deactivate();
      return;
    }
    if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
    const { selectionStart, selectionEnd, value } = event.currentTarget;
    if (selectionStart !== selectionEnd) return;
    const previous = before.at(-1);
    const next = after.at(0);
    const atStart = selectionStart === 0;
    const atEnd = selectionEnd === value.length;
    let target: [number, number, number] | null = null;
    // Arrows past either edge continue into the neighbouring block; Backspace
    // and Delete there join the two blocks' source so the gap can be removed.
    if (atStart && previous && (event.key === "ArrowUp" || event.key === "ArrowLeft")) {
      target = [previous.start, previous.end, previous.end];
    } else if (atEnd && next && (event.key === "ArrowDown" || event.key === "ArrowRight")) {
      target = [next.start, next.end, next.start];
    } else if (atStart && previous && event.key === "Backspace") {
      target = [previous.start, region.end, region.start];
    } else if (atEnd && next && event.key === "Delete") {
      target = [region.start, next.end, region.end];
    }
    if (!target) return;
    event.preventDefault();
    activate(...target);
  };

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!change || event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    const flow = flowRef.current;
    if (!target || !flow || target.closest("[data-active-block]")) return;
    const marker = blockMarker(flow, target);
    // A task box flips its `[ ]` in the source; the re-render shows the new state.
    if (target instanceof HTMLInputElement && target.type === "checkbox") {
      if (!marker) return;
      event.preventDefault();
      const start = Number(marker.dataset.blockStart);
      const end = Number(marker.dataset.blockEnd);
      const index = blockElements(marker)
        .flatMap((element) => Array.from(element.querySelectorAll("input[type='checkbox']")))
        .indexOf(target);
      const toggled = toggleTask(text.slice(start, end), index);
      if (toggled !== null) change(text.slice(0, start) + toggled + text.slice(end));
      return;
    }
    if (target.closest(INTERACTIVE)) return;
    const link = target.closest("a");
    // Fragment links navigate the document; modifier clicks follow other links.
    if (link && (link.getAttribute("href")?.startsWith("#") || event.metaKey || event.ctrlKey)) return;
    if (link) {
      event.preventDefault();
      event.stopPropagation();
    }
    const selection = target.ownerDocument.getSelection();
    if (selection && !selection.isCollapsed && root?.contains(selection.anchorNode)) return;

    if (target.closest("[data-block-tail]")) {
      const last = after.at(-1) ?? before.at(-1);
      if (last) activate(last.start, last.end, last.end);
      else activate(0, text.length, text.length);
      return;
    }
    if (!marker) return;
    const start = Number(marker.dataset.blockStart);
    const end = Number(marker.dataset.blockEnd);
    const prefix = renderedPrefixAt(marker, event.clientX, event.clientY);
    const caret = prefix === null ? end : start + sourceOffsetFromRendered(text.slice(start, end), prefix);
    activate(start, end, Math.min(caret, end));
  };

  const renderBlock = (block: RenderedBlock) => (
    <Fragment key={block.key}>
      <span hidden data-block-start={block.start} data-block-end={block.end} />
      <Markdown fs={fs} basePath={path} interactiveTasks={!!change}>
        {definitions ? `${block.text}\n\n${definitions}` : block.text}
      </Markdown>
    </Fragment>
  );

  const empty = !text.trim() && !region;

  return (
    <div className="@container h-full overflow-auto">
      <div
        data-markdown-document
        ref={setRoot}
        onClickCapture={handleClick}
        className="mx-auto max-w-225 px-2 py-6 @[600px]:px-12"
      >
        <div
          ref={flowRef}
          className={cn(
            "prose prose-neutral dark:prose-invert max-w-none [&>[data-block-start]:first-child+*]:mt-0",
            change && "cursor-text",
          )}
        >
          {before.map(renderBlock)}
          {region && (
            <div
              data-active-block
              style={region.style}
              // The highlight is drawn around the text so it never moves it.
              className="not-prose relative isolate text-base leading-7 before:absolute before:-inset-x-2 before:-inset-y-1 before:-z-10 before:rounded-md before:bg-neutral-100/80 before:ring-1 before:ring-black/5 dark:before:bg-neutral-800/60 dark:before:ring-white/10"
            >
              <SourceEditor
                variant="block"
                language="markdown"
                label="Block source"
                value={text.slice(region.start, region.end)}
                onChange={edit}
                focusRequest={{ id: region.id, caret: region.caret }}
                firstLine={lineAt(text, region.start)}
                onKeyDown={handleKeyDown}
                onAsk={onAsk}
              />
            </div>
          )}
          {after.map(renderBlock)}
        </div>
        {/* Clicking below the document continues its last block. */}
        <div data-block-tail className={change ? "min-h-24 cursor-text" : "min-h-6"}>
          {empty && change && <p className="text-sm text-neutral-400 dark:text-neutral-500">Click to start writing…</p>}
        </div>
      </div>
      {onAsk && (
        <SelectionActionPopover
          selection={renderedSelection}
          onSubmit={(instruction, latched) => {
            onAsk(instruction, latched);
            clearRenderedSelection();
          }}
          onDismiss={clearRenderedSelection}
          pressDocument={selectionDocument}
        />
      )}
    </div>
  );
}
