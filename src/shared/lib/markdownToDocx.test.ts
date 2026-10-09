import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { markdownToDocx } from "./markdownToDocx";

async function exportXml(source: string) {
  const blob = await markdownToDocx(source);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return {
    document: await zip.file("word/document.xml")!.async("string"),
    relationships: await zip.file("word/_rels/document.xml.rels")!.async("string"),
  };
}

describe("Markdown Word export", () => {
  it("preserves formatting, numbering, tasks, code and table alignment", async () => {
    const { document } = await exportXml(
      "# Heading\n\n**bold** *italic* ~~gone~~\n\n3. third\n4. fourth\n\n- [x] done\n- [ ] pending\n\n```js\nconst x = 1;\n```\n\n| A | B |\n| - | -: |\n| x | y |",
    );
    expect(document).toContain('w:val="Heading1"');
    expect(document).toContain("<w:b/>");
    expect(document).toContain("<w:i/>");
    expect(document).toContain("<w:strike/>");
    for (const text of ["3. ", "4. ", "☑ ", "☐ ", "const x = 1;"]) expect(document).toContain(text);
    expect(document).toContain('w:ascii="Courier New"');
    expect(document.match(/<w:tr>/g)).toHaveLength(2);
    expect(document.match(/<w:tc>/g)).toHaveLength(4);
    expect(document).toContain('<w:jc w:val="right"/>');
  });

  it("keeps hyperlink destinations and footnotes instead of silently dropping them", async () => {
    const { document, relationships } = await exportXml(
      "[file](sandbox:/report.md) [web](https://example.com) :smile: Note[^a].\n\n[^a]: Footnote content.",
    );
    expect(relationships).toContain('Target="sandbox:/report.md"');
    expect(relationships).toContain('Target="https://example.com"');
    expect(document).toContain("😄");
    expect(document.match(/\[1\]/g)).toHaveLength(2);
    expect(document).toContain("Footnote content.");
  });
});
