// Source-only edits share one scan of literal regions. TanStack's AST does
// not expose offsets; these guards keep normalization out of code and URLs.
type Range = { start: number; end: number };

function destinationEnd(source: string, start: number): number {
  let depth = 1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "\\") i++;
    else if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) return i;
    else if (source[i] === "\n" && /^[\t \r]*\n/.test(source.slice(i + 1))) return -1;
  }
  return -1;
}

function literalRanges(source: string): Range[] {
  const blocks: Range[] = [];
  let fence: { marker: string; start: number; quotes: number } | undefined;
  let offset = 0;
  for (const line of source.split("\n")) {
    const start = offset;
    offset += line.length + 1;
    const prefix = /^(?: {0,3}>[\t ]?)*/.exec(line)![0];
    const quotes = (prefix.match(/>/g) ?? []).length;
    const body = line.slice(prefix.length).replace(/^ {0,3}(?:[-+*]|\d+[.)])[\t ]+/, "");
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(body);
    if (fence && quotes < fence.quotes && line.trim()) {
      blocks.push({ start: fence.start, end: start });
      fence = undefined;
    }
    if (fence) {
      if (marker && marker[1][0] === fence.marker[0] && marker[1].length >= fence.marker.length && !marker[2].trim()) {
        blocks.push({ start: fence.start, end: Math.min(offset, source.length) });
        fence = undefined;
      }
    } else if (marker) {
      fence = { marker: marker[1], start, quotes };
    } else if (/^(?: {4}|\t)/.test(body) || /^ {0,3}\[[^\]]+\]:/.test(body)) {
      blocks.push({ start, end: Math.min(offset, source.length) });
    }
  }
  if (fence) blocks.push({ start: fence.start, end: source.length });

  const ranges = [...blocks];
  const brackets: number[] = [];
  let blockIndex = 0;
  for (let i = 0; i < source.length; i++) {
    while (blocks[blockIndex]?.end <= i) blockIndex++;
    const block = blocks[blockIndex];
    if (block && i >= block.start) {
      i = block.end - 1;
      brackets.length = 0;
      continue;
    }
    if (source[i] === "\\") {
      i++;
      continue;
    }
    if (source[i] === "\n" && /^[\t \r]*\n/.test(source.slice(i + 1))) brackets.length = 0;
    if (source[i] === "`" || source.startsWith("$$", i)) {
      const char = source[i];
      let length = 1;
      while (source[i + length] === char) length++;
      const run = char.repeat(length);
      let end = source.indexOf(run, i + length);
      while (end !== -1 && (source[end - 1] === char || source[end + length] === char)) {
        end = source.indexOf(run, end + length);
      }
      if (end !== -1 && end < (block?.start ?? source.length) && !/\n[\t \r]*\n/.test(source.slice(i, end))) {
        ranges.push({ start: i, end: end + length });
        i = end + length - 1;
      } else i += length - 1;
      continue;
    }
    if (source[i] === "<") {
      const match = /^(?:<!--[\s\S]*?-->|<(?:"[^"]*"|'[^']*'|[^'">])*>)/.exec(source.slice(i));
      if (match) {
        ranges.push({ start: i, end: i + match[0].length });
        i += match[0].length - 1;
        continue;
      }
    }
    if (source[i] === "[") brackets.push(i);
    else if (source[i] === "]") {
      const start = brackets.pop();
      if (start === undefined || source[i + 1] !== "(") continue;
      const end = destinationEnd(source, i + 2);
      if (end !== -1 && end < (block?.start ?? source.length)) {
        ranges.push({ start, end: end + 1 });
        i = end;
      }
    }
  }
  // A complete link may contain a code span. Merge the overlapping guards.
  const merged: Range[] = [];
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/** Normalize complete math aliases in prose, without touching literal source. */
export function normalizeMathAliases(source: string): string {
  if (!source.includes("\\(") && !source.includes("\\[")) return source;
  const literals = literalRanges(source);
  let literalIndex = 0;
  let result = "";
  let offset = 0;
  for (let i = 0; i < source.length; i++) {
    while (literals[literalIndex]?.end <= i) literalIndex++;
    const literal = literals[literalIndex];
    if (literal && i >= literal.start) {
      i = literal.end - 1;
      continue;
    }
    if (source[i] !== "\\") continue;
    const opener = source[++i];
    if (opener !== "(" && opener !== "[") continue;
    const close = opener === "(" ? ")" : "]";
    for (let end = i + 1; end < (literal?.start ?? source.length); end++) {
      if (source[end] !== "\\") continue;
      if (source[++end] !== close) continue;
      if (end > i + 2) {
        result += source.slice(offset, i - 1) + "$$" + source.slice(i + 1, end - 1) + "$$";
        offset = end + 1;
        i = end;
      }
      break;
    }
  }
  return offset ? result + source.slice(offset) : source;
}

/** Hide only the unfinished destination of a streaming link, keeping its label. */
export function hideUnfinishedLink(source: string): string {
  if (!source.includes("](")) return source;
  const literals = literalRanges(source);
  const brackets: { start: number; markerStart: number }[] = [];
  let literalIndex = 0;
  for (let i = 0; i < source.length; i++) {
    while (literals[literalIndex]?.end <= i) literalIndex++;
    const literal = literals[literalIndex];
    if (literal && i >= literal.start) {
      i = literal.end - 1;
      continue;
    }
    const char = source[i];
    if (char === "\\") {
      i++;
      continue;
    }
    if (char === "\n" && /^[\t \r]*\n/.test(source.slice(i + 1))) brackets.length = 0;
    if (char === "[" || (char === "!" && source[i + 1] === "[")) {
      const markerStart = i;
      if (char === "!") i++;
      brackets.push({ start: i, markerStart });
    } else if (char === "]") {
      const bracket = brackets.pop();
      if (!bracket || source[i + 1] !== "(") continue;
      const end = destinationEnd(source, i + 2);
      if (end !== -1) {
        i = end;
        continue;
      }
      // A blank line ends the construct; subsequent paragraphs must survive.
      if (/\n[\t \r]*\n/.test(source.slice(i + 2))) continue;
      return source.slice(0, bracket.markerStart) + source.slice(bracket.start + 1, i);
    }
  }
  return source;
}

/** Chat preparation, shared with prefix tests. Block structure belongs to the parser. */
export function prepareMarkdownSource(source: string, isStreaming = false): string {
  return normalizeMathAliases(isStreaming ? hideUnfinishedLink(source) : source);
}
