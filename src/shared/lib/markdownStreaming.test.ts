import type { BlockNode } from "@tanstack/markdown";
import { streamingMarkdownExtension } from "@tanstack/markdown/extensions/streaming";
import { renderHtml } from "@tanstack/markdown/html";
import { parseMarkdown } from "@tanstack/markdown/parser";
import { describe, expect, it } from "vitest";
import {
  markdownExtensions,
  markdownUrlTransform,
  MARKDOWN_PARSE_OPTIONS,
  prepareMarkdownSource,
} from "./markdownExtensions";

const options = {
  ...MARKDOWN_PARSE_OPTIONS,
  extensions: markdownExtensions("monochrome"),
  urlTransform: markdownUrlTransform,
};
const streaming = { ...options, extensions: [...options.extensions, streamingMarkdownExtension()] };
const prepare = (source: string) => prepareMarkdownSource(source, true);

function codeValues(blocks: BlockNode[]): string[] {
  return blocks.flatMap((block): string[] => {
    if (block.type === "code") return [block.value];
    if (block.type === "list") return block.items.flatMap((item) => codeValues(item.children));
    if ("children" in block && block.type !== "paragraph" && block.type !== "heading")
      return codeValues(block.children);
    return [];
  });
}

const messages = [
  "first\nsecond\n======\n\n| A | B |\n| - | - |\n| x | y |\n---",
  "first\n  \nsecond\n\n# Heading  \n\n---  \n\nbody  \n\nlast",
  "> Heading\n> ===\noutside\n\n> > first\n> > continued\n\n> literal\n`code`",
  '![\\&amp;](image.png "A &amp; B \\&amp;") ![`&amp;`](image.png)',
  "$$\nx\n---\n$$",
  "Heading\n=======\n\n- [x] **done**\n- [ ] next\n\n| A | B |\n| - | -: |\n| :smile: | &#35; |",
  "See [**label** `code`](https://example.com/a_(b)) and ![image](sandbox:/image.svg).",
  "<https://example.com> a+b@example.com WWW.example.com. :constructor: :__proto__: 👩🏽‍💻 ❤️‍🔥",
  "Math \\(x^2\\), $$y^3$$, and\n\n\\[\nE=mc^2\n\\]",
  "<details>\n<summary>More</summary>\n\nBody &amp; <kbd>Ctrl</kbd>\n\n</details>",
  '[unsafe](javascript&#58;alert(1)) <script>alert(1)</script> <img src=x onerror="alert(1)">',
  "~~~text\n\\(x\\) [label](unfinished $$\n~~~\n\nAfter",
  "> ````text\n> ```\n> \\(x\\) [label](unfinished $$\n> ````\n\nAfter",
  "- example\n\n  ```text\n  \\(x\\) [label](unfinished $$\n  ```\n\nAfter",
];

for (const mode of ["characters", "words"] as const) {
  describe(`Markdown streaming by ${mode}`, () => {
    it.each(messages)("renders every intermediate prefix safely: %s", (message) => {
      // Deliberately split UTF-16 pairs too: chunk boundaries must not crash emoji handling.
      const chunks = mode === "characters" ? message.split("") : message.match(/\S+\s*|\s+/g)!;
      let prefix = "";
      for (const chunk of chunks) {
        prefix += chunk;
        const document = parseMarkdown(prepare(prefix), streaming);
        const output = renderHtml(document, streaming);
        expect(output, prefix).not.toMatch(/<(?:script|iframe)\b|\bhref="(?:javascript|data):/i);
        // The raw parser is the oracle for literal fence content. Source cleanup
        // must never alter code, even while the closing fence is incomplete.
        expect(codeValues(document.children), prefix).toEqual(codeValues(parseMarkdown(prefix).children));
      }
      expect(prefix).toBe(message);
      expect(renderHtml(prepare(prefix), streaming)).toBe(renderHtml(prepareMarkdownSource(message), options));
    });

    it("keeps an established table when a following rule arrives", () => {
      const table = "| A | B |\n| - | - |\n| x | y |\n";
      const tail = "---  \n\nAfter";
      const chunks = mode === "characters" ? tail.split("") : tail.match(/\S+\s*|\s+/g)!;
      let prefix = table;
      for (const chunk of chunks) {
        prefix += chunk;
        expect(parseMarkdown(prepare(prefix), streaming).children[0].type, prefix).toBe("table");
      }
    });

    it("keeps following prose outside a completed quote heading", () => {
      let prefix = "> Heading\n> ===\n";
      const tail = "Outside the quote";
      const chunks = mode === "characters" ? tail.split("") : tail.match(/\S+\s*|\s+/g)!;
      for (const chunk of chunks) {
        prefix += chunk;
        const blocks = parseMarkdown(prepare(prefix), streaming).children;
        expect(
          blocks.map((block) => block.type),
          prefix,
        ).toEqual(["blockquote", "paragraph"]);
      }
    });
  });
}
