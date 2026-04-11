import emojiRegex from "emoji-regex";
import type { ElementContent, Element as HastElement, Root, Text } from "hast";
import { visit } from "unist-util-visit";

/**
 * Rehype plugin that wraps emoji characters in a span with the "noto-emoji"
 * class so they render using Google's monochrome Noto Emoji font instead of
 * the OS default color emoji.
 */
const rehypeNotoEmoji = () => {
  return (tree: Root) => {
    visit(tree, "text", (node: Text, index, parent) => {
      if (index === undefined || !parent) return;

      const regex = emojiRegex();
      const value = node.value;

      // Quick check: skip nodes with no emoji
      if (!regex.test(value)) return;

      // Reset regex after the test above
      const parts: ElementContent[] = [];
      let lastIndex = 0;
      const regex2 = emojiRegex();
      let match: RegExpExecArray | null = regex2.exec(value);
      while (match !== null) {
        // Text before the emoji
        if (match.index > lastIndex) {
          parts.push({
            type: "text",
            value: value.slice(lastIndex, match.index),
          });
        }

        // Wrap the emoji in <span class="noto-emoji">
        const emojiSpan: HastElement = {
          type: "element",
          tagName: "span",
          properties: { className: ["noto-emoji"] },
          children: [{ type: "text", value: match[0] }],
        };
        parts.push(emojiSpan);

        lastIndex = match.index + match[0].length;
        match = regex2.exec(value);
      }

      // Trailing text after the last emoji
      if (lastIndex < value.length) {
        parts.push({
          type: "text",
          value: value.slice(lastIndex),
        });
      }

      // Replace the original text node with our split nodes
      if (parts.length > 0) {
        parent.children.splice(index, 1, ...parts);
      }
    });
  };
};

export default rehypeNotoEmoji;
