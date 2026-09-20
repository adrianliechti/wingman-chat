import emojiRegex from "emoji-regex";
import type { ElementContent, Root } from "hast";
import { SKIP, visit } from "unist-util-visit";
import type { EmojiMode } from "./noto-emoji";

const SKIP_TAGS = new Set(["code", "pre", "script", "style", "textarea", "svg", "math"]);

/**
 * Rehype plugin that wraps emoji characters in a span with the "noto-emoji"
 * class so they render using Google's monochrome Noto Emoji font instead of
 * the OS default color emoji.
 */
const rehypeNotoEmoji = ({ mode = "monochrome" }: { mode?: EmojiMode } = {}) => {
  const pattern = emojiRegex();

  return (tree: Root) => {
    visit(tree, (node, index, parent) => {
      if (node.type === "element") {
        const classes = node.properties.className;
        if (SKIP_TAGS.has(node.tagName) || (Array.isArray(classes) && classes.includes("noto-emoji"))) {
          return SKIP;
        }
      }
      if (node.type !== "text" || index === undefined || !parent) return;

      const value = node.value;

      pattern.lastIndex = 0;
      let match = pattern.exec(value);
      if (!match) return;

      const parts: ElementContent[] = [];
      let lastIndex = 0;
      while (match !== null) {
        if (match.index > lastIndex) {
          parts.push({
            type: "text",
            value: value.slice(lastIndex, match.index),
          });
        }

        parts.push({
          type: "element",
          tagName: "span",
          properties: { className: ["noto-emoji"] },
          // VS16 explicitly requests emoji presentation and can make browsers
          // choose a color fallback even when Noto contains the glyph. Remove
          // only that selector for display; keep joiners, modifiers, and the
          // original Markdown intact. Native mode retains the exact sequence.
          children: [{ type: "text", value: mode === "native" ? match[0] : match[0].replaceAll("\uFE0F", "") }],
        });

        lastIndex = match.index + match[0].length;
        match = pattern.exec(value);
      }

      if (lastIndex < value.length) {
        parts.push({
          type: "text",
          value: value.slice(lastIndex),
        });
      }

      parent.children.splice(index, 1, ...parts);
      // Do not walk the spans we just inserted and wrap their text again.
      return index + parts.length;
    });
  };
};

export default rehypeNotoEmoji;
