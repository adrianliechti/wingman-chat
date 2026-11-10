/**
 * Top-level block boundaries in markdown source, for the block editor: it
 * renders inactive blocks one by one with the regular markdown renderer and
 * edits the source of one block at a time, so the source stays canonical and
 * untouched blocks keep their exact bytes. Only the split points matter here,
 * so constructs that span blank lines (fences, `$$` math, HTML comments, loose
 * lists) stay in one block instead of being parsed.
 */

export interface MarkdownBlock {
  /** Offset of the block's first character. */
  start: number;
  /** Offset just past the block's last character, before its line break. */
  end: number;
}

interface Line {
  text: string;
  start: number;
  end: number;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const MATH_OPEN = /^ {0,3}(\${2,})[^$]*$/;
const MATH_CLOSE = /^ {0,3}(\${2,})[\t ]*$/;
const HTML_COMMENT = /^ {0,3}<!--/;
const HTML_RAW = /^ {0,3}<(pre|script|style|textarea)(?:[\s>]|$)/i;
const LIST_ITEM = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[\t ]|$)/;
const CONTINUATION = /^(?: {2,}|\t)/;
const FRONTMATTER_CLOSE = /^(?:---|\.\.\.)[\t ]*$/;
const REFERENCE_DEFINITION = /^ {0,3}\[(?!\^)[^\]]+\]:[\t ]*\S/;

function splitLines(source: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (;;) {
    const newline = source.indexOf("\n", start);
    const end = newline === -1 ? source.length : newline;
    lines.push({ text: source.slice(start, end), start, end });
    if (newline === -1) return lines;
    start = newline + 1;
  }
}

const isBlank = (line: Line) => !line.text.trim();

/** Index of the line that closes the construct opened at `index`, or the last line. */
function findClosing(lines: Line[], index: number, closes: (text: string) => boolean): number {
  for (let next = index + 1; next < lines.length; next++) {
    if (closes(lines[next].text)) return next;
  }
  return lines.length - 1;
}

/** Last line of a construct that may contain blank lines, or -1 when `index` opens none. */
function constructEnd(lines: Line[], index: number): number {
  const text = lines[index].text;
  const fence = FENCE_OPEN.exec(text);
  if (fence) {
    const marker = fence[1];
    // A backtick fence's info string cannot contain backticks.
    if (marker[0] === "`" && text.slice(text.indexOf(marker) + marker.length).includes("`")) return -1;
    const closing = new RegExp(`^\\s*${marker[0] === "`" ? "`" : "~"}{${marker.length},}[\\t ]*$`);
    return findClosing(lines, index, (line) => closing.test(line));
  }
  const math = MATH_OPEN.exec(text);
  if (math) {
    // An unclosed `$$` is literal text, as in the renderer.
    for (let next = index + 1; next < lines.length; next++) {
      const closing = MATH_CLOSE.exec(lines[next].text);
      if (closing && closing[1].length >= math[1].length) return next;
    }
    return -1;
  }
  if (HTML_COMMENT.test(text) && !text.includes("-->")) {
    return findClosing(lines, index, (line) => line.includes("-->"));
  }
  const raw = HTML_RAW.exec(text);
  if (raw && !new RegExp(`</${raw[1]}>`, "i").test(text)) {
    const closing = new RegExp(`</${raw[1]}>`, "i");
    return findClosing(lines, index, (line) => closing.test(line));
  }
  return -1;
}

/** Splits `source` into top-level blocks separated by blank lines. */
export function splitMarkdownBlocks(source: string): MarkdownBlock[] {
  const lines = splitLines(source);
  const chunks: Array<{ first: number; last: number; list: boolean }> = [];
  let index = 0;

  if (lines[0]?.text.trimEnd() === "---") {
    const close = lines.findIndex((line, at) => at > 0 && FRONTMATTER_CLOSE.test(line.text));
    if (close > 0) {
      chunks.push({ first: 0, last: close, list: false });
      index = close + 1;
    }
  }

  while (index < lines.length) {
    if (isBlank(lines[index])) {
      index++;
      continue;
    }
    const first = index;
    let list = false;
    while (index < lines.length && !isBlank(lines[index])) {
      if (LIST_ITEM.test(lines[index].text)) list = true;
      const end = constructEnd(lines, index);
      index = (end === -1 ? index : end) + 1;
    }
    const chunk = { first, last: index - 1, list };
    // Items of a loose list and their indented continuations stay one block.
    const previous = chunks.at(-1);
    const opening = lines[first].text;
    if (previous?.list && (LIST_ITEM.test(opening) || CONTINUATION.test(opening))) {
      previous.last = chunk.last;
    } else {
      chunks.push(chunk);
    }
  }

  return chunks.map(({ first, last }) => ({ start: lines[first].start, end: lines[last].end }));
}

/**
 * Reference-style link definitions (`[id]: url`), which a block rendered on
 * its own needs to resolve `[text][id]` links defined elsewhere.
 */
export function referenceDefinitions(source: string): string {
  return splitMarkdownBlocks(source)
    .map((block) => source.slice(block.start, block.end))
    .filter((block) => block.split("\n").every((line) => REFERENCE_DEFINITION.test(line)))
    .join("\n");
}

/** Link destinations and HTML tags, whose characters never appear in rendered text. */
const HIDDEN_SOURCE = /\]\([^)\n]*\)|<[^>\n]*>/g;

/**
 * Maps a caret in rendered text to an offset in the block's source: the
 * rendered prefix's visible characters are matched, in order, against the
 * source, skipping markup the renderer drops. Used to place the caret where
 * the user clicked when a block switches to source.
 */
export function sourceOffsetFromRendered(source: string, renderedPrefix: string): number {
  const visible = source.replace(HIDDEN_SOURCE, (match) =>
    match.startsWith("]") ? `]${"\0".repeat(match.length - 1)}` : "\0".repeat(match.length),
  );
  let offset = 0;
  for (const char of renderedPrefix) {
    if (/\s/.test(char)) continue;
    const found = visible.indexOf(char, offset);
    if (found === -1) break;
    offset = found + char.length;
  }
  return offset;
}

/**
 * Removes a block whose source was cleared, with the blank lines around it,
 * keeping one blank line between its neighbours and the file's final newline.
 * Returns null when the range still has text or nothing else is left.
 */
export function removeBlankBlock(
  source: string,
  start: number,
  end: number,
): { source: string; shift: (offset: number) => number } | null {
  if (source.slice(start, end).trim()) return null;
  const head = source.slice(0, start).trimEnd();
  const rest = source.slice(end);
  const tailStart = end + (rest.length - rest.trimStart().length);
  const tail = source.slice(tailStart);
  if (!head && !tail) return null;
  const joint = head && tail ? "\n\n" : "";
  const ending = !tail && source.endsWith("\n") ? "\n" : "";
  const delta = head.length + joint.length - tailStart;
  return {
    source: head + joint + tail + ending,
    shift: (offset) => (offset >= tailStart ? offset + delta : Math.min(offset, head.length)),
  };
}

/** 1-based line of a source offset. */
export function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let index = source.indexOf("\n"); index !== -1 && index < offset; index = source.indexOf("\n", index + 1)) {
    line++;
  }
  return line;
}
