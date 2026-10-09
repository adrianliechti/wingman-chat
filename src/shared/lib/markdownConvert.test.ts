import { describe, expect, it } from "vitest";
import { markdownToHtml, markdownToText } from "./markdownConvert";

describe("Markdown clipboard export", () => {
  it("keeps headings, formatting, tables and ordered list starts", () => {
    const html = markdownToHtml(
      "# Heading\n\n**bold** and *italic* and ~~gone~~\n\n3. third\n4. fourth\n\n| A | B |\n| - | -: |\n| x | y |",
    );
    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain("<strong>bold</strong> and <em>italic</em> and <del>gone</del>");
    expect(html).toContain('<ol start="3">');
    expect(html).toContain('<table border="1"');
    expect(html).toContain("text-align:right");
  });

  it("preserves workspace links while filtering executable destinations", () => {
    const html = markdownToHtml(
      "[file](sandbox:/report.md) [artifact](artifact:/report.md) [unsafe](javascript:alert(1))",
    );
    expect(html).toContain('href="sandbox:/report.md"');
    expect(html).toContain('href="artifact:/report.md"');
    expect(html).not.toContain("javascript:");
  });

  it("keeps export math and code literal, native emoji, and ordinary soft breaks", () => {
    const source = ":smile: ❤️\nnext $$x^2$$\n\n```text\n:smile: $$x^2$$\n```";
    const html = markdownToHtml(source);
    expect(html).toContain("😄 ❤️\nnext $$x^2$$");
    expect(html).toContain(":smile: $$x^2$$</code>");
    expect(html).not.toContain("noto-emoji");
    expect(html).not.toContain("<br>");
    expect(markdownToText("**bold** and `literal_*`")).toBe("bold and literal_*");
  });
});
