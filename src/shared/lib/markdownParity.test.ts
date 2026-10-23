import { renderHtml } from "@tanstack/markdown/html";
import { describe, expect, it } from "vitest";
import { markdownToHtml } from "./markdownConvert";
import {
  hideUnfinishedLink,
  MARKDOWN_PARSE_OPTIONS,
  markdownExtensions,
  markdownUrlTransform,
  normalizeMathAliases,
  prepareMarkdownSource,
} from "./markdownExtensions";

const html = (source: string) =>
  renderHtml(prepareMarkdownSource(source), {
    ...MARKDOWN_PARSE_OPTIONS,
    extensions: markdownExtensions("monochrome"),
    urlTransform: markdownUrlTransform,
  });

// Upstream limitations, documented in docs/ai-integration.md. An unexpected
// pass prompts removing the gap, without rebuilding a block parser in cleanup.
describe("remaining TanStack parity gaps", () => {
  it.fails("keeps lazy blockquote continuations in the quote", () => {
    expect(html("> first\ncontinued")).toBe("<blockquote>\n<p>first<br>continued</p>\n</blockquote>");
  });

  it.fails("keeps nested lazy continuations at their original quote depth", () => {
    expect(html("> > first\ncontinued")).toBe(
      "<blockquote>\n<blockquote>\n<p>first<br>continued</p>\n</blockquote>\n</blockquote>",
    );
  });

  it.fails("decodes entities in image alt text", () => {
    expect(html("![A &amp; B](image.png)")).toBe('<p><img src="image.png" alt="A &amp; B"></p>');
  });

  it.fails("keeps two-space hard breaks in clipboard HTML", () => {
    expect(markdownToHtml("first  \nsecond")).toContain("<br>");
  });

  it.fails("preserves a literal backslash before a two-space hard break", () => {
    expect(markdownToHtml("first\\  \nsecond")).toBe("<p>first\\<br>second</p>");
  });
});

describe("Markdown compatibility", () => {
  it.each([
    ["first\n  \nsecond", "<p>first</p>\n<p>second</p>"],
    ["# Heading  \n\nbody", "<h1>Heading</h1>\n<p>body</p>"],
    ["---  \n\nbody", "<hr>\n<p>body</p>"],
    ["first  \n\nsecond", "<p>first</p>\n<p>second</p>"],
    ["> Heading\n> ===\noutside", "<blockquote>\n<h1>Heading</h1>\n</blockquote>\n<p>outside</p>"],
    ["> # Heading\noutside", "<blockquote>\n<h1>Heading</h1>\n</blockquote>\n<p>outside</p>"],
  ])("does not rewrite block boundaries: %s", (source, expected) => {
    expect(html(source)).toBe(expected);
    expect(markdownToHtml(source)).toBe(expected);
  });

  it("supports explicit nested quote continuations and export backslash breaks", () => {
    expect(html("> > first\n> > continued")).toBe(
      "<blockquote>\n<blockquote>\n<p>first<br>continued</p>\n</blockquote>\n</blockquote>",
    );
    expect(markdownToHtml("first\\\nsecond")).toBe("<p>first<br>second</p>");
  });

  it("supports multiline setext headings without claiming tables, HTML or math", () => {
    expect(html("first\nsecond\n======")).toBe("<h1>first<br>second</h1>");
    expect(html("A | B\ncontinued\n---")).toBe("<h2>A | B<br>continued</h2>");
    expect(html("| A | B |\n| - | - |\n| x | y |\n---")).toMatch(/^<table>[\s\S]*<\/table>\n<hr>$/);
    expect(html("A | B\n- | -\nx | y\n---")).toMatch(/^<table>[\s\S]*<\/table>\n<hr>$/);
    expect(html("$$\nx\n---\n$$")).toBe('<md-math source="x\n---" display="true"></md-math>');
    expect(html("<div>\ntext\n---\n</div>")).not.toContain("<h2>");
    expect(html("Heading[^n]\ncontinued\n===\n\n[^n]: Footnote")).not.toContain("fnref-n-2");
  });

  it("keeps literal entities in escaped and code-formatted image alt text", () => {
    expect(html("![\\&amp;](image.png)")).toBe('<p><img src="image.png" alt="&amp;amp;"></p>');
    expect(html("![`&amp;`](image.png)")).toBe('<p><img src="image.png" alt="&amp;amp;"></p>');
  });

  it("decodes title entities once while respecting escapes, including reference links", () => {
    const title = String.raw`A &amp; B \&amp; C \\&amp; D &amp;amp;`;
    const expected = 'title="A &amp; B &amp;amp; C \\&amp; D &amp;amp;"';
    expect(html(`![alt](image.png "${title}")`)).toContain(expected);
    expect(html(`**[link](page "${title}")**`)).toContain(expected);
    expect(html(`[link][ref]\n\n[ref]: page "${title}"`)).toContain(expected);
  });

  it("supports explicit autolinks, email and uppercase or local web addresses", () => {
    expect(html("<https://example.com>")).toBe('<p><a href="https://example.com">https://example.com</a></p>');
    expect(html("<a@example.com>")).toBe('<p><a href="mailto:a@example.com">a@example.com</a></p>');
    expect(html("Email a+b@example.com, then HTTP://localhost:3000.")).toBe(
      '<p>Email <a href="mailto:a+b@example.com">a+b@example.com</a>, then <a href="HTTP://localhost:3000">HTTP://localhost:3000</a>.</p>',
    );
    expect(html("(https://example.com/foo.), ok")).toBe(
      '<p>(<a href="https://example.com/foo">https://example.com/foo</a>.), ok</p>',
    );
    expect(html("[https://example.com](https://other.com)")).toBe(
      '<p><a href="https://other.com">https://example.com</a></p>',
    );
  });

  it("supports setext headings and indented code without confusing block markers", () => {
    expect(html("Heading\n=======\n\nSubheading\n---")).toBe("<h1>Heading</h1>\n<h2>Subheading</h2>");
    expect(html("    :smile: \\(x\\)\n    const x = 1;")).toContain(
      '<code class="language-plaintext">:smile: \\(x\\)\nconst x = 1;</code>',
    );
    expect(html("# Heading\n---")).toBe("<h1>Heading</h1>\n<hr>");
    expect(html("- item\n---")).toContain("<ul>");
  });

  it("decodes entities as text without turning them into markup or decoding code", () => {
    expect(html("A &amp; B &#35; &#x1f600; &lt;b&gt;")).toBe(
      '<p>A &amp; B # <span class="noto-emoji">😀</span> &lt;b&gt;</p>',
    );
    expect(html("`&amp;` \\&amp;")).toBe("<p><code>&amp;amp;</code> &amp;amp;</p>");
    expect(html("[query](https://example.com/?a=1&amp;b=2)")).toContain('href="https://example.com/?a=1&amp;b=2"');
    expect(html("[unsafe](javascript&#58;alert(1))")).not.toContain("<a");
  });

  it("treats object prototype names as unknown emoji shortcodes", () => {
    expect(html(":constructor:")).toBe("<p>:constructor:</p>");
    expect(() => html(":__proto__:")).not.toThrow();
  });

  it("keeps same-line math inline and multiline math in display mode", () => {
    expect(html("$$x^2$$")).toContain('display="false"');
    expect(html("$$\nx\n\n\ny\n$$")).toContain('display="true"');
  });

  it.each([
    "`\\(x\\) [label](unfinished $$`",
    "``backtick ` \\(x\\) [label](unfinished $$``",
    "`multi\n\\(x\\) [label](unfinished\nline`",
    "```text\n\\(x\\) [label](unfinished $$\n```",
    "~~~text\n\\(x\\) [label](unfinished $$\n~~~",
    "````text\n```\n# Heading\n\\(x\\) [label](unfinished $$\n````",
    "   ```text\n\\(x\\) [label](unfinished $$\n   ```",
    "    \\(x\\) [label](unfinished $$",
    "> ```text\n> \\(x\\) [label](unfinished $$\n> ```",
    "- example\n\n  ```text\n  \\(x\\) [label](unfinished $$\n  ```",
    "[link](https://example.com/\\(x\\))",
    "![image](https://example.com/\\(x\\))",
    "[ref]: https://example.com/\\(x\\)",
    "<https://example.com/\\(x\\)>",
  ])("keeps literal source intact: %s", (source) => {
    expect(normalizeMathAliases(source)).toBe(source);
    expect(hideUnfinishedLink(source)).toBe(source);
  });

  it("only normalizes complete aliases, leaving escaped or code-contained closers alone", () => {
    expect(normalizeMathAliases("\\(x\\)\n\\(x")).toBe("$$x$$\n\\(x");
    expect(normalizeMathAliases("\\(before `\\)` after")).toBe("\\(before `\\)` after");
    expect(normalizeMathAliases("\\(x\\\\) no close")).toBe("\\(x\\\\) no close");
    expect(normalizeMathAliases("> ```\n> \\(code\\)\n\n\\(prose\\)")).toBe("> ```\n> \\(code\\)\n\n$$prose$$");
  });

  it("preserves later paragraphs and labels with inline code while streaming", () => {
    expect(hideUnfinishedLink("[label](unfinished\n \t\nAnother paragraph")).toBe(
      "[label](unfinished\n \t\nAnother paragraph",
    );
    expect(hideUnfinishedLink("~~~\n[label](literal\n~~~\n\n[**real** `code`](unfinished")).toBe(
      "~~~\n[label](literal\n~~~\n\n**real** `code`",
    );
    expect(hideUnfinishedLink("\\![label](unfinished")).toBe("\\!label");
  });
});
