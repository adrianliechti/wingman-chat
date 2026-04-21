/**
 * Hybrid PPTX export: pixel-perfect rasterized background + editable text overlay.
 *
 * Each slide gets a full-resolution JPEG background image (preserving all
 * visual design — gradients, images, charts, shapes) with transparent,
 * editable text boxes layered on top. Text is searchable and editable in
 * PowerPoint while the visual design stays pixel-perfect.
 *
 * No LLM needed — fast, deterministic export.
 */

import { downloadFromUrl } from "@/shared/lib/utils";
import { renderSlideToJpegDataUrl } from "./html-slide-export";
import {
  parseSlideHtml,
  type ParsedElement,
  type ParsedParagraph,
  type ParsedSlide,
} from "./pptx-static-parser";

// ── Constants ───────────────────────────────────────────────────────────────

const SLIDE_CX = 9144000; // 10" in EMU
const SLIDE_CY = 5143500; // 5.625" in EMU
const EMU_PER_PX = SLIDE_CX / 1920;

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

  // Process each slide: rasterize background + extract text
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
  addBoilerplate(zip, slideCount);

  let mediaCounter = 0;

  for (let i = 0; i < slideCount; i++) {
    const { jpeg, parsed } = slideData[i];
    const slideNum = i + 1;

    // Add background image
    mediaCounter++;
    const bgMediaName = `media${mediaCounter}.jpeg`;
    zip.file(`ppt/media/${bgMediaName}`, jpeg.split(",")[1], { base64: true });

    // Collect image elements as separate editable objects
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

    // Build slide XML with background + images + text overlays
    const textElements = parsed.elements.filter((el) => el.type === "text");
    const slideXml = buildHybridSlideXml(slideNum, textElements, imageElements, imageMedia);
    zip.file(`ppt/slides/slide${slideNum}.xml`, slideXml);

    // Build slide rels
    const rels = [
      `  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`,
      `  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${bgMediaName}"/>`,
      ...imageMedia.map((m) =>
        `  <Relationship Id="${m.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${m.mediaPath}"/>`
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

function buildHybridSlideXml(
  slideNum: number,
  textElements: ParsedElement[],
  imageElements: ParsedElement[] = [],
  imageMedia: { rId: string; mediaPath: string }[] = [],
): string {
  const shapes: string[] = [];
  let nextId = 3; // 1 = group, 2 = background image

  // Background image — full-slide, behind everything
  shapes.push(`    <p:pic>
      <p:nvPicPr><p:cNvPr id="2" name="Background"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
      <p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
      <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${SLIDE_CX}" cy="${SLIDE_CY}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
    </p:pic>`);

  // Editable image objects on top of background
  for (let imgIdx = 0; imgIdx < imageElements.length; imgIdx++) {
    const img = imageElements[imgIdx];
    const media = imageMedia[imgIdx];
    if (!media) continue;
    const id = nextId++;
    const x = pxToEmu(img.x);
    const y = pxToEmu(img.y);
    const cx = pxToEmu(img.w);
    const cy = pxToEmu(img.h);

    shapes.push(`    <p:pic>
      <p:nvPicPr><p:cNvPr id="${id}" name="Image ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
      <p:blipFill><a:blip r:embed="${media.rId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
      <p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
    </p:pic>`);
  }

  // Editable text boxes on top
  for (const el of textElements) {
    if (!el.paragraphs?.length) continue;
    const id = nextId++;
    const x = pxToEmu(el.x);
    const y = pxToEmu(el.y);
    const cx = pxToEmu(el.w);
    const cy = pxToEmu(el.h);

    const parasXml = buildParagraphsXml(el.paragraphs, el);

    shapes.push(`    <p:sp>
      <p:nvSpPr><p:cNvPr id="${id}" name="TextBox ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        <a:noFill/>
        <a:ln><a:noFill/></a:ln>
      </p:spPr>
      <p:txBody>
        <a:bodyPr wrap="square" rtlCol="0" anchor="t" lIns="0" tIns="0" rIns="0" bIns="0"/>
        <a:lstStyle/>
${parasXml}
      </p:txBody>
    </p:sp>`);
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
${shapes.join("\n")}
    </p:spTree>
  </p:cSld>
</p:sld>`;
}

function buildParagraphsXml(
  paragraphs: ParsedParagraph[],
  parent: ParsedElement,
): string {
  return paragraphs
    .map((p) => {
      const sz = fontSizeToPptx(p.fontSize || parent.fontSize || 16);
      const bold = isBold(p.fontWeight || parent.fontWeight) ? ' b="1"' : "";
      const italic = (p.fontStyle || parent.fontStyle) === "italic" ? ' i="1"' : "";
      const colorHex = cssColorToHex(p.color || parent.color || "rgb(0,0,0)");
      const font = p.fontFamily || parent.fontFamily || "Calibri";
      const align = alignmentToPptx(p.textAlign || parent.textAlign);

      let bulletXml = "";
      if (p.isBullet) {
        bulletXml = `<a:buFont typeface="Arial"/><a:buChar char="&#x2022;"/>`;
      }

      // Handle text with smart quotes
      const escapedText = escapeXml(p.text)
        .replace(/\u201C/g, "&#x201C;")
        .replace(/\u201D/g, "&#x201D;")
        .replace(/\u2018/g, "&#x2018;")
        .replace(/\u2019/g, "&#x2019;");

      const needsPreserve = p.text.startsWith(" ") || p.text.endsWith(" ");

      return `      <a:p>
        <a:pPr algn="${align}"${p.isBullet ? ' marL="342900" indent="-342900"' : ""}>${bulletXml}</a:pPr>
        <a:r>
          <a:rPr lang="en-US" sz="${sz}"${bold}${italic} dirty="0">
            <a:solidFill><a:srgbClr val="${colorHex}"/></a:solidFill>
            <a:latin typeface="${escapeXml(font)}"/>
          </a:rPr>
          <a:t${needsPreserve ? ' xml:space="preserve"' : ""}>${escapedText}</a:t>
        </a:r>
      </a:p>`;
    })
    .join("\n");
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function pxToEmu(px: number): number {
  return Math.round(px * EMU_PER_PX);
}

function cssColorToHex(color: string): string {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    const r = parseInt(match[1], 10).toString(16).padStart(2, "0");
    const g = parseInt(match[2], 10).toString(16).padStart(2, "0");
    const b = parseInt(match[3], 10).toString(16).padStart(2, "0");
    return `${r}${g}${b}`.toUpperCase();
  }
  if (color.startsWith("#")) return color.slice(1).padEnd(6, "0").toUpperCase();
  return "000000";
}

// Slide is 720pt wide (10" × 72pt) across CANVAS_W=1920px → 0.375 pt per CSS px.
// PPTX `sz` is in hundredths of a point, so multiply by 100.
const PT_PER_PX = (SLIDE_CX / 914400) * 72 / 1920; // = 0.375
function fontSizeToPptx(px: number): number {
  return Math.round(px * PT_PER_PX * 100);
}

function isBold(weight: string | undefined): boolean {
  if (!weight) return false;
  return weight === "bold" || weight === "bolder" || parseInt(weight, 10) >= 700;
}

function alignmentToPptx(align: string | undefined): string {
  switch (align) {
    case "center":
      return "ctr";
    case "right":
      return "r";
    case "justify":
      return "just";
    default:
      return "l";
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── PPTX boilerplate ────────────────────────────────────────────────────────

function addBoilerplate(zip: import("jszip"), slideCount: number): void {
  const slideOverrides = Array.from(
    { length: slideCount },
    (_, i) =>
      `  <Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
  ).join("\n");

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
${slideOverrides}
</Types>`,
  );

  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
  );

  const slideIds = Array.from(
    { length: slideCount },
    (_, i) => `    <p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`,
  ).join("\n");

  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>
${slideIds}
  </p:sldIdLst>
  <p:sldSz cx="${SLIDE_CX}" cy="${SLIDE_CY}"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`,
  );

  const slideRels = Array.from(
    { length: slideCount },
    (_, i) =>
      `  <Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`,
  ).join("\n");

  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
${slideRels}
  <Relationship Id="rId${slideCount + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>`,
  );

  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>`,
  );

  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`,
  );

  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank">
  <p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
</p:sldLayout>`,
  );

  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`,
  );

  zip.file(
    "ppt/theme/theme1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Default">
  <a:themeElements>
    <a:clrScheme name="Default"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
    <a:fontScheme name="Default"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
    <a:fmtScheme name="Default"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
  </a:themeElements>
</a:theme>`,
  );
}
