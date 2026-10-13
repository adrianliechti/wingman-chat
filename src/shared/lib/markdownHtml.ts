/**
 * A safe subset of raw HTML for chat Markdown. Models write `<details>`,
 * `<dl>`, `<sub>` and `<kbd>` because GitHub renders them; the parser hands
 * those over as `html` and `inlineHtml` nodes, and this extension turns an
 * allowlist of tags into component nodes and collapses every other tag to
 * its text. No attribute survives except `open` on `<details>`, and no raw
 * markup is ever handed to the renderer.
 */

import type { BlockNode, InlineNode, MarkdownExtension, ParseOptions } from "@tanstack/markdown";
import { parseMarkdown } from "@tanstack/markdown/parser";

const BLOCK_TAGS = new Set(["details", "summary", "dl", "dt", "dd"]);
const INLINE_TAGS = new Set([
  "sub",
  "sup",
  "kbd",
  "mark",
  "u",
  "b",
  "i",
  "em",
  "strong",
  "small",
  "s",
  "del",
  "ins",
  "abbr",
]);

const TAG = /<\/?([a-zA-Z][a-zA-Z0-9-]*)(?=[\s/>])([^>]*)>/g;

const COMMENT = /<!--[\s\S]*?-->/g;

function stripTags(html: string): string {
  return html.replace(COMMENT, "").replace(TAG, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/**
 * A line of HTML that is not a block container: Markdown text between the
 * tags is parsed, the tags become inline HTML nodes, and the inline pass
 * pairs or drops them like anywhere else.
 */
function inlineFromHtml(line: string, options: ParseOptions): InlineNode[] {
  line = line.replace(COMMENT, "");
  const nodes: InlineNode[] = [];
  let last = 0;
  for (const match of line.matchAll(TAG)) {
    if (match.index > last) nodes.push(...inlineFrom(line.slice(last, match.index), options, false));
    nodes.push({ type: "inlineHtml", value: match[0] });
    last = match.index + match[0].length;
  }
  if (last < line.length) nodes.push(...inlineFrom(line.slice(last), options, false));
  return transformInlineNodes(nodes);
}

function inlineFrom(text: string, options: ParseOptions, trim = true): InlineNode[] {
  const value = trim ? text.trim() : text;
  if (!value.trim()) return value ? [{ type: "text", value }] : [];
  // Text handed here never starts with a tag, so it parses as a paragraph.
  const first = parseMarkdown(value, { ...options, allowHtml: false, headingIds: false, frontmatter: false })
    .children[0];
  if (first && first.type === "paragraph") {
    const children = first.children as InlineNode[];
    // Keep the caller's surrounding whitespace, which the parser trims.
    if (!trim && /^\s/.test(value) && children[0]?.type === "text")
      children[0] = { ...children[0], value: ` ${children[0].value}` };
    if (!trim && /\s$/.test(value) && children.at(-1)?.type === "text") {
      const lastNode = children.at(-1) as { type: "text"; value: string };
      children[children.length - 1] = { ...lastNode, value: `${lastNode.value} ` };
    }
    return children;
  }
  return [{ type: "text", value }];
}

function component(tagName: string, children: BlockNode[], properties: Record<string, string> = {}): BlockNode {
  return { type: "component", name: tagName, tagName, attributes: {}, properties, children };
}

function inlineComponent(tagName: string, children: InlineNode[]): InlineNode {
  return { type: "inlineComponent", name: tagName, tagName, attributes: {}, properties: {}, children };
}

function paragraph(children: InlineNode[]): BlockNode {
  return { type: "paragraph", children };
}

interface Frame {
  node: BlockNode & { type: "component" };
}

/**
 * Rebuild a block list: `<details>` and `<dl>` become containers for the
 * blocks that follow until their closing tag; other HTML blocks keep only
 * their text.
 */
function transformBlocks(blocks: BlockNode[], options: ParseOptions): BlockNode[] {
  const root: BlockNode[] = [];
  const stack: Frame[] = [];
  const target = () => (stack.length ? stack[stack.length - 1].node.children : root);

  const push = (node: BlockNode) => target().push(node);
  const open = (tagName: string, properties: Record<string, string> = {}) => {
    const node = component(tagName, [], properties) as Frame["node"];
    push(node);
    stack.push({ node });
  };
  const close = (tagName: string) => {
    const index = stack.map((frame) => frame.node.tagName).lastIndexOf(tagName);
    if (index !== -1) stack.length = index;
  };

  const handleHtmlLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const match = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>([\s\S]*?)(?:<\/\2>)?\s*$/.exec(trimmed);
    const tag = match?.[2].toLowerCase();
    if (match && tag && BLOCK_TAGS.has(tag)) {
      const closing = match[1] === "/";
      const inner = match[4] ?? "";
      if (closing) {
        close(tag);
        return;
      }
      if (tag === "details") {
        open("details", /\bopen\b/i.test(match[3]) ? { open: "true" } : {});
        if (inner.trim()) handleHtmlLine(inner);
        return;
      }
      if (tag === "dl") {
        open("dl");
        if (inner.trim()) handleHtmlLine(inner);
        return;
      }
      // summary, dt, dd: one line of inline content, closed on the same line or by the next tag.
      const selfClosed = new RegExp(`</${tag}>\\s*$`, "i").test(trimmed);
      push(component(tag, [paragraph(inlineFrom(stripTags(inner), options))]));
      if (!selfClosed && inner.trim() === "") open(tag);
      return;
    }
    if (tag === "hr" && match && match[1] !== "/") {
      push({ type: "thematicBreak" });
      return;
    }
    // Anything else on the line is inline content: pair allowed tags, drop the rest.
    const nodes = inlineFromHtml(trimmed, options);
    if (nodes.length) push(paragraph(nodes));
  };

  for (const block of blocks) {
    if (block.type === "html") {
      for (const line of block.value.split("\n")) handleHtmlLine(line);
      continue;
    }
    push(transformBlock(block, options));
  }
  return root;
}

/** Recurse into every block container so nested HTML is handled too. */
function transformBlock(block: BlockNode, options: ParseOptions): BlockNode {
  switch (block.type) {
    case "blockquote":
    case "component":
    case "callout":
      return { ...block, children: transformBlocks(block.children, options) } as BlockNode;
    case "list":
      return {
        ...block,
        items: block.items.map((item) => ({ ...item, children: transformBlocks(item.children, options) })),
      };
    default:
      return block;
  }
}

/** Pair allowed inline tags into components; drop the rest but keep their text. */
function transformInlineNodes(nodes: InlineNode[]): InlineNode[] {
  const stack: { tag: string; nodes: InlineNode[] }[] = [];
  const out: InlineNode[] = [];
  const target = () => (stack.length ? stack[stack.length - 1].nodes : out);
  for (const node of nodes) {
    if (node.type === "text" && node.value.includes("<!--")) {
      // A comment the parser kept as prose is dropped, as other renderers do.
      const value = node.value.replace(COMMENT, "");
      if (value) target().push({ type: "text", value });
      continue;
    }
    if (node.type !== "inlineHtml") {
      target().push("children" in node && node.type !== "inlineComponent" ? recurseInline(node) : node);
      continue;
    }
    const match = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>$/.exec(node.value.trim());
    const tag = match?.[2].toLowerCase();
    if (!match || !tag) {
      const text = stripTags(node.value);
      if (text) target().push({ type: "text", value: text });
      continue;
    }
    if (tag === "br") {
      target().push({ type: "break" });
      continue;
    }
    if (!INLINE_TAGS.has(tag)) continue; // unknown tag: drop the tag, keep the content
    if (match[1] !== "/") {
      stack.push({ tag, nodes: [] });
      continue;
    }
    const index = stack.map((frame) => frame.tag).lastIndexOf(tag);
    if (index === -1) continue;
    // Close everything above the matching frame by flattening it.
    while (stack.length > index + 1) {
      const dangling = stack.pop()!;
      target().push(...dangling.nodes);
    }
    const frame = stack.pop()!;
    target().push(inlineComponent(tag, frame.nodes));
  }
  while (stack.length) {
    const dangling = stack.pop()!;
    target().push(...dangling.nodes);
  }
  return out;
}

function recurseInline(node: InlineNode): InlineNode {
  if ("children" in node && Array.isArray(node.children) && node.type !== "inlineComponent") {
    return { ...node, children: transformInlineNodes(node.children as InlineNode[]) } as InlineNode;
  }
  return node;
}

export const safeHtmlExtension: MarkdownExtension = {
  name: "safe-html",
  transformDocument(document, { options }) {
    return { ...document, children: transformBlocks(document.children, options) };
  },
  transformInline(nodes) {
    return transformInlineNodes(nodes);
  },
};
