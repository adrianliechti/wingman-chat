import { describe, expect, it } from "vitest";
import {
  lineAt,
  referenceDefinitions,
  removeBlankBlock,
  sourceOffsetFromRendered,
  splitMarkdownBlocks,
} from "./markdownBlocks";

const blocks = (source: string) => splitMarkdownBlocks(source).map((block) => source.slice(block.start, block.end));

describe("splitMarkdownBlocks", () => {
  it("splits at blank lines and keeps each block's exact source", () => {
    expect(blocks("# Title\n\nFirst line\nsecond line\n\n\n> quote\n")).toEqual([
      "# Title",
      "First line\nsecond line",
      "> quote",
    ]);
    expect(blocks("")).toEqual([]);
    expect(blocks("\n\n")).toEqual([]);
  });

  it("keeps fenced code, display math and HTML comments whole across blank lines", () => {
    expect(blocks("Intro\n```js\na()\n\nb()\n```\n\nAfter")).toEqual(["Intro\n```js\na()\n\nb()\n```", "After"]);
    expect(blocks("~~~~\n```\n\n~~~\n~~~~\nnext")).toEqual(["~~~~\n```\n\n~~~\n~~~~\nnext"]);
    expect(blocks("$$\na\n\nb\n$$\n\nText")).toEqual(["$$\na\n\nb\n$$", "Text"]);
    expect(blocks("<!-- note\n\nstill note -->\n\nText")).toEqual(["<!-- note\n\nstill note -->", "Text"]);
  });

  it("treats unclosed math as text and an unclosed fence as running to the end", () => {
    expect(blocks("$$ price\n\nText")).toEqual(["$$ price", "Text"]);
    expect(blocks("```\ncode\n\nmore")).toEqual(["```\ncode\n\nmore"]);
  });

  it("keeps loose lists and their indented continuations in one block", () => {
    expect(blocks("- one\n\n- two\n\n  more of two\n\nParagraph\n\n    indented code")).toEqual([
      "- one\n\n- two\n\n  more of two",
      "Paragraph",
      "    indented code",
    ]);
    expect(blocks("Intro:\n1. a\n\n2. b")).toEqual(["Intro:\n1. a\n\n2. b"]);
  });

  it("keeps front matter as its own block", () => {
    expect(blocks("---\ntitle: x\n\nlist: []\n---\n# Doc")).toEqual(["---\ntitle: x\n\nlist: []\n---", "# Doc"]);
    expect(blocks("---\n\nText")).toEqual(["---", "Text"]);
  });
});

describe("referenceDefinitions", () => {
  it("collects definition-only blocks", () => {
    expect(referenceDefinitions("See [docs][d].\n\n[d]: https://example.com\n[e]: /e\n\n[^1]: note")).toBe(
      "[d]: https://example.com\n[e]: /e",
    );
    expect(referenceDefinitions("No refs [here].")).toBe("");
  });
});

describe("sourceOffsetFromRendered", () => {
  it("skips markup and link destinations", () => {
    const source = "Some **bold** and [a link](https://m.example) more";
    expect(sourceOffsetFromRendered(source, "Some bo")).toBe(source.indexOf("ld**"));
    expect(sourceOffsetFromRendered(source, "Some bold and a link mo")).toBe(source.indexOf("re"));
    expect(sourceOffsetFromRendered("## Heading", "Head")).toBe(7);
  });

  it("stops at characters the source does not contain", () => {
    expect(sourceOffsetFromRendered("Hi :smile: there", "Hi 😄 th")).toBe(2);
  });
});

describe("removeBlankBlock", () => {
  it("drops a cleared block and its blank lines", () => {
    const source = "A\n\n\n\nC\n";
    const result = removeBlankBlock(source, 3, 3);
    expect(result?.source).toBe("A\n\nC\n");
    expect(result?.shift(source.indexOf("C"))).toBe(3);
    expect(result?.shift(0)).toBe(0);
  });

  it("keeps the final newline when the last block is cleared", () => {
    expect(removeBlankBlock("A\n\n  \n", 3, 5)?.source).toBe("A\n");
    expect(removeBlankBlock("\n\nB", 0, 1)?.source).toBe("B");
  });

  it("leaves blocks with text and lone blank documents alone", () => {
    expect(removeBlankBlock("A\n\nB", 3, 4)).toBeNull();
    expect(removeBlankBlock("  \n", 0, 2)).toBeNull();
  });
});

describe("lineAt", () => {
  it("counts lines before an offset", () => {
    expect(lineAt("a\nb\nc", 0)).toBe(1);
    expect(lineAt("a\nb\nc", 2)).toBe(2);
    expect(lineAt("a\nb\nc", 5)).toBe(3);
  });
});
