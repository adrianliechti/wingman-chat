// @vitest-environment happy-dom
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { pptxToHtml } from "./pptxToHtml";

const relNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

async function renderShape(
  geometry: string,
  fill = '<a:solidFill><a:srgbClr val="CC3300"/></a:solidFill>',
  style = "",
) {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="${relNs}"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relNs}/slide" Target="slides/slide1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm rot="5400000" flipH="1"><a:off x="952500" y="476250"/><a:ext cx="1905000" cy="952500"/></a:xfrm>${geometry}${fill}<a:ln w="19050" cap="rnd"><a:solidFill><a:srgbClr val="003366"/></a:solidFill><a:prstDash val="sysDot"/></a:ln></p:spPr>${style}<p:txBody><a:bodyPr/><a:p><a:r><a:t>Editable label</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const file = new File([await zip.generateAsync({ type: "arraybuffer" })], "geometry.pptx");
  const deck = await pptxToHtml(file);
  return new DOMParser().parseFromString(await deck.getSlide(0), "text/html");
}

describe("PPTX vector shapes", () => {
  it("renders freeform curves and compound holes at the shape's size, keeping its transform and text", async () => {
    const doc = await renderShape(
      `<a:custGeom><a:pathLst><a:path w="1000" h="1000"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="1000" y="0"/></a:lnTo><a:cubicBezTo><a:pt x="1000" y="500"/><a:pt x="500" y="1000"/><a:pt x="0" y="1000"/></a:cubicBezTo><a:close/><a:moveTo><a:pt x="200" y="200"/></a:moveTo><a:lnTo><a:pt x="200" y="400"/></a:lnTo><a:lnTo><a:pt x="400" y="200"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>`,
    );
    const path = doc.querySelector("svg > path");
    expect(path?.getAttribute("d")).toBe("M 0 0 L 200 0 C 200 50 100 100 0 100 Z M 40 20 L 40 40 L 80 20 Z");
    expect(path?.getAttribute("fill")).toBe("#CC3300");
    expect(path?.getAttribute("stroke")).toBe("#003366");
    expect(path?.getAttribute("stroke-width")).toBe("2");
    expect(path?.getAttribute("stroke-linecap")).toBe("round");
    expect(path?.getAttribute("stroke-dasharray")).toBe("1 3");
    expect(doc.querySelector("svg")?.parentElement?.getAttribute("style")).toContain("rotate(90deg) scaleX(-1)");
    expect(doc.body.textContent).toContain("Editable label");
  });

  it("honors per-path paint and guide coordinates when path dimensions are omitted", async () => {
    const doc = await renderShape(
      `<a:custGeom><a:avLst><a:gd name="adj" fmla="val 4"/></a:avLst><a:gdLst><a:gd name="inset" fmla="*/ w 1 adj"/></a:gdLst><a:pathLst><a:path stroke="0"><a:moveTo><a:pt x="inset" y="0"/></a:moveTo><a:lnTo><a:pt x="r" y="b"/></a:lnTo><a:lnTo><a:pt x="0" y="b"/></a:lnTo><a:close/></a:path><a:path w="10" h="20" fill="none"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:quadBezTo><a:pt x="5" y="20"/><a:pt x="10" y="0"/></a:quadBezTo></a:path></a:pathLst></a:custGeom>`,
    );
    const paths = doc.querySelectorAll("svg > path");
    expect(paths).toHaveLength(2);
    expect(paths[0]?.getAttribute("d")).toBe("M 50 0 L 200 100 L 0 100 Z");
    expect(paths[0]?.getAttribute("stroke")).toBe("none");
    expect(paths[1]?.getAttribute("d")).toBe("M 0 0 Q 100 100 200 0");
    expect(paths[1]?.getAttribute("fill")).toBe("none");
    expect(paths[1]?.getAttribute("stroke")).toBe("#003366");
  });

  it("renders adjusted arcs as open outlines with a separate wedge fill", async () => {
    const doc = await renderShape(
      `<a:prstGeom prst="arc"><a:avLst><a:gd name="adj1" fmla="val 0"/><a:gd name="adj2" fmla="val 10800000"/></a:avLst></a:prstGeom>`,
    );
    const paths = doc.querySelectorAll("svg > path");
    expect(paths).toHaveLength(2);
    expect(paths[0]?.getAttribute("d")).toBe("M 200 50 A 100 50 0 0 1 0 50 L 100 50 Z");
    expect(paths[0]?.getAttribute("stroke")).toBe("none");
    expect(paths[1]?.getAttribute("d")).toBe("M 200 50 A 100 50 0 0 1 0 50");
    expect(paths[1]?.getAttribute("fill")).toBe("none");
  });

  it.each([0, 1000])("keeps unfilled themed arcs transparent for fillRef %i", async (index) => {
    const doc = await renderShape(
      '<a:prstGeom prst="arc"/>',
      "",
      `<p:style><a:fillRef idx="${index}"><a:srgbClr val="CC3300"/></a:fillRef></p:style>`,
    );
    const paths = Array.from(doc.querySelectorAll("svg > path"));
    expect(paths).toHaveLength(2);
    expect(paths.every((path) => path.getAttribute("fill") === "none")).toBe(true);
    expect(paths[1]?.getAttribute("stroke")).toBe("#003366");
  });

  it("renders a block arc as a hollow band with its adjusted thickness", async () => {
    const doc = await renderShape(
      '<a:prstGeom prst="blockArc"><a:avLst><a:gd name="adj1" fmla="val 0"/><a:gd name="adj2" fmla="val 5400000"/><a:gd name="adj3" fmla="val 10000"/></a:avLst></a:prstGeom>',
    );
    expect(doc.querySelector("svg > path")?.getAttribute("d")).toBe(
      "M 200 50 A 100 50 0 0 1 100 100 L 100 90 A 90 40 0 0 0 190 50 Z",
    );
  });

  it("renders circular flowchart connectors with dotted outlines", async () => {
    const doc = await renderShape('<a:prstGeom prst="flowChartConnector"/>', "<a:noFill/>");
    const outline = doc.querySelector('div[style*="border-radius:50%"]');
    expect(outline?.getAttribute("style")).toContain("border:2px dotted #003366");
    expect(outline?.getAttribute("style")).not.toContain("background:");
  });

  it("retains a full custom ellipse and clips gradient fills to it", async () => {
    const doc = await renderShape(
      '<a:custGeom><a:pathLst><a:path w="200" h="100"><a:moveTo><a:pt x="200" y="50"/></a:moveTo><a:arcTo wR="100" hR="50" stAng="0" swAng="21600000"/><a:close/></a:path></a:pathLst></a:custGeom>',
      '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="CC3300"/></a:gs><a:gs pos="100000"><a:srgbClr val="003366"/></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill>',
    );
    const clip = doc.querySelector("clipPath");
    expect(clip?.querySelector("path")?.getAttribute("d")).toBe("M 200 50 A 100 50 0 0 1 0 50 A 100 50 0 0 1 200 50 Z");
    expect(doc.querySelector("foreignObject")?.getAttribute("clip-path")).toBe(`url(#${clip?.id})`);
    expect(doc.querySelector("foreignObject div")?.getAttribute("style")).toContain(
      "linear-gradient(90deg, #CC3300 0%, #003366 100%)",
    );
    expect(doc.querySelector("svg > path")?.getAttribute("fill")).toBe("none");
  });
});
