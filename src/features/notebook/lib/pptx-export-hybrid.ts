/**
 * Hybrid PPTX export: pixel-perfect rasterized background + editable overlays.
 *
 * Each slide gets:
 * 1. A full-resolution JPEG background (all visual design preserved)
 * 2. Editable images (movable/replaceable in PowerPoint)
 * 3. Editable text boxes (searchable, editable with formatting)
 *
 * Decorative shapes are left in the background raster — re-emitting them as
 * solid-fill PPTX rectangles drops alpha, gradients, shadows, and transforms,
 * which visibly degrades the design.
 *
 * No LLM needed — fast, deterministic export.
 */

import { downloadFromUrl } from "@/shared/lib/utils";
import { renderSlideToJpegDataUrl } from "./html-slide-export";
import { type ParsedElement, type ParsedParagraph, type ParsedSlide, parseSlideHtml } from "./pptx-static-parser";
import {
  addPptxBoilerplate,
  alignmentToPptx,
  cssColorToHex,
  escapeTextForPptx,
  escapeXml,
  fontSizeToPptx,
  isBold,
  pxToEmu,
  SLIDE_CX,
  SLIDE_CY,
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
      const imageData = img.imageData;
      if (!imageData) continue;
      const ext = imageData.startsWith("data:image/jpeg") ? "jpeg" : "png";
      const mediaName = `media${mediaCounter}.${ext}`;
      const base64 = imageData.split(",")[1];
      if (base64) {
        zip.file(`ppt/media/${mediaName}`, base64, { base64: true });
        imageMedia.push({ rId: `rId${3 + imageMedia.length}`, mediaPath: mediaName });
      }
    }

    // Build slide XML
    const textElements = parsed.elements.filter((el) => el.type === "text");
    const slideXml = buildSlideXml(textElements, imageElements, imageMedia);
    zip.file(`ppt/slides/slide${slideNum}.xml`, slideXml);

    // Build slide rels
    const rels = [
      `  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`,
      `  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${bgMediaName}"/>`,
      ...imageMedia.map(
        (m) =>
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

  // Layer 2: Editable images
  for (let imgIdx = 0; imgIdx < imageElements.length; imgIdx++) {
    const img = imageElements[imgIdx];
    const media = imageMedia[imgIdx];
    if (!media) continue;
    const id = nextId++;

    // Fit the source image into the rect according to CSS `object-fit`.
    // PPTX stretches the full source image to fill the placement rect, so
    // without correction any rect whose aspect ratio differs from the
    // image's natural aspect ratio will visibly distort the picture.
    const fit = fitImageToRect(img);

    parts.push(`    <p:pic>
      <p:nvPicPr><p:cNvPr id="${id}" name="Image ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
      <p:blipFill><a:blip r:embed="${media.rId}"/>${fit.srcRect}<a:stretch><a:fillRect/></a:stretch></p:blipFill>
      <p:spPr><a:xfrm><a:off x="${pxToEmu(fit.x)}" y="${pxToEmu(fit.y)}"/><a:ext cx="${pxToEmu(fit.w)}" cy="${pxToEmu(fit.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
    </p:pic>`);
  }

  // Layer 3: Editable text boxes
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

/**
 * Fit the source image into its CSS rect according to `object-fit`, returning
 * both the adjusted PPTX placement rect and an optional `<a:srcRect>` crop.
 *
 * PPTX has no direct equivalent of CSS `object-fit`; it always stretches the
 * source to fill the placement rect. To reproduce the browser's rendering:
 *
 *   - `cover`: keep the rect, crop the source with `<a:srcRect>` so the
 *     visible portion has the rect's aspect ratio.
 *   - `contain` / `scale-down`: shrink the placement rect to match the
 *     natural aspect, centered inside the original rect.
 *   - `fill` / unknown: leave as-is (stretch to rect).
 *
 * `object-position` is assumed to be center (the CSS default).
 */
function fitImageToRect(img: ParsedElement): {
  x: number;
  y: number;
  w: number;
  h: number;
  srcRect: string;
} {
  const { x, y, w, h, naturalW, naturalH, objectFit } = img;
  const base = { x, y, w, h, srcRect: "" };
  if (!naturalW || !naturalH || w <= 0 || h <= 0) return base;

  const rectAR = w / h;
  const imgAR = naturalW / naturalH;
  // Treat near-equal aspect ratios as identical (≤0.5% difference).
  if (Math.abs(rectAR - imgAR) / Math.max(rectAR, imgAR) < 0.005) return base;

  const fit = objectFit || "fill";

  if (fit === "cover") {
    // <a:srcRect l/t/r/b> values are in 1/1000 of a percent (50% = 50000).
    let lPct = 0,
      tPct = 0,
      rPct = 0,
      bPct = 0;
    if (rectAR > imgAR) {
      // Rect wider than source → scale to width, crop top/bottom.
      const cropFrac = (1 - imgAR / rectAR) / 2;
      tPct = Math.round(cropFrac * 100000);
      bPct = tPct;
    } else {
      // Rect taller than source → scale to height, crop left/right.
      const cropFrac = (1 - rectAR / imgAR) / 2;
      lPct = Math.round(cropFrac * 100000);
      rPct = lPct;
    }
    return { ...base, srcRect: `<a:srcRect l="${lPct}" t="${tPct}" r="${rPct}" b="${bPct}"/>` };
  }

  if (fit === "contain" || fit === "scale-down") {
    // Fit the natural image inside the rect, preserving aspect ratio.
    let vw = w,
      vh = h;
    if (rectAR > imgAR) {
      vw = h * imgAR;
    } else {
      vh = w / imgAR;
    }
    return {
      x: x + (w - vw) / 2,
      y: y + (h - vh) / 2,
      w: vw,
      h: vh,
      srcRect: "",
    };
  }

  // `fill` (default), `none`, or unknown → stretch to rect.
  return base;
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
