/**
 * Plain-text editing helpers for source editors. Each returns one replacement
 * so a textarea can apply it with `insertText` and keep its undo history.
 */

export interface SourceEdit {
  from: number;
  to: number;
  insert: string;
  /** Selection after the edit, in the edited text. */
  selection: { start: number; end: number };
}

/** Languages whose blocks open with a trailing colon. */
const COLON_BLOCKS = new Set(["py", "python", "yml", "yaml", "nim", "coffee"]);
const OPENERS: Record<string, string> = { "{": "}", "[": "]", "(": ")" };

/** The file's indentation unit: a tab, or its smallest space indent; `fallback` when nothing is indented. */
export function detectIndent(text: string, fallback = "  "): string {
  let tabs = 0;
  let smallest = Infinity;
  for (const match of text.matchAll(/^([\t ]+)\S/gm)) {
    if (match[1].startsWith("\t")) tabs++;
    else if (match[1].length >= 2) smallest = Math.min(smallest, match[1].length);
  }
  if (tabs > 0 && smallest === Infinity) return "\t";
  return smallest === Infinity ? fallback : " ".repeat(Math.min(smallest, 8));
}

const lineStartOf = (text: string, offset: number) => text.lastIndexOf("\n", offset - 1) + 1;

/**
 * Tab and Shift+Tab: a caret without a selection gets one indent unit; a
 * selection indents or outdents every line it touches.
 */
export function indentSelection(
  text: string,
  start: number,
  end: number,
  unit: string,
  direction: 1 | -1,
): SourceEdit | null {
  const first = lineStartOf(text, start);
  if (direction === 1 && start === end) {
    return { from: start, to: end, insert: unit, selection: { start: start + unit.length, end: start + unit.length } };
  }
  const lastOffset = end > start && text[end - 1] === "\n" ? end - 1 : end;
  const newline = text.indexOf("\n", lastOffset);
  const last = newline === -1 ? text.length : newline;
  const lines = text.slice(first, last).split("\n");
  let firstDelta = 0;
  let totalDelta = 0;
  const shifted = lines.map((line, index) => {
    let next = line;
    if (direction === 1) {
      if (line) next = unit + line;
    } else if (line.startsWith("\t")) {
      next = line.slice(1);
    } else {
      next = line.slice(Math.min(unit === "\t" ? 4 : unit.length, line.length - line.trimStart().length));
    }
    const delta = next.length - line.length;
    if (index === 0) firstDelta = delta;
    totalDelta += delta;
    return next;
  });
  if (totalDelta === 0) return null;
  return {
    from: first,
    to: last,
    insert: shifted.join("\n"),
    selection: { start: Math.max(first, start + firstDelta), end: Math.max(first, end + totalDelta) },
  };
}

/**
 * Enter keeps the current line's indentation. In code (`language` given) a
 * line ending in an opening bracket, or a colon in Python-like languages,
 * indents one more step, and a closing bracket right after the caret moves to
 * its own line.
 */
export function newlineWithIndent(text: string, start: number, end: number, language?: string): SourceEdit {
  const lineStart = lineStartOf(text, start);
  const before = text.slice(lineStart, start);
  const indent = /^[\t ]*/.exec(before)?.[0] ?? "";
  const last = before.trimEnd().at(-1) ?? "";
  const opens = !!language && (last in OPENERS || (last === ":" && COLON_BLOCKS.has(language)));
  if (!opens) {
    const insert = `\n${indent}`;
    return { from: start, to: end, insert, selection: { start: start + insert.length, end: start + insert.length } };
  }
  const unit = detectIndent(text, language === "py" || language === "python" ? "    " : "  ");
  const inner = `\n${indent}${unit}`;
  const closes = OPENERS[last] !== undefined && text.slice(end).trimStart().startsWith(OPENERS[last]);
  const insert = closes ? `${inner}\n${indent}` : inner;
  const trailing = closes ? end + (text.slice(end).length - text.slice(end).trimStart().length) : end;
  return { from: start, to: trailing, insert, selection: { start: start + inner.length, end: start + inner.length } };
}
