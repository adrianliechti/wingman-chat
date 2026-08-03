import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { validateOoxmlRelationships } from "./ooxmlRelationships";

const DOCUMENT = "word/document.xml";
const RELS = "word/_rels/document.xml.rels";
const IMAGE_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const LINK_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";

function relationships(...entries: string[]): string {
  return `<Relationships>${entries.join("")}</Relationships>`;
}

describe("OOXML relationships", () => {
  it("accepts a document whose image relationship resolves", async () => {
    const zip = new JSZip();
    zip.file(DOCUMENT, '<document><drawing><blip r:embed="rId4"/></drawing></document>');
    zip.file(RELS, relationships(`<Relationship Id="rId4" Type="${IMAGE_TYPE}" Target="media/image1.png"/>`));
    zip.file("word/media/image1.png", "png");

    await expect(validateOoxmlRelationships(zip, [DOCUMENT])).resolves.toEqual([]);
  });

  it("flags a relationship whose target part was dropped", async () => {
    const zip = new JSZip();
    zip.file(DOCUMENT, '<document><drawing><blip r:embed="rId4"/></drawing></document>');
    zip.file(RELS, relationships(`<Relationship Id="rId4" Type="${IMAGE_TYPE}" Target="media/image1.png"/>`));

    const issues = await validateOoxmlRelationships(zip, [DOCUMENT]);

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("fail");
    expect(issues[0].message).toContain("targets missing part word/media/image1.png");
  });

  it("flags a reference to an undeclared relationship id", async () => {
    const zip = new JSZip();
    zip.file(DOCUMENT, '<document><hyperlink r:id="rId9"/></document>');
    zip.file(RELS, relationships(`<Relationship Id="rId4" Type="${IMAGE_TYPE}" Target="media/image1.png"/>`));
    zip.file("word/media/image1.png", "png");

    const issues = await validateOoxmlRelationships(zip, [DOCUMENT]);

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("references rId9");
  });

  it("does not require external targets to exist in the package", async () => {
    const zip = new JSZip();
    zip.file(DOCUMENT, '<document><hyperlink r:id="rId7"/></document>');
    zip.file(
      RELS,
      relationships(`<Relationship Id="rId7" Type="${LINK_TYPE}" Target="https://example.com" TargetMode="External"/>`),
    );

    await expect(validateOoxmlRelationships(zip, [DOCUMENT])).resolves.toEqual([]);
  });

  it("reports each missing id once regardless of how often it is referenced", async () => {
    const zip = new JSZip();
    zip.file(DOCUMENT, '<document><blip r:embed="rId4"/><blip r:embed="rId4"/><blip r:embed="rId4"/></document>');
    zip.file(RELS, relationships());

    const issues = await validateOoxmlRelationships(zip, [DOCUMENT]);

    expect(issues).toHaveLength(1);
  });
});
