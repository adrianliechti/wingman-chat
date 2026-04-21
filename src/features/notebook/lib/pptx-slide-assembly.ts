/**
 * Assemble an in-memory filesystem of PPTX slide XML + media into a
 * downloadable .pptx ZIP file.
 *
 * The LLM writes `<p:sld>` documents into `slides/slide1.xml`, etc., and
 * stores images/charts in the media registry. This module:
 *
 * 1. Sorts slides numerically
 * 2. Resolves `r:embed="img_<name>"` tokens → real relationship IDs
 * 3. Builds per-slide `.rels` files
 * 4. Adds PPTX boilerplate (presentation, theme, layouts, content types)
 * 5. Produces a PPTX blob
 */

import { downloadFromUrl } from "@/shared/lib/utils";

// ── Constants ───────────────────────────────────────────────────────────────

const SLIDE_CX = 9144000; // 10" in EMU
const SLIDE_CY = 5143500; // 5.625" in EMU

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Get ordered slide XML entries from the filesystem.
 * Filters for `slides/slide\d+.xml`, sorts numerically.
 */
export function getOrderedPptxSlides(fs: Map<string, string>): string[] {
  return [...fs.entries()]
    .filter(([name]) => /^slides\/slide\d+\.xml$/i.test(name))
    .sort(([a], [b]) => {
      const numA = parseInt(a.match(/\d+/)?.[0] || "0", 10);
      const numB = parseInt(b.match(/\d+/)?.[0] || "0", 10);
      return numA - numB;
    })
    .map(([, content]) => content);
}

/**
 * Assemble and download a PPTX file from the in-memory filesystem.
 *
 * @param fs     In-memory filesystem with `slides/slide*.xml` and `media/*`
 * @param media  Media registry: filename (e.g. `hero.png`) → data URL
 * @param slug   Base name for the download
 */
export async function downloadPptxFromFs(
  fs: Map<string, string>,
  media: Map<string, string>,
  slug: string,
): Promise<void> {
  const blob = await assemblePptx(fs, media);
  const url = URL.createObjectURL(blob);
  downloadFromUrl(url, `${slug}.pptx`);
  URL.revokeObjectURL(url);
}

/**
 * Assemble a PPTX blob from the filesystem and media registry.
 */
export async function assemblePptx(
  fs: Map<string, string>,
  media: Map<string, string>,
): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  const slideXmls = getOrderedPptxSlides(fs);
  const slideCount = slideXmls.length;

  if (slideCount === 0) {
    throw new Error("No slides to assemble");
  }

  // ── Collect all media referenced across slides ────────────────────────
  // Track which media files are actually used so we only include what's needed
  const usedMedia = new Map<string, { zipPath: string; ext: string }>();
  let mediaIndex = 0;

  // Process each slide: resolve img_* refs and build rels
  const resolvedSlides: string[] = [];

  for (let si = 0; si < slideCount; si++) {
    let slideXml = slideXmls[si];

    // Find all img_* references in this slide
    const imgRefs = [...slideXml.matchAll(/r:embed="img_([^"]+)"/g)];
    const slideRels: { rId: string; type: string; target: string }[] = [
      {
        rId: "rId1",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout",
        target: "../slideLayouts/slideLayout1.xml",
      },
    ];

    let nextRId = 2;
    for (const match of imgRefs) {
      const imgName = match[1]; // e.g. "hero"
      const token = `img_${imgName}`;

      // Find the media file (try common extensions)
      let mediaFile: string | null = null;
      let dataUrl: string | null = null;

      for (const ext of ["png", "jpeg", "jpg", "webp"]) {
        const candidate = `${imgName}.${ext}`;
        if (media.has(candidate)) {
          mediaFile = candidate;
          dataUrl = media.get(candidate)!;
          break;
        }
      }

      if (!mediaFile || !dataUrl) {
        console.warn(`[PPTX Assembly] No media found for ref "${token}"`);
        continue;
      }

      // Ensure this media is in the ZIP (dedup across slides)
      if (!usedMedia.has(mediaFile)) {
        mediaIndex++;
        const ext = mediaFile.split(".").pop() || "png";
        const zipPath = `ppt/media/media${mediaIndex}.${ext}`;
        usedMedia.set(mediaFile, { zipPath, ext });

        // Write media to ZIP
        const base64 = dataUrl.split(",")[1];
        if (base64) {
          zip.file(zipPath, base64, { base64: true });
        }
      }

      const entry = usedMedia.get(mediaFile)!;
      const rId = `rId${nextRId++}`;

      // Replace the token in the XML
      slideXml = slideXml.replaceAll(`r:embed="${token}"`, `r:embed="${rId}"`);

      slideRels.push({
        rId,
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
        target: `../${entry.zipPath.replace("ppt/", "")}`,
      });
    }

    resolvedSlides.push(slideXml);

    // Write slide XML
    zip.file(`ppt/slides/slide${si + 1}.xml`, slideXml);

    // Write slide rels
    const relsXml = buildSlideRels(slideRels);
    zip.file(`ppt/slides/_rels/slide${si + 1}.xml.rels`, relsXml);
  }

  // ── Boilerplate ───────────────────────────────────────────────────────
  addBoilerplate(zip, slideCount);

  return zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
}

// ── XML builders ────────────────────────────────────────────────────────────

function buildSlideRels(
  rels: { rId: string; type: string; target: string }[],
): string {
  const entries = rels
    .map(
      (r) =>
        `  <Relationship Id="${r.rId}" Type="${r.type}" Target="${r.target}"/>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${entries}
</Relationships>`;
}

function addBoilerplate(zip: import("jszip"), slideCount: number): void {
  // [Content_Types].xml
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
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
${slideOverrides}
</Types>`,
  );

  // _rels/.rels
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
  );

  // ppt/presentation.xml
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

  // ppt/_rels/presentation.xml.rels
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

  // Slide master
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

  // Slide layout
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

  // Theme
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
