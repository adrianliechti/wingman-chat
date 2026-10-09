import { renderHtml } from "@tanstack/markdown/html";
import { describe, expect, it } from "vitest";
import { safeHtmlExtension } from "./markdownHtml";

const html = (source: string) =>
  renderHtml(source, { allowHtml: true, extensions: [safeHtmlExtension], headingIds: false }).replace(/\n/g, "");

describe("safe HTML", () => {
  it("turns details and summary into a container around the following blocks", () => {
    const out = html("<details>\n<summary>Click **me**</summary>\n\nBody\n\n- item\n\n</details>\n\nAfter");
    expect(out).toContain("<details><summary><p>Click <strong>me</strong></p></summary><p>Body</p><ul>");
    expect(out).toMatch(/<\/ul><\/details><p>After<\/p>$/);
    expect(html("<details open>\n<summary>Open</summary>\n\nx\n\n</details>")).toContain('<details open="true">');
  });

  it("renders definition lists and keeps nested details", () => {
    const out = html("<dl>\n<dt>Term</dt>\n<dd>Def *one*</dd>\n</dl>");
    expect(out).toBe("<dl><dt><p>Term</p></dt><dd><p>Def <em>one</em></p></dd></dl>");
    const nested = html(
      "<details>\n<summary>Outer</summary>\n\n<details>\n<summary>Inner</summary>\n\nDeep\n\n</details>\n\n</details>",
    );
    expect(nested).toContain(
      "<details><summary><p>Outer</p></summary><details><summary><p>Inner</p></summary><p>Deep</p></details></details>",
    );
  });

  it("pairs allowed inline tags and drops the rest without losing text", () => {
    expect(html("H<sub>2</sub>O and x<sup>2</sup>, <kbd>Ctrl</kbd> <mark>hi</mark>")).toBe(
      "<p>H<sub>2</sub>O and x<sup>2</sup>, <kbd>Ctrl</kbd> <mark>hi</mark></p>",
    );
    expect(html("a<br>b")).toBe("<p>a<br>b</p>");
    expect(html("<span class='x' onclick='evil()'>raw</span> <script>alert(1)</script> end")).toBe(
      "<p>raw alert(1) end</p>",
    );
    expect(html("<b>bold <i>both</b> italic</i>")).toBe("<p><b>bold both</b> italic</p>");
    expect(html("unclosed <sub>x")).toBe("<p>unclosed x</p>");
  });

  it("collapses unknown block HTML to its text and never emits raw markup", () => {
    expect(html("<div class='x'>block</div>\n\ntext")).toBe("<p>block</p><p>text</p>");
    expect(html("<!-- comment -->\n\ntext")).toBe("<p>text</p>");
    expect(html("<img src=x onerror=alert(1)>")).not.toContain("onerror");
    expect(html("> <details>\n> <summary>q</summary>\n>\n> body\n>\n> </details>")).toContain(
      "<blockquote><details><summary><p>q</p></summary><p>body</p></details></blockquote>",
    );
  });
});
