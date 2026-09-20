export interface SourceLineRange {
  /** 1-based, inclusive. */
  start: number;
  end: number;
}

type Match = { index: number } | "missing" | "ambiguous";

function uniqueIndex(haystack: string, needle: string): Match {
  const first = haystack.indexOf(needle);
  if (first === -1) return "missing";
  return haystack.indexOf(needle, first + 1) === -1 ? { index: first } : "ambiguous";
}

/** Collapse whitespace runs to one space, remembering where each kept character came from. */
function collapse(text: string): { text: string; offsets: number[] } {
  let out = "";
  const offsets: number[] = [];
  let inSpace = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (/\s/.test(char)) {
      if (!inSpace) {
        out += " ";
        offsets.push(index);
        inSpace = true;
      }
      continue;
    }
    inSpace = false;
    out += char;
    offsets.push(index);
  }
  return { text: out, offsets };
}

function lineRange(source: string, start: number, end: number): SourceLineRange {
  const startLine = countLines(source, 0, start) + 1;
  const endLine = startLine + countLines(source, start, end);
  return { start: startLine, end: endLine };
}

function countLines(source: string, from: number, to: number): number {
  let count = 0;
  for (let index = from; index < to; index++) if (source[index] === "\n") count++;
  return count;
}

/**
 * Where highlighted text sits in a source string, as 1-based inclusive lines.
 * Tries an exact match first, then a whitespace-insensitive one because
 * rendered text collapses runs of whitespace. Returns null when the text is
 * absent or occurs more than once, so a caller never reports a wrong place.
 */
export function locateInSource(source: string, text: string): SourceLineRange | null {
  const needle = text.replace(/\r\n/g, "\n").trim();
  if (!needle) return null;
  const haystack = source.replace(/\r\n/g, "\n");

  const exact = uniqueIndex(haystack, needle);
  if (typeof exact === "object") return lineRange(haystack, exact.index, exact.index + needle.length);
  if (exact === "ambiguous") return null;

  const collapsedSource = collapse(haystack);
  const collapsedNeedle = collapse(needle).text.trim();
  if (!collapsedNeedle) return null;
  const loose = uniqueIndex(collapsedSource.text, collapsedNeedle);
  if (typeof loose !== "object") return null;
  const start = collapsedSource.offsets[loose.index];
  const last = collapsedSource.offsets[loose.index + collapsedNeedle.length - 1];
  return lineRange(haystack, start, last + 1);
}
