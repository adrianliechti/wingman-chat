/**
 * Export HTML slides as PDF, PNG, or image-based PPTX.
 *
 * Slides are rasterized via a layered approach:
 * 1. Mount in an isolated off-screen iframe for real CSS layout
 * 2. Extract data-URL images (which break inside SVG foreignObject)
 * 3. Render text/shapes via SVG foreignObject with transparent background
 * 4. Composite: background fill → images → foreignObject layer
 *
 * Editable PPTX export is handled by pptx-export-two-pass.ts.
 */

import { downloadFromUrl } from "@/shared/lib/utils";

// ── Constants ────────────────────────────────────────────────────────────────

/** Slide canvas resolution in pixels */
const CANVAS_W = 1920;
const CANVAS_H = 1080;

/** Export rasterization scale — 2× gives ~3840×2160 output, crisp on 4K */
const RASTER_SCALE = 2;

/** Slide dimensions in EMU (914400 EMU = 1 inch) */
const SLIDE_CX = 9144000; // 10"
const SLIDE_CY = 5143500; // 5.625"
/** JPEG quality for exported slide rasters (0–1). 0.85 is visually lossless for slides. */
const JPEG_QUALITY = 0.85;

// ── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Strip anything that would trigger an external network fetch during
 * rasterization or preview. The assembled slide HTML is already fully
 * self-contained (inlined <style> blocks + data-URL images), so a stray
 * <link rel="stylesheet"> or <script> would only cause trouble.
 */
function sanitizeSlideDoc(doc: Document): void {
  doc.querySelectorAll("link, script").forEach((el) => {
    el.remove();
  });
}

/**
 * Mount the slide HTML inside an isolated off-screen iframe at native slide
 * resolution. The iframe gives the slide its own document so its CSS doesn't
 * leak onto the host page, and provides a real layout context.
 */
async function mountSlide(
  html: string,
): Promise<{ iframe: HTMLIFrameElement; doc: Document; teardown: () => void }> {
  // Strip external-network tags from the source HTML before handing it to the
  // iframe, so `srcdoc` never even sees them.
  const parsed = new DOMParser().parseFromString(html, "text/html");
  sanitizeSlideDoc(parsed);
  const srcdoc = `<!doctype html>${parsed.documentElement.outerHTML}`;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("sandbox", "allow-same-origin");
  iframe.style.position = "fixed";
  iframe.style.left = "-100000px";
  iframe.style.top = "0";
  iframe.style.width = `${CANVAS_W}px`;
  iframe.style.height = `${CANVAS_H}px`;
  iframe.style.border = "0";
  iframe.style.pointerEvents = "none";
  iframe.style.visibility = "hidden";
  iframe.srcdoc = srcdoc;

  document.body.appendChild(iframe);

  const teardown = () => {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const onLoad = () => {
        iframe.removeEventListener("load", onLoad);
        resolve();
      };
      const onError = () => {
        iframe.removeEventListener("error", onError);
        reject(new Error("Slide iframe failed to load"));
      };
      iframe.addEventListener("load", onLoad);
      iframe.addEventListener("error", onError);
    });

    const doc = iframe.contentDocument;
    if (!doc?.documentElement) throw new Error("Slide iframe has no document");

    // Force viewport size regardless of what the slide CSS declares.
    doc.documentElement.style.width = `${CANVAS_W}px`;
    doc.documentElement.style.height = `${CANVAS_H}px`;
    if (doc.body) {
      doc.body.style.width = `${CANVAS_W}px`;
      doc.body.style.height = `${CANVAS_H}px`;
      doc.body.style.margin = "0";
    }

    // Wait for every inline <img> to decode.
    const imgs = Array.from(doc.images);
    await Promise.all(
      imgs.map((img) =>
        img.complete && img.naturalWidth > 0
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.addEventListener("load", () => resolve(), { once: true });
              img.addEventListener("error", () => resolve(), { once: true });
            }),
      ),
    );

    // One rAF to let layout settle before we serialize.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    return { iframe, doc, teardown };
  } catch (err) {
    teardown();
    throw err;
  }
}

/**
 * UTF-8-safe base64 encoder. `btoa` can't handle non-Latin1 characters
 * (emoji, typographic punctuation) which are common in slide content.
 */
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * Rasterize a mounted slide into a canvas using a layered approach:
 *
 * Data-URL images inside an SVG foreignObject don't render (Chrome blocks
 * nested data URLs; Safari taints the canvas). To work around this we
 * extract every image from the DOM, render the text/shape layout via
 * foreignObject (with a transparent background), and composite everything
 * in the correct order:
 *
 *   canvas = background fill → images → foreignObject text/shapes
 *
 * The foreignObject layer has a transparent background so images underneath
 * show through, preserving alpha/transparency from PNG sources.
 */
async function rasterizeSlideDoc(
  iframe: HTMLIFrameElement,
): Promise<HTMLCanvasElement> {
  const doc = iframe.contentDocument;
  if (!doc?.documentElement) throw new Error("Slide iframe has no document");
  const win = iframe.contentWindow;
  if (!win) throw new Error("Slide iframe has no window");

  // ── Collect the slide background color ────────────────────────────────
  let bgColor = "#ffffff";
  const bodyBg = win.getComputedStyle(doc.body).backgroundColor;
  if (bodyBg && bodyBg !== "rgba(0, 0, 0, 0)" && bodyBg !== "transparent") {
    bgColor = bodyBg;
  } else {
    const first = doc.body.firstElementChild as HTMLElement | null;
    if (first) {
      const firstBg = win.getComputedStyle(first).backgroundColor;
      if (firstBg && firstBg !== "rgba(0, 0, 0, 0)" && firstBg !== "transparent") {
        bgColor = firstBg;
      }
    }
  }

  // ── Collect images and hide them ──────────────────────────────────────
  interface ImageOverlay {
    dataUrl: string;
    x: number;
    y: number;
    w: number;
    h: number;
    opacity: number;
  }
  const overlays: ImageOverlay[] = [];

  // Collect <img> elements
  const imgEls = Array.from(doc.querySelectorAll("img")) as HTMLImageElement[];
  const savedImgVis: { el: HTMLImageElement; vis: string }[] = [];

  for (const img of imgEls) {
    const rect = img.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;

    let dataUrl: string | null = null;
    if (img.src.startsWith("data:")) {
      dataUrl = img.src;
    } else if (img.complete && img.naturalWidth > 0) {
      try {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const cx = c.getContext("2d");
        if (cx) {
          cx.drawImage(img, 0, 0);
          dataUrl = c.toDataURL("image/png");
        }
      } catch {
        /* cross-origin — skip */
      }
    }

    if (dataUrl) {
      const opacity = parseFloat(win.getComputedStyle(img).opacity) || 1;
      overlays.push({ dataUrl, x: rect.left, y: rect.top, w: rect.width, h: rect.height, opacity });
      savedImgVis.push({ el: img, vis: img.style.visibility });
      img.style.visibility = "hidden";
    }
  }

  // Collect elements with CSS background-image data URLs
  const savedBgEls: { el: HTMLElement; orig: string }[] = [];
  for (const node of doc.querySelectorAll("*")) {
    const el = node as HTMLElement;
    const computed = win.getComputedStyle(el);
    const bg = computed.backgroundImage;
    if (!bg || !bg.includes("data:image")) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;

    const match = bg.match(/url\(["']?(data:[^"')]+)["']?\)/);
    if (match) {
      const opacity = parseFloat(computed.opacity) || 1;
      overlays.push({ dataUrl: match[1], x: rect.left, y: rect.top, w: rect.width, h: rect.height, opacity });
      savedBgEls.push({ el, orig: el.style.backgroundImage });
      el.style.backgroundImage = "none";
    }
  }

  // ── Make full-slide backgrounds transparent ───────────────────────────
  // Only clear backgrounds on elements that span the full slide (body,
  // html, wrapper divs) — leave smaller elements (cards, badges) alone.
  const savedFullBgs: { el: HTMLElement; orig: string }[] = [];
  const bgCandidates = [doc.documentElement, doc.body, ...doc.body.children];
  for (const node of bgCandidates) {
    const el = node as HTMLElement;
    if (!el.getBoundingClientRect) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < CANVAS_W * 0.9 || rect.height < CANVAS_H * 0.9) continue;
    const elBg = win.getComputedStyle(el).backgroundColor;
    if (elBg && elBg !== "rgba(0, 0, 0, 0)" && elBg !== "transparent") {
      savedFullBgs.push({ el, orig: el.style.backgroundColor });
      el.style.backgroundColor = "transparent";
    }
  }

  // ── Render layout via SVG foreignObject ───────────────────────────────
  doc.documentElement.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  const xhtml = new XMLSerializer().serializeToString(doc.documentElement);

  // Restore backgrounds
  for (const { el, orig } of savedFullBgs) el.style.backgroundColor = orig;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}">` +
    `<foreignObject x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}">${xhtml}</foreignObject>` +
    `</svg>`;

  const svgDataUrl = `data:image/svg+xml;base64,${utf8ToBase64(svg)}`;

  const svgImg = new Image();
  svgImg.decoding = "sync";
  await new Promise<void>((resolve, reject) => {
    svgImg.onload = () => resolve();
    svgImg.onerror = (event) => {
      console.error("[slide-export] SVG image failed to load", event);
      reject(new Error("Failed to rasterize slide (SVG img load failed)"));
    };
    svgImg.src = svgDataUrl;
  });

  try {
    await svgImg.decode();
  } catch {
    /* decode() can reject even when the image is usable — not fatal */
  }

  // ── Composite: background → images → text/shapes ─────────────────────
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W * RASTER_SCALE;
  canvas.height = CANVAS_H * RASTER_SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Layer 1: solid background
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Layer 2: images (drawn on top of background, behind text/shapes)
  for (const info of overlays) {
    const overlayImg = new Image();
    await new Promise<void>((resolve) => {
      overlayImg.onload = () => resolve();
      overlayImg.onerror = () => resolve();
      overlayImg.src = info.dataUrl;
    });
    if (overlayImg.naturalWidth > 0) {
      ctx.globalAlpha = info.opacity;
      ctx.drawImage(
        overlayImg,
        info.x * RASTER_SCALE,
        info.y * RASTER_SCALE,
        info.w * RASTER_SCALE,
        info.h * RASTER_SCALE,
      );
      ctx.globalAlpha = 1;
    }
  }

  // Layer 3: foreignObject (text, shapes — transparent background)
  ctx.drawImage(svgImg, 0, 0, canvas.width, canvas.height);

  // Restore hidden elements
  for (const { el, vis } of savedImgVis) el.style.visibility = vis;
  for (const { el, orig } of savedBgEls) el.style.backgroundImage = orig;

  return canvas;
}

/** Render a slide to a PNG data URL at 2× the slide resolution. */
async function renderSlideToPngDataUrl(html: string): Promise<string> {
  const { iframe, teardown } = await mountSlide(html);
  try {
    const canvas = await rasterizeSlideDoc(iframe);
    return canvas.toDataURL("image/png");
  } finally {
    teardown();
  }
}

/**
 * Render a slide to a JPEG data URL at 2× the slide resolution.
 * JPEG is ~10× smaller than PNG for slide-style content and visually
 * lossless at q=0.85.
 */
async function renderSlideToJpegDataUrl(html: string): Promise<string> {
  const { iframe, teardown } = await mountSlide(html);
  try {
    const canvas = await rasterizeSlideDoc(iframe);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } finally {
    teardown();
  }
}


// ── PDF export ───────────────────────────────────────────────────────────────

export async function downloadHtmlSlidesAsPdf(htmlSlides: string[], slug: string) {
  const { jsPDF } = await import("jspdf");

  const w = CANVAS_W * RASTER_SCALE;
  const h = CANVAS_H * RASTER_SCALE;

  const firstJpeg = await renderSlideToJpegDataUrl(htmlSlides[0]);
  const doc = new jsPDF({ orientation: "landscape", unit: "px", format: [w, h] });
  doc.addImage(firstJpeg, "JPEG", 0, 0, w, h);

  for (let i = 1; i < htmlSlides.length; i++) {
    const jpeg = await renderSlideToJpegDataUrl(htmlSlides[i]);
    doc.addPage([w, h], "landscape");
    doc.addImage(jpeg, "JPEG", 0, 0, w, h);
  }

  doc.save(`${slug}.pdf`);
}

// ── PNG export (ZIP) ─────────────────────────────────────────────────────────

export async function downloadHtmlSlidesAsPng(htmlSlides: string[], slug: string) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  for (let i = 0; i < htmlSlides.length; i++) {
    const dataUrl = await renderSlideToPngDataUrl(htmlSlides[i]);
    const base64 = dataUrl.split(",")[1];
    zip.file(`slide-${i + 1}.png`, base64, { base64: true });
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  downloadFromUrl(url, `${slug}-slides.zip`);
  URL.revokeObjectURL(url);
}

// ── Image-based PPTX export ─────────────────────────────────────────────────

export async function downloadHtmlSlidesAsPptx(htmlSlides: string[], slug: string) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const slideCount = htmlSlides.length;

  const images: string[] = [];
  for (const html of htmlSlides) {
    images.push(await renderSlideToJpegDataUrl(html));
  }

  addPptxBoilerplate(zip, slideCount);

  for (let i = 0; i < slideCount; i++) {
    const base64 = images[i].split(",")[1];
    zip.file(`ppt/media/image${i + 1}.jpeg`, base64, { base64: true });

    zip.file(`ppt/slides/slide${i + 1}.xml`, slideXmlWithImage(i + 1));
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, slideRelsWithImage(i + 1));
  }

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
  const url = URL.createObjectURL(blob);
  downloadFromUrl(url, `${slug}.pptx`);
  URL.revokeObjectURL(url);
}

function slideXmlWithImage(n: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    <p:pic>
      <p:nvPicPr><p:cNvPr id="2" name="Slide Image"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
      <p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
      <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${SLIDE_CX}" cy="${SLIDE_CY}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
    </p:pic>
  </p:spTree></p:cSld>
</p:sld>`;
}

function slideRelsWithImage(n: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${n}.jpeg"/>
</Relationships>`;
}

// ── PPTX boilerplate ──────────────────────────────────────────────────

function addPptxBoilerplate(zip: import("jszip"), slideCount: number) {
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
  );

  zip.file("[Content_Types].xml", buildContentTypesWithImages(slideCount));

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

function buildContentTypesWithImages(slideCount: number): string {
  const slideOverrides = Array.from(
    { length: slideCount },
    (_, i) =>
      `  <Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
  ).join("\n");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
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
</Types>`;
}
