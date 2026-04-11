import emojiRegex from "emoji-regex";
import type { ElementContent, Element as HastElement, Root, Text } from "hast";
import { visit } from "unist-util-visit";

const SKIP_TAGS = new Set(["code", "pre", "script", "style", "textarea"]);

/**
 * Rehype plugin that wraps emoji characters in a span with the "noto-emoji"
 * class so they render using Google's monochrome Noto Emoji font instead of
 * the OS default color emoji.
 */
const rehypeNotoEmoji = () => {
  const detectEmojiRegex = emojiRegex();
  const splitEmojiRegex = emojiRegex();

  return (tree: Root) => {
    visit(tree, "text", (node: Text, index, parent) => {
      if (index === undefined || !parent) return;

      const parentTagName = "tagName" in parent && typeof parent.tagName === "string" ? parent.tagName : undefined;
      if (parentTagName && SKIP_TAGS.has(parentTagName)) return;

      const value = node.value;

      detectEmojiRegex.lastIndex = 0;
      if (!detectEmojiRegex.test(value)) return;

      const parts: ElementContent[] = [];
      let lastIndex = 0;
      splitEmojiRegex.lastIndex = 0;
      let match: RegExpExecArray | null = splitEmojiRegex.exec(value);
      while (match !== null) {
        if (match.index > lastIndex) {
          parts.push({
            type: "text",
            value: value.slice(lastIndex, match.index),
          });
        }

        const emojiSpan: HastElement = {
          type: "element",
          tagName: "span",
          properties: { className: ["noto-emoji"] },
          children: [{ type: "text", value: match[0] }],
        };
        parts.push(emojiSpan);

        lastIndex = match.index + match[0].length;
        match = splitEmojiRegex.exec(value);
      }

      if (lastIndex < value.length) {
        parts.push({
          type: "text",
          value: value.slice(lastIndex),
        });
      }

      if (parts.length > 0) {
        parent.children.splice(index, 1, ...parts);
      }
    });
  };
};

export default rehypeNotoEmoji;
