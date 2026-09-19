import type { RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { prepareMarkdown } from "./markdownInput";

const parser = unified().use(remarkParse).use(remarkGfm);
const prepare = (source: string, streaming = true) => prepareMarkdown(source, parser.parse(source), streaming);

describe("literal Markdown", () => {
  it.each([
    "`\\(x\\) [label](unfinished $$`",
    "``backtick ` \\(x\\) [label](unfinished $$``",
    "```text\n\\(x\\) [label](unfinished $$\n```",
    "~~~text\n\\(x\\) [label](unfinished $$\n~~~",
    "````text\n```\n# Heading\n\\(x\\) [label](unfinished $$\n````",
    "   ```text\n\\(x\\) [label](unfinished $$\n   ```",
    "    \\(x\\) [label](unfinished $$",
    "> ```text\n> \\(x\\) [label](unfinished $$\n> ```",
    "- example\n\n  ```text\n  \\(x\\) [label](unfinished $$\n  ```",
    "[link](https://example.com/$$)",
    "![image](https://example.com/$$)",
    "[ref]: https://example.com/$$",
    "<https://example.com/$$>",
  ])("preserves %s without loading math", (source) => {
    expect(prepare(source)).toEqual({ content: source, hasMath: false });
  });

  it("leaves heading/fence boundaries to the Markdown parser", () => {
    const source = "# Before\n```text\ntext\n```\n# After";
    expect(prepare(source).content).toBe(source);
    expect(parser.parse(source).children.map((node: RootContent) => node.type)).toEqual(["heading", "code", "heading"]);
  });
});

describe("math aliases", () => {
  it("normalizes prose around literal code and detects dollar math", () => {
    expect(prepare("\\(x\\) `\\(literal\\)` \\[y\\]", false)).toEqual({
      content: "$$x$$ `\\(literal\\)` $$y$$",
      hasMath: true,
    });
    expect(prepare("$$x^2$$", false)).toEqual({ content: "$$x^2$$", hasMath: true });
  });

  it("preserves escaped backslashes and unfinished math", () => {
    const source = "\\\\(literal\\\\) and \\(unfinished";
    expect(prepare(source)).toEqual({ content: source, hasMath: false });
  });
});

describe("streaming links", () => {
  it.each([
    ["See [label](https://example", "See label"],
    ["See ![image](https://example", "See image"],
    ["See [**label**](https://example", "See **label**"],
    ["See [label `code`](https://example", "See label `code`"],
    ["[brackets] then [label](https://example", "[brackets] then label"],
    ["See [outer [inner]](https://example", "See outer [inner]"],
    ["\\(x\\) [\\(y\\)](https://example", "$$x$$ $$y$$"],
    ["`unfinished [label](https://example", "`unfinished label"],
    ["\\![label](unfinished", "\\!label"],
    ["\\\\![label](unfinished", "\\\\label"],
  ])("stabilizes %s", (source, expected) => {
    expect(prepare(source).content).toBe(expected);
  });

  it.each([
    "[label](https://example.com/a_(b))",
    "[label](https://example.com/a\\))",
    '[label](https://example.com "title (with brackets)")',
    "\\[literal](unfinished",
    "[label\\](unfinished",
    "[label](unfinished\n\nAnother paragraph",
    "[label\n\nAnother paragraph](unfinished",
  ])("preserves complete or literal links: %s", (source) => {
    expect(prepare(source).content).toBe(source);
  });

  it("flushes the original unfinished text when the stream ends", () => {
    const source = "[label](unfinished";
    expect(prepare(source, false).content).toBe(source);
  });
});
