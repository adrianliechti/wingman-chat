/**
 * TanStack Markdown extensions that give the chat renderer the behaviour the
 * previous remark/rehype pipeline had: bare URL autolinks, chat-style line
 * breaks, `$$` and `\( \)` math, `:shortcode:` emoji, and emoji glyphs
 * wrapped for the Noto font. Everything here is synchronous and produces
 * plain AST nodes; the React renderer maps the custom nodes to components.
 */

import type { BlockNode, InlineComponentNode, InlineNode, MarkdownExtension, UrlTransform } from "@tanstack/markdown";
import { parseMarkdown } from "@tanstack/markdown/parser";
import emojiRegex from "emoji-regex";
import { decodeHTMLStrict } from "entities/decode";
import { nameToEmoji } from "gemoji";
import { safeHtmlExtension } from "./markdownHtml";
import type { EmojiMode } from "./noto-emoji";

/** Common paragraph/block forms omitted by TanStack's documentation profile. */
export const blockSyntaxExtension: MarkdownExtension = {
  name: "block-syntax",
  parseBlock({ lines, index, consume, parseInline }) {
    if (/^(?: {4}|\t)/.test(lines[index])) {
      const code: string[] = [];
      let end = index;
      while (end < lines.length && (/^(?: {4}|\t)/.test(lines[end]) || !lines[end].trim())) {
        code.push(lines[end++].replace(/^(?: {4}|\t)/, ""));
      }
      while (code.at(-1) === "") code.pop();
      consume(end - index);
      return { type: "code", value: code.join("\n") };
    }
    // Extensions run before built-in block parsing; do not claim fences,
    // lists, quotes, ATX headings or thematic breaks as setext headings.
    const blockMarker = /^ {0,3}(?:[#>`~]|\${2,}|[-+*](?:\s|$)|\d+[.)]\s|([-*_])(?:\s*\1){2,}\s*$)/;
    const underlineLine = /^ {0,3}(=+|-+)[\t ]*$/;
    if (blockMarker.test(lines[index])) return;
    // A setext heading may span several text lines before its underline.
    let count = 0;
    while (
      index + count < lines.length &&
      lines[index + count].trim() !== "" &&
      !underlineLine.test(lines[index + count]) &&
      (count === 0 || !blockMarker.test(lines[index + count]))
    ) {
      count++;
    }
    if (count === 0) return;
    const underline = underlineLine.exec(lines[index + count] ?? "");
    if (!underline) return;
    const text = lines.slice(index, index + count).join("\n");
    // Ask TanStack to distinguish prose from tables/HTML and mixed blocks.
    // No extensions or caller options: this probe must not recurse or mutate
    // footnote counters. Only the real parse below runs inline extensions.
    const blocks = parseMarkdown(text, MARKDOWN_PARSE_OPTIONS).children;
    if (blocks.length !== 1 || blocks[0].type !== "paragraph") return;
    consume(count + 1);
    return {
      type: "heading",
      depth: underline[1][0] === "=" ? 1 : 2,
      children: parseInline(
        lines
          .slice(index, index + count)
          .map((line) => line.trim())
          .join("\n"),
      ),
    };
  },
};

export const entityExtension: MarkdownExtension = {
  name: "entities",
  inlineParser: {
    markers: "&",
    parse({ source, index }) {
      const match = /^&(?:#[xX][\da-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z\d]{1,31});/.exec(
        source.slice(index, index + 34),
      );
      if (!match) return;
      const value = decodeHTMLStrict(match[0]);
      if (value !== match[0]) return { node: { type: "text", value }, length: match[0].length };
      return undefined;
    },
  },
  // Titles retain their raw escapes. Image alt text has already been flattened
  // by TanStack, so decoding it here would corrupt escaped entities/code spans.
  transformInline(nodes) {
    const decodeAttributes = (list: InlineNode[]): InlineNode[] =>
      list.map((node) => {
        if (node.type === "image" || node.type === "link") {
          return {
            ...node,
            ...(node.title !== undefined
              ? {
                  title: node.title.replace(
                    /\\[!-/:-@[-`{-~]|&(?:#[xX][\da-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z\d]{1,31});/g,
                    (token) => (token[0] === "\\" ? token.slice(1) : decodeHTMLStrict(token)),
                  ),
                }
              : {}),
            ...(node.type === "link" ? { children: decodeAttributes(node.children) } : {}),
          };
        }
        if ("children" in node && Array.isArray(node.children) && node.type !== "inlineComponent") {
          return { ...node, children: decodeAttributes(node.children as InlineNode[]) } as InlineNode;
        }
        return node;
      });
    return decodeAttributes(nodes);
  },
};

// ── Math ───────────────────────────────────────────────────────────────────

export const MATH_TAG = "md-math";

function mathNode(source: string, display: boolean): InlineComponentNode {
  return {
    type: "inlineComponent",
    name: "math",
    tagName: MATH_TAG,
    attributes: {},
    properties: { source, display: display ? "true" : "false" },
    children: [],
  };
}

/** Display math is its own block, so the renderer never nests a block element in a paragraph. */
function mathBlock(source: string): BlockNode {
  return {
    type: "component",
    name: "math",
    tagName: MATH_TAG,
    attributes: {},
    properties: { source, display: "true" },
    children: [],
  };
}

/**
 * `$$ … $$` as display math on its own lines or inline in prose. The
 * `\( … \)` and `\[ … \]` aliases are rewritten to `$$` by
 * {@link normalizeMathAliases} before parsing, because the parser's own
 * backslash escapes run ahead of extension parsers. KaTeX renders the source
 * in the component; an unfinished expression stays literal text.
 */
export const mathExtension: MarkdownExtension = {
  name: "math",
  parseBlock({ lines, index, consume }) {
    const opening = /^ {0,3}(\${2,})([^$]*)$/.exec(lines[index]);
    if (!opening) return;
    for (let end = index + 1; end < lines.length; end++) {
      const closing = /^ {0,3}(\${2,})[\t ]*$/.exec(lines[end]);
      if (!closing || closing[1].length < opening[1].length) continue;
      const body = [opening[2], ...lines.slice(index + 1, end)].join("\n").trim();
      consume(end - index + 1);
      return mathBlock(body);
    }
    return undefined;
  },
  inlineParser: {
    markers: "$",
    parse({ source, index }) {
      if (!source.startsWith("$$", index)) return undefined;
      const end = source.indexOf("$$", index + 2);
      if (end === -1) return undefined;
      const body = source.slice(index + 2, end);
      if (!body.trim() || body.includes("\n\n")) return undefined;
      return { node: mathNode(body.trim(), false), length: end + 2 - index };
    },
  },
};

export { hideUnfinishedLink, normalizeMathAliases, prepareMarkdownSource } from "./markdownSource";

// ── Emoji shortcodes ───────────────────────────────────────────────────────

const SHORTCODE = /^:([a-z0-9_+-]+):/i;

/** `:smile:` becomes the emoji character; unknown names stay literal. */
export const emojiShortcodeExtension: MarkdownExtension = {
  name: "emoji-shortcodes",
  inlineParser: {
    markers: ":",
    parse({ source, index }) {
      const match = SHORTCODE.exec(source.slice(index, index + 64));
      if (!match) return undefined;
      const emoji = (nameToEmoji as Record<string, string>)[match[1].toLowerCase()];
      if (typeof emoji !== "string") return undefined;
      return { node: { type: "text", value: emoji }, length: match[0].length };
    },
  },
};

// ── Noto emoji glyphs ──────────────────────────────────────────────────────

function mapInlineText(nodes: InlineNode[], map: (text: string) => InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      out.push(...map(node.value));
    } else if ("children" in node && !(node.type === "inlineComponent" && node.name === "emoji")) {
      out.push({ ...node, children: mapInlineText(node.children, map) });
    } else {
      out.push(node);
    }
  }
  return out;
}

/**
 * Wrap every emoji sequence in a span with the `noto-emoji` class so it
 * renders with Google's monochrome Noto Emoji font. The VS16 presentation
 * selector is dropped for display, because it can force a colour fallback;
 * native mode keeps the exact sequence.
 */
export function notoEmojiExtension(mode: EmojiMode): MarkdownExtension {
  return {
    name: "noto-emoji",
    // The React renderer reads `className` from the node; HTML output needs a real attribute.
    renderHtml(node) {
      if (node.type !== "inlineComponent" || node.name !== "emoji") return undefined;
      const glyph = node.children.map((child) => (child.type === "text" ? child.value : "")).join("");
      return `<span class="noto-emoji">${glyph.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>`;
    },
    transformInline(nodes) {
      const pattern = emojiRegex();
      return mapInlineText(nodes, (value) => {
        pattern.lastIndex = 0;
        if (!pattern.test(value)) return [{ type: "text", value }];
        pattern.lastIndex = 0;
        const parts: InlineNode[] = [];
        let last = 0;
        for (const match of value.matchAll(pattern)) {
          if (match.index > last) parts.push({ type: "text", value: value.slice(last, match.index) });
          parts.push({
            type: "inlineComponent",
            name: "emoji",
            tagName: "span",
            attributes: {},
            properties: { className: "noto-emoji" },
            children: [{ type: "text", value: mode === "native" ? match[0] : match[0].replaceAll("️", "") }],
          });
          last = match.index + match[0].length;
        }
        if (last < value.length) parts.push({ type: "text", value: value.slice(last) });
        return parts;
      });
    },
  };
}

// ── Line breaks ────────────────────────────────────────────────────────────

/** A single newline inside a paragraph is a line break, as chat readers expect. */
export const breaksExtension: MarkdownExtension = {
  name: "breaks",
  transformInline(nodes) {
    return mapInlineText(nodes, (value) => {
      if (!value.includes("\n")) return [{ type: "text", value }];
      const parts: InlineNode[] = [];
      value.split("\n").forEach((line, index) => {
        if (index > 0) parts.push({ type: "break" });
        if (line) parts.push({ type: "text", value: line });
      });
      return parts;
    });
  },
};

// ── Autolinks ──────────────────────────────────────────────────────────────

const EMAIL = /^[\w.!#$%&'*+/=?^`{|}~-]+@[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+/i;
const EMAIL_CHARACTER = /[\w.!#$%&'*+/=?^`{|}~@-]/;

/** Explicit autolinks, bare web addresses and email, with punctuation left outside. */
export const autolinkExtension: MarkdownExtension = {
  name: "autolink",
  inlineParser: {
    markers: "<abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_",
    parse({ source, index, inLink, options }) {
      if (inLink) return undefined;
      const link = (label: string, destination: string, length: number) => {
        const safe = markdownUrlTransform(destination, "link", "") ?? "";
        const href = options.urlTransform ? options.urlTransform(destination, "link", safe) : safe;
        return {
          node: href
            ? { type: "link" as const, href, children: [{ type: "text" as const, value: label }] }
            : { type: "text" as const, value: label },
          length,
        };
      };
      if (source[index] === "<") {
        const match = /^<([^\s<>]+)>/.exec(source.slice(index));
        if (!match) return;
        if (/^[a-z][a-z\d+.-]{1,31}:/i.test(match[1])) return link(match[1], match[1], match[0].length);
        if (EMAIL.exec(match[1])?.[0] === match[1]) return link(match[1], `mailto:${match[1]}`, match[0].length);
        return;
      }
      const before = source[index - 1];
      if (before && EMAIL_CHARACTER.test(before)) return;
      const tail = source.slice(index);
      const address = /^(?:https?:\/\/|www\.)[^\s<>]+/i.exec(tail);
      if (address) {
        let label = address[0];
        let excessParens = (label.match(/\)/g)?.length ?? 0) - (label.match(/\(/g)?.length ?? 0);
        while (/[.,;:!?'"\]]$/.test(label) || (label.endsWith(")") && excessParens-- > 0)) {
          label = label.slice(0, -1);
        }
        return link(label, /^www\./i.test(label) ? `http://${label}` : label, label.length);
      }
      const email = EMAIL.exec(tail)?.[0];
      if (email) return link(email, `mailto:${email}`, email.length);
      return undefined;
    },
  },
};

// ── Links to the workspace ─────────────────────────────────────────────────

/** Artifact links keep their scheme so the link component can open the file in the panel. */
export const markdownUrlTransform: UrlTransform = (url) => {
  // Match the parser's control/whitespace filtering after decoding entities.
  // eslint-disable-next-line no-control-regex
  const value = decodeHTMLStrict(url).replace(/[\u0000-\u001F\u007F\s]+/g, "");
  return /^(?!https?:|mailto:|tel:|sandbox:|artifact:)[a-z][a-z\d+.-]*:/i.test(value) ? "" : value;
};

// ── Extension sets ─────────────────────────────────────────────────────────

export const markdownSyntaxExtensions = [
  blockSyntaxExtension,
  entityExtension,
  emojiShortcodeExtension,
  autolinkExtension,
  safeHtmlExtension,
];

/** Chat adds math, soft breaks and the chosen emoji font to shared syntax. */
export function markdownExtensions(emojiMode: EmojiMode): MarkdownExtension[] {
  return [...markdownSyntaxExtensions, mathExtension, breaksExtension, notoEmojiExtension(emojiMode)];
}

/** Parse options every renderer shares: HTML is parsed so the safe-HTML extension can rewrite it. */
export const MARKDOWN_PARSE_OPTIONS = { allowHtml: true, headingIds: false, frontmatter: false } as const;
