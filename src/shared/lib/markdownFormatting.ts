/**
 * Inline formatting as source edits: each toggle wraps or unwraps a selection
 * with markdown delimiters and returns one replacement, so a textarea can
 * apply it with `insertText` and keep its native undo history.
 */

import type { SourceEdit } from "./sourceEditing";

export type InlineFormat = "bold" | "italic" | "strike" | "code" | "link";

/** Delimiters written by each toggle; later entries are also recognised when unwrapping. */
const DELIMITERS: Record<Exclude<InlineFormat, "link">, string[]> = {
  bold: ["**", "__"],
  italic: ["_", "*"],
  strike: ["~~"],
  code: ["`"],
};

/** A lone `*` next to another `*` belongs to bold, not italics. */
function isWrappedBy(text: string, start: number, end: number, delimiter: string): boolean {
  if (text.slice(start - delimiter.length, start) !== delimiter) return false;
  if (text.slice(end, end + delimiter.length) !== delimiter) return false;
  if (delimiter !== "*") return true;
  const outerBefore = text[start - 2] === "*" && text[start - 3] !== "*";
  const outerAfter = text[end + 1] === "*" && text[end + 2] !== "*";
  return !outerBefore && !outerAfter;
}

export function toggleInlineFormat(text: string, start: number, end: number, format: InlineFormat): SourceEdit {
  // Delimiters must hug the text: `**word** ` rather than `**word **`.
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  const selected = text.slice(start, end);

  if (format === "link") {
    if (/^(?:https?:\/\/|mailto:)\S+$/.test(selected)) {
      const insert = `[${selected}](${selected})`;
      return { from: start, to: end, insert, selection: { start: start + 1, end: start + 1 + selected.length } };
    }
    const label = selected || "link";
    const urlStart = start + label.length + 3;
    return { from: start, to: end, insert: `[${label}](url)`, selection: { start: urlStart, end: urlStart + 3 } };
  }

  for (const delimiter of DELIMITERS[format]) {
    const size = delimiter.length;
    if (isWrappedBy(text, start, end, delimiter)) {
      return {
        from: start - size,
        to: end + size,
        insert: selected,
        selection: { start: start - size, end: end - size },
      };
    }
    if (selected.length > size * 2 && selected.startsWith(delimiter) && selected.endsWith(delimiter)) {
      const inner = selected.slice(size, -size);
      return { from: start, to: end, insert: inner, selection: { start, end: start + inner.length } };
    }
  }

  const delimiter = DELIMITERS[format][0];
  const size = delimiter.length;
  return {
    from: start,
    to: end,
    insert: `${delimiter}${selected}${delimiter}`,
    selection: { start: start + size, end: end + size },
  };
}

// ── Lists ─────────────────────────────────────────────────────────────────

/** Quote prefix, indentation, marker, spacing and an optional task box. */
const LIST_LINE = /^((?:>[\t ]?)*)([\t ]*)(?:([-+*])|(\d{1,9})([.)]))([\t ]+)(\[[ xX]\][\t ]+)?/;
const QUOTE_LINE = /^(?:>[\t ]?)+/;
const TASK_BOX = /^([\t ]*(?:>[\t ]?)*[\t ]*(?:[-+*]|\d{1,9}[.)])[\t ]+)\[([ xX])\]/gm;

function lineBounds(text: string, offset: number): { start: number; end: number } {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  const newline = text.indexOf("\n", offset);
  return { start, end: newline === -1 ? text.length : newline };
}

/** Width of the content column of the closest earlier item at `indent`, used as one nesting step. */
function nestingWidth(text: string, before: number, indent: number): number {
  const lines = text.slice(0, before).split("\n").reverse();
  for (const line of lines) {
    const item = LIST_LINE.exec(line);
    if (!item || item[1]) continue;
    if (item[2].length === indent) return item[0].length - indent - (item[7]?.length ?? 0);
    if (item[2].length < indent) break;
  }
  return 2;
}

/** Indentation of the closest earlier item that is less indented than `indent`. */
function parentIndent(text: string, before: number, indent: number): number {
  const lines = text.slice(0, before).split("\n").reverse();
  for (const line of lines) {
    const item = LIST_LINE.exec(line);
    if (item && !item[1] && item[2].length < indent) return item[2].length;
  }
  return 0;
}

/**
 * Indents (`1`) or outdents (`-1`) the list items touched by the selection,
 * by one nesting step. Returns null when the first line is not a list item,
 * so Tab keeps its usual meaning elsewhere. Quoted lists are left alone.
 */
export function shiftListItems(text: string, start: number, end: number, direction: 1 | -1): SourceEdit | null {
  const first = lineBounds(text, start);
  const last = lineBounds(text, Math.max(start, end - (end > start && text[end - 1] === "\n" ? 1 : 0)));
  const item = LIST_LINE.exec(text.slice(first.start, first.end));
  if (!item || item[1]) return null;
  const indent = item[2].length;
  const step =
    direction === 1 ? nestingWidth(text, first.start, indent) : indent - parentIndent(text, first.start, indent);
  if (step <= 0) return null;

  const lines = text.slice(first.start, last.end).split("\n");
  let firstDelta = 0;
  let totalDelta = 0;
  const shifted = lines.map((line, index) => {
    let delta: number;
    let next: string;
    if (direction === 1) {
      next = line ? " ".repeat(step) + line : line;
      delta = next.length - line.length;
    } else {
      const removable = Math.min(step, line.length - line.trimStart().length);
      next = line.slice(removable);
      delta = -removable;
    }
    if (index === 0) firstDelta = delta;
    totalDelta += delta;
    return next;
  });
  return {
    from: first.start,
    to: last.end,
    insert: shifted.join("\n"),
    selection: {
      start: Math.max(first.start, start + firstDelta),
      end: Math.max(first.start, end + totalDelta),
    },
  };
}

/**
 * Enter inside a list item or quote: continues it on a new line (the next
 * number, a fresh task box), or ends it when the item is empty. A nested
 * empty item is outdented first. Returns null for an ordinary newline.
 */
export function continueListOnEnter(text: string, start: number, end: number): SourceEdit | null {
  if (start !== end) return null;
  const line = lineBounds(text, start);
  const content = text.slice(line.start, line.end);
  const item = LIST_LINE.exec(content);
  if (item) {
    if (start - line.start < item[0].length) return null;
    const [prefix, quote, indent, bullet, number, delimiter, spacing, task] = item;
    if (!content.slice(prefix.length).trim()) {
      if (indent && !quote) return shiftListItems(text, start, end, -1);
      return {
        from: line.start,
        to: line.end,
        insert: quote,
        selection: { start: line.start + quote.length, end: line.start + quote.length },
      };
    }
    const marker = bullet ?? `${Number(number) + 1}${delimiter}`;
    const insert = `\n${quote}${indent}${marker}${spacing}${task ? "[ ] " : ""}`;
    return { from: start, to: end, insert, selection: { start: start + insert.length, end: start + insert.length } };
  }
  const quote = QUOTE_LINE.exec(content);
  if (!quote || start - line.start < quote[0].length) return null;
  if (!content.slice(quote[0].length).trim()) {
    return { from: line.start, to: line.end, insert: "", selection: { start: line.start, end: line.start } };
  }
  const insert = `\n${quote[0]}`;
  return { from: start, to: end, insert, selection: { start: start + insert.length, end: start + insert.length } };
}

/** Flips the `index`-th task box (`[ ]` ⇄ `[x]`) in `source`; null when there is no such task. */
export function toggleTask(source: string, index: number): string | null {
  let seen = 0;
  for (const match of source.matchAll(TASK_BOX)) {
    if (seen++ !== index) continue;
    const at = match.index + match[1].length + 1;
    return source.slice(0, at) + (match[2] === " " ? "x" : " ") + source.slice(at + 1);
  }
  return null;
}
