import type { Root } from "mdast";
import { SKIP, visit } from "unist-util-visit";

// Let the Markdown parser identify literal regions, including nested/indented
// fences and multi-backtick code spans. Replacements must not rewrite these.
const LITERAL_NODES = new Set(["code", "inlineCode", "html", "link", "image", "definition", "math", "inlineMath"]);

function linkDestinationEnd(content: string, start: number): number {
  let depth = 1;
  for (let index = start; index < content.length; index++) {
    const char = content[index];
    if (char === "\\") index++;
    else if (char === "(") depth++;
    else if (char === ")" && --depth === 0) return index;
    // A link cannot span a blank line. Do not hide subsequent paragraphs.
    else if (char === "\n" && /^[\t \r]*\n/.test(content.slice(index + 1))) return index;
  }
  return -1;
}

/** Normalize supported math aliases and hide unfinished streaming destinations. */
export function prepareMarkdown(content: string, tree: Root, isStreaming: boolean) {
  if (!isStreaming && !content.includes("$$") && !content.includes("\\(") && !content.includes("\\[")) {
    return { content, hasMath: false };
  }

  const literals: { start: number; end: number }[] = [];
  let hasMath = false;
  visit(tree, (node) => {
    if (!LITERAL_NODES.has(node.type)) return;
    if (node.type === "math" || node.type === "inlineMath") hasMath = true;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) literals.push({ start, end });
    return SKIP;
  });

  const edits: { start: number; end: number; value: string }[] = [];
  const brackets: { start: number; markerStart: number }[] = [];
  let literalIndex = 0;
  for (let index = 0; index < content.length; index++) {
    while (literals[literalIndex]?.end <= index) literalIndex++;
    const literal = literals[literalIndex];
    if (literal && index >= literal.start) {
      index = Math.max(index, literal.end - 1);
      literalIndex++;
      continue;
    }

    const char = content[index];
    if (char === "\\") {
      const opener = content[index + 1];
      if (opener === "(" || opener === "[") {
        const end = content.indexOf(opener === "(" ? "\\)" : "\\]", index + 2);
        if (end > index + 2 && end + 2 <= (literal?.start ?? content.length)) {
          edits.push({ start: index, end: end + 2, value: `$$${content.slice(index + 2, end)}$$` });
          hasMath = true;
          index = end + 1;
          continue;
        }
      }
      index++; // Escaped brackets and backslashes are literal.
      continue;
    }
    if (char === "$" && content[index + 1] === "$") {
      hasMath = true;
      const end = content.indexOf("$$", index + 2);
      if (end !== -1 && end + 2 <= (literal?.start ?? content.length)) index = end + 1;
      continue;
    }
    if (!isStreaming) continue;
    if (char === "\n" && /^[\t \r]*\n/.test(content.slice(index + 1))) brackets.length = 0;
    else if (char === "[" || (char === "!" && content[index + 1] === "[")) {
      const markerStart = index;
      if (char === "!") index++;
      brackets.push({ start: index, markerStart });
    } else if (char === "]") {
      const bracket = brackets.pop();
      if (!bracket || content[index + 1] !== "(") continue;
      const end = linkDestinationEnd(content, index + 2);
      if (end !== -1) {
        index = end;
        continue;
      }
      // Keep the label (including formatting), remove its opening marker and
      // the incomplete destination. Edits still refer to the original source.
      edits.push(
        { start: bracket.markerStart, end: bracket.start + 1, value: "" },
        { start: index, end: content.length, value: "" },
      );
      break;
    }
  }

  if (edits.length === 0) return { content, hasMath };
  const parts: string[] = [];
  let offset = 0;
  for (const edit of edits.sort((a, b) => a.start - b.start)) {
    parts.push(content.slice(offset, edit.start), edit.value);
    offset = edit.end;
  }
  parts.push(content.slice(offset));
  return { content: parts.join(""), hasMath };
}
