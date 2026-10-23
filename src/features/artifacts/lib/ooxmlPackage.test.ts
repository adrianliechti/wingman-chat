import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { OoxmlPackageReader, ooxmlText, parseOoxmlXml, resolveTargetChecked } from "@/shared/lib/ooxml";
import { OoxmlIssueCollector, validateOoxmlPackage } from "./ooxmlPackage";

const CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL_STRICT = "http://purl.oclc.org/ooxml/officeDocument/relationships";
const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const WORD_STRICT = "http://purl.oclc.org/ooxml/wordprocessingml/main";
const PRESENTATION = "http://schemas.openxmlformats.org/presentationml/2006/main";

function contentTypes(extra = ""): string {
  return `<Types xmlns="${CONTENT_TYPES_NS}">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Default Extension="png" ContentType="image/png"/>
    ${extra}
  </Types>`;
}

function relationships(...entries: string[]): string {
  return `<Relationships xmlns="${PACKAGE_REL_NS}">${entries.join("")}</Relationships>`;
}

function addRoot(zip: JSZip, mainPath: string, strict = false): void {
  zip.file("[Content_Types].xml", contentTypes());
  zip.file(
    "_rels/.rels",
    relationships(
      `<Relationship Id="officeDocument" Type="${strict ? REL_STRICT : REL}/officeDocument" Target="/${mainPath}"/>`,
    ),
  );
}

describe("OOXML package validation", () => {
  it("walks arbitrary relationship ids through nested document dependencies", async () => {
    const zip = new JSZip();
    addRoot(zip, "word/document.xml");
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="${WORD}" xmlns:r="${REL}"><w:body><w:drawing r:id="chartRel"/></w:body></w:document>`,
    );
    zip.file(
      "word/_rels/document.xml.rels",
      relationships(`<Relationship Id="chartRel" Type="${REL}/chart" Target="charts/chart1.xml"/>`),
    );
    zip.file(
      "word/charts/chart1.xml",
      `<c:chartSpace xmlns:c="${REL}/chart" xmlns:r="${REL}"><c:marker r:embed="markerImage"/></c:chartSpace>`,
    );
    zip.file(
      "word/charts/_rels/chart1.xml.rels",
      relationships(`<Relationship Id="markerImage" Type="${REL}/image" Target="../media/marker.png"/>`),
    );
    zip.file("word/media/marker.png", "png");

    const result = await validateOoxmlPackage(zip, "docx");

    expect(result.issues).toEqual([]);
    expect(result.mainPart).toBe("word/document.xml");
  });

  it("flags an undeclared arbitrary relationship id", async () => {
    const zip = new JSZip();
    addRoot(zip, "word/document.xml");
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="${WORD}" xmlns:r="${REL}"><w:body><w:drawing r:id="imageRel"/></w:body></w:document>`,
    );

    const result = await validateOoxmlPackage(zip, "docx");

    expect(result.issues.map((issue) => issue.message)).toContainEqual(expect.stringContaining("references imageRel"));
  });

  it("accepts Strict namespaces and a root-absolute custom main-part path", async () => {
    const zip = new JSZip();
    addRoot(zip, "custom/document.xml", true);
    zip.file("custom/document.xml", `<w:document xmlns:w="${WORD_STRICT}"><w:body/></w:document>`);

    const result = await validateOoxmlPackage(zip, "docx");

    expect(result.issues).toEqual([]);
    expect(result.mainPart).toBe("custom/document.xml");
  });

  it("rejects malformed and foreign-namespace relationship parts", async () => {
    const malformed = new JSZip();
    malformed.file("[Content_Types].xml", contentTypes());
    malformed.file("_rels/.rels", "<Relationships>");
    malformed.file("word/document.xml", `<w:document xmlns:w="${WORD}"/>`);

    const malformedResult = await validateOoxmlPackage(malformed, "docx");
    expect(malformedResult.issues.map((issue) => issue.message)).toContainEqual(expect.stringContaining("malformed"));

    const foreign = new JSZip();
    foreign.file("[Content_Types].xml", contentTypes());
    foreign.file(
      "_rels/.rels",
      `<Relationships xmlns="urn:not-opc"><Relationship Id="main" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    foreign.file("word/document.xml", `<w:document xmlns:w="${WORD}"/>`);

    const foreignResult = await validateOoxmlPackage(foreign, "docx");
    expect(foreignResult.issues.map((issue) => issue.message)).toContainEqual(
      expect.stringContaining("invalid Relationships root namespace"),
    );
  });

  it("rejects duplicate relationship ids and missing content types", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<Types xmlns="${CONTENT_TYPES_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      relationships(
        `<Relationship Id="same" Type="${REL}/officeDocument" Target="word/document.xml"/>`,
        `<Relationship Id="same" Type="${REL}/officeDocument" Target="word/other.xml"/>`,
      ),
    );
    zip.file("word/document.xml", `<w:document xmlns:w="${WORD}"/>`);

    const result = await validateOoxmlPackage(zip, "docx");
    const messages = result.issues.map((issue) => issue.message);

    expect(messages).toContainEqual(expect.stringContaining("duplicates relationship Id same"));
    expect(messages).toContainEqual(expect.stringContaining("No content type is declared"));
  });

  it("discovers logical slides in presentation order instead of filename order", async () => {
    const zip = new JSZip();
    addRoot(zip, "ppt/presentation.xml");
    zip.file(
      "ppt/presentation.xml",
      `<p:presentation xmlns:p="${PRESENTATION}" xmlns:r="${REL}"><p:sldIdLst>
        <p:sldId id="256" r:id="cover"/><p:sldId id="257" r:id="appendix"/>
      </p:sldIdLst></p:presentation>`,
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      relationships(
        `<Relationship Id="cover" Type="${REL}/slide" Target="slides/intro.xml"/>`,
        `<Relationship Id="appendix" Type="${REL}/slide" Target="slides/z-last.xml"/>`,
      ),
    );
    zip.file("ppt/slides/intro.xml", `<p:sld xmlns:p="${PRESENTATION}"/>`);
    zip.file("ppt/slides/z-last.xml", `<p:sld xmlns:p="${PRESENTATION}"/>`);

    const result = await validateOoxmlPackage(zip, "pptx");

    expect(result.issues).toEqual([]);
    expect(result.logicalUnits.map((unit) => unit.path)).toEqual(["ppt/slides/intro.xml", "ppt/slides/z-last.xml"]);
  });

  it("reports a referenced logical slide whose target part is absent", async () => {
    const zip = new JSZip();
    addRoot(zip, "ppt/presentation.xml");
    zip.file(
      "ppt/presentation.xml",
      `<p:presentation xmlns:p="${PRESENTATION}" xmlns:r="${REL}"><p:sldIdLst><p:sldId id="256" r:id="missingSlide"/></p:sldIdLst></p:presentation>`,
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      relationships(`<Relationship Id="missingSlide" Type="${REL}/slide" Target="slides/missing.xml"/>`),
    );

    const result = await validateOoxmlPackage(zip, "pptx");

    expect(result.logicalUnits).toMatchObject([{ ordinal: 1, present: false, path: "ppt/slides/missing.xml" }]);
    expect(result.issues.map((issue) => issue.message)).toContainEqual(expect.stringContaining("targets missing part"));
  });

  it("validates relationship parts even when their source is unreachable", async () => {
    const zip = new JSZip();
    addRoot(zip, "word/document.xml");
    zip.file("word/document.xml", `<w:document xmlns:w="${WORD}"/>`);
    zip.file(
      "word/_rels/orphan.xml.rels",
      relationships(`<Relationship Id="missing" Type="${REL}/image" Target="media/missing.png"/>`),
    );

    const result = await validateOoxmlPackage(zip, "docx");

    expect(result.issues.map((issue) => issue.message)).toContainEqual(
      expect.stringContaining("belongs to missing source part word/orphan.xml"),
    );
  });
});

describe("consolidated OOXML primitives", () => {
  it("normalizes root-absolute and multi-level relative targets", () => {
    expect(resolveTargetChecked("word/charts/chart1.xml", "../media/image.png")).toEqual({
      path: "word/media/image.png",
    });
    expect(resolveTargetChecked("word/document.xml", "/word/media/image.png")).toEqual({
      path: "word/media/image.png",
    });
    expect(resolveTargetChecked("word/document.xml", "../../escape.xml").error).toContain("escapes");
  });

  it("enforces archive entry limits before reading XML", () => {
    const zip = new JSZip();
    zip.file("one.xml", "<one/>");
    zip.file("two.xml", "<two/>");
    expect(() => new OoxmlPackageReader(zip, { maxArchiveEntries: 1 })).toThrow("entry limit");
  });

  it("rejects document types, duplicate attributes, and bounded-parser overflows", () => {
    expect(() => parseOoxmlXml('<!DOCTYPE root SYSTEM "file:///etc/passwd"><root/>')).toThrow("forbidden");
    expect(() => parseOoxmlXml('<root value="one" value="two"/>')).toThrow("duplicate attribute");
    expect(() => parseOoxmlXml("<root><child/></root>", "depth.xml", { maxXmlNodes: 10, maxXmlDepth: 1 })).toThrow(
      "depth limit",
    );
    expect(() => parseOoxmlXml("<root><one/><two/></root>", "nodes.xml", { maxXmlNodes: 2, maxXmlDepth: 10 })).toThrow(
      "node XML limit",
    );
  });

  it("preserves mixed XML text in document order", () => {
    const root = parseOoxmlXml("<root>before<child>inside</child>after</root>");

    expect(ooxmlText(root)).toBe("beforeinsideafter");
  });

  it("reports zip paths that JSZip had to sanitize", async () => {
    const authored = new JSZip();
    authored.file("../outside.xml", "<outside/>");
    const loaded = await JSZip.loadAsync(await authored.generateAsync({ type: "uint8array" }));

    expect(new OoxmlPackageReader(loaded).pathProblems).toContainEqual(expect.stringContaining("was sanitized"));
  });

  it("caps findings before adversarial inputs can create unbounded reports", () => {
    const collector = new OoxmlIssueCollector();
    for (let index = 0; index < 100; index++) collector.fail("test", `finding ${index}`);

    expect(collector.issues).toHaveLength(12);
    expect(collector.issues.at(-1)?.id).toBe("ooxml.issue-limit");
  });
});
