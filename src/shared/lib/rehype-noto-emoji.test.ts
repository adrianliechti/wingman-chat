import type { Element, Root } from "hast";
import remarkGemoji from "remark-gemoji";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { expect, it } from "vitest";
import rehypeNotoEmoji from "./rehype-noto-emoji";

const processor = unified().use(remarkParse).use(remarkGemoji).use(remarkRehype).use(rehypeNotoEmoji);
function spans(tree: Root): Element[] {
  const result: Element[] = [];
  visit(tree, "element", (node) => {
    if (node.properties.className?.includes("noto-emoji")) result.push(node);
  });
  return result;
}

it("wraps each complete emoji sequence exactly once, regardless of its position", () => {
  const emojis = ["😀", "❤️", "☀️", "🗺️", "🏗️", "👩🏽‍💻", "🏳️‍🌈", "🇨🇭", "1️⃣", "❤️‍🔥"];
  for (const prefix of ["", "Hello "]) {
    const tree = processor.runSync(processor.parse(prefix + emojis.join(" ")));
    expect(spans(tree).map((node) => node.children)).toEqual(
      emojis.map((value) => [{ type: "text", value: value.replaceAll("\uFE0F", "") }]),
    );
    const snapshot = structuredClone(tree);
    rehypeNotoEmoji()(tree);
    expect(tree).toEqual(snapshot);
  }
});

it("preserves presentation selectors in native mode", () => {
  const native = unified().use(remarkParse).use(remarkRehype).use(rehypeNotoEmoji, { mode: "native" });
  const tree = native.runSync(native.parse("❤️ ☀️ 🗺️ 🏗️ 🏳️‍🌈"));
  expect(spans(tree).map((node) => node.children)).toEqual(
    ["❤️", "☀️", "🗺️", "🏗️", "🏳️‍🌈"].map((value) => [{ type: "text", value }]),
  );
});

it("converts shortcodes in prose while preserving inline and fenced code", () => {
  const tree = processor.runSync(processor.parse(":smile: `:smile: 😀`\n\n```text\n:smile: 😀\n```"));
  expect(spans(tree)).toHaveLength(1);
  const code: Element[] = [];
  visit(tree, "element", (node) => {
    if (node.tagName === "code") code.push(node);
  });
  expect(code.map((node) => node.children)).toEqual([
    [{ type: "text", value: ":smile: 😀", position: expect.any(Object) }],
    [{ type: "text", value: ":smile: 😀\n" }],
  ]);
});

it("skips entire literal subtrees, including syntax highlighting spans", () => {
  for (const tagName of ["pre", "code", "script", "style", "textarea", "svg", "math"]) {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName,
          properties: {},
          children: [{ type: "element", tagName: "span", properties: {}, children: [{ type: "text", value: "😀" }] }],
        },
      ],
    };
    rehypeNotoEmoji()(tree);
    expect(spans(tree), tagName).toHaveLength(0);
  }
});
