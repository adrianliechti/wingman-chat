/**
 * Hybrid PPTX export: pixel-perfect rasterized background + editable overlays.
 *
 * Each slide gets:
 * 1. A full-resolution JPEG background (all visual design preserved)
 * 2. Editable shapes (rectangles with fills/borders)
 * 3. Editable images (movable/replaceable in PowerPoint)
 * 4. Editable text boxes (searchable, editable with formatting)
 *
 * No LLM needed — fast, deterministic export.
 */

import { downloadFromUrl } from "@/shared/lib/utils";
import { renderSlideToJpegDataUrl } from "./html-slide-export";
import { parseSlideHtml, type ParsedElement, type ParsedParagraph, type ParsedSlide } from "./pptx-static-parser";
import {
  SLIDE_CX,
  SLIDE_CY,
  pxToEmu,
  cssColorToHex,
  fontSizeToPptx,
  isBold,
  alignmentToPptx,
  escapeXml,
  escapeTextForPptx,
  addPptxBoilerplate,
} from "./pptx-utils";

export type ExportProgress = (current: number, total: number) => void;

// ── Public API ──────────────────────────────────────────────────────────────

export async function downloadHtmlSlidesAsHybridPptx(
  htmlSlides: string[],
  slug: string,
  onProgress?: ExportProgress,
): Promise<void> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const slideCount = htmlSlides.length;

  onProgress?.(0, slideCount);

  // Process each slide: rasterize background + extract elements
  const slideData: { jpeg: string; parsed: ParsedSlide }[] = [];

  for (let i = 0; i < slideCount; i++) {
    const [jpeg, parsed] = await Promise.all([
      renderSlideToJpegDataUrl(htmlSlides[i], { hideText: true }),
      parseSlideHtml(htmlSlides[i]),
    ]);
    slideData.push({ jpeg, parsed });
    onProgress?.(i + 1, slideCount);
  }

  // Build PPTX
  addPptxBoilerplate(zip, slideCount);

  let mediaCounter = 0;

  for (let i = 0; i < slideCount; i++) {
    const { jpeg, parsed } = slideData[i];
    const slideNum = i + 1;

    // Background image
    mediaCounter++;
    const bgMediaName = `media${mediaCounter}.jpeg`;
    zip.file(`ppt/media/${bgMediaName}`, jpeg.split(",")[1], { base64: true });

    // Extract images as separate editable objects
    const imageElements = parsed.elements.filter((el) => el.type === "image" && el.imageData);
    const imageMedia: { rId: string; mediaPath: string }[] = [];

    for (const img of imageElements) {
      mediaCounter++;
      const ext = img.imageData!.startsWith("data:image/jpeg") ? "jpeg" : "png";
      const mediaName = `media${mediaCounter}.${ext}`;
      const base64 = img.imageData!.split(",")[1];
      if (base64) {
        zip.file(`ppt/media/${mediaName}`, base64, { base64: true });
        imageMedia.push({ rId: `rId${3 + imageMedia.length}`, mediaPath: mediaName });
      }
    }

    // Build slide XML
    const textElements = parsed.elements.filter((el) => el.type === "text");
    const shapeElements = parsed.elements.filter((el) => el.type === "shape");
    const slideXml = buildSlideXml(textElements, shapeElements, imageElements, imageMedia);
    zip.file(`ppt/slides/slide${slideNum}.xml`, slideXml);

    // Build slide rels
    const rels = [
      `  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`,
      `  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${bgMediaName}"/>`,
      ...imageMedia.map((m) =>
        `  <Relationship Id="${m.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${m.mediaPath}"/>`,
      ),
    ];

    zip.file(
      `ppt/slides/_rels/slide${slideNum}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rels.join("\n")}
</Relationships>`,
    );
  }

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
  const url = URL.createObjectURL(blob);
  downloadFromUrl(url, `${slug}.pptx`);
  URL.revokeObjectURL(url);
}

// ── Slide XML builder ───────────────────────────────────────────────────────

function buildSlideXml(
  textElements: ParsedElement[],
  shapeElements: ParsedElement[],
  imageElements: ParsedElement[],
  imageMedia: { rId: string; mediaPath: string }[],
): string {
  const parts: string[] = [];
  let nextId = 3; // 1 = group, 2 = background

  // Layer 1: Background image
  parts.push(`    <p:pic>
      <p:nvPicPr><p:cNvPr id="2" name="Background"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
      <p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
      <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${SLIDE_CX}" cy="${SLIDE_CY}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
    </p:pic>`);

  // Layer 2: Editable shapes
  for (const sh of shapeElements) {
    const id = nextId++;
    const prst = sh.borderRadius && sh.borderRadius > 5 ? "roundRect" : "rect";
    const fillXml = sh.backgroundColor
      ? `<a:solidFill><a:srgbClr val="${cssColorToHex(sh.backgroundColor)}"/></a:solidFill>`
      : "<a:noFill/>";
    const lineXml =
      sh.borderColor && sh.borderWidth
        ? `<a:ln w="${Math.round(sh.borderWidth * 12700)}"><a:solidFill><a:srgbClr val="${cssColorToHex(sh.borderColor)}"/></a:solidFill></a:ln>`
        : "<a:ln><a:noFill/></a:ln>";

    parts.push(`    <p:sp>
      <p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="${pxToEmu(sh.x)}" y="${pxToEmu(sh.y)}"/><a:ext cx="${pxToEmu(sh.w)}" cy="${pxToEmu(sh.h)}"/></a:xfrm>
        <a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>
        ${fillXml}
        ${lineXml}
      </p:spPr>
    </p:sp>`);
  }

  // Layer 3: Editable images
  for (let imgIdx = 0; imgIdx < imageElements.length; imgIdx++) {
    const img = imageElements[imgIdx];
    const media = imageMedia[imgIdx];
    if (!media) continue;
    const id = nextId++;

    parts.push(`    <p:pic>
      <p:nvPicPr><p:cNvPr id="${id}" name="Image ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
      <p:blipFill><a:blip r:embed="${media.rId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
      <p:spPr><a:xfrm><a:off x="${pxToEmu(img.x)}" y="${pxToEmu(img.y)}"/><a:ext cx="${pxToEmu(img.w)}" cy="${pxToEmu(img.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
    </p:pic>`);
  }

  // Layer 4: Editable text boxes
  for (const el of textElements) {
    if (!el.paragraphs?.length) continue;
    const id = nextId++;

    parts.push(`    <p:sp>
      <p:nvSpPr><p:cNvPr id="${id}" name="TextBox ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="${pxToEmu(el.x)}" y="${pxToEmu(el.y)}"/><a:ext cx="${pxToEmu(el.w)}" cy="${pxToEmu(el.h)}"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        <a:noFill/>
        <a:ln><a:noFill/></a:ln>
      </p:spPr>
      <p:txBody>
        <a:bodyPr wrap="square" rtlCol="0" anchor="t" lIns="0" tIns="0" rIns="0" bIns="0"/>
        <a:lstStyle/>
${buildParagraphsXml(el.paragraphs, el)}
      </p:txBody>
    </p:sp>`);
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
${parts.join("\n")}
    </p:spTree>
  </p:cSld>
</p:sld>`;
}

function buildParagraphsXml(paragraphs: ParsedParagraph[], parent: ParsedElement): string {
  return paragraphs
    .map((p) => {
      const sz = fontSizeToPptx(p.fontSize || parent.fontSize || 16);
      const bold = isBold(p.fontWeight || parent.fontWeight) ? ' b="1"' : "";
      const italic = (p.fontStyle || parent.fontStyle) === "italic" ? ' i="1"' : "";
      const colorHex = cssColorToHex(p.color || parent.color || "rgb(0,0,0)");
      const font = p.fontFamily || parent.fontFamily || "Calibri";
      const align = alignmentToPptx(p.textAlign || parent.textAlign);
      const bulletXml = p.isBullet ? `<a:buFont typeface="Arial"/><a:buChar char="&#x2022;"/>` : "";
      const { escaped, preserve } = escapeTextForPptx(p.text);

      return `      <a:p>
        <a:pPr algn="${align}"${p.isBullet ? ' marL="342900" indent="-342900"' : ""}>${bulletXml}</a:pPr>
        <a:r>
          <a:rPr lang="en-US" sz="${sz}"${bold}${italic} dirty="0">
            <a:solidFill><a:srgbClr val="${colorHex}"/></a:solidFill>
            <a:latin typeface="${escapeXml(font)}"/>
          </a:rPr>
          <a:t${preserve ? ' xml:space="preserve"' : ""}>${escaped}</a:t>
        </a:r>
      </a:p>`;
    })
    .join("\n");
}
