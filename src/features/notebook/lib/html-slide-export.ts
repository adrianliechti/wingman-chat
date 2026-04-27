/**
 * Export HTML slides as PDF, PNG, or image-based PPTX.
 *
 * Slides are rasterized via a layered approach:
 * 1. Mount in an isolated off-screen iframe for real CSS layout
 * 2. Extract data-URL images (which break inside SVG foreignObject)
 * 3. Render text/shapes via SVG foreignObject with transparent background
 * 4. Composite: background fill → images → foreignObject layer
 *
 * Editable PPTX export is handled by pptx-export-hybrid.ts.
 */

import { downloadFromUrl } from "@/shared/lib/utils";
import { addPptxBoilerplate, CANVAS_H, CANVAS_W, SLIDE_CX, SLIDE_CY } from "./pptx-utils";

/** Export rasterization scale — 2× gives ~3840×2160 output, crisp on 4K */
const RASTER_SCALE = 2;

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
async function mountSlide(html: string): Promise<{ iframe: HTMLIFrameElement; doc: Document; teardown: () => void }> {
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
 * Compute source and destination rects for `ctx.drawImage` that reproduce
 * CSS `object-fit` + `object-position` when blitting an image into a box.
 *
 * Without this the canvas composite would stretch every image to fill the
 * element's bounding rect, destroying the aspect ratio that `object-fit:
 * cover` / `contain` establish in the live DOM.
 */
function computeObjectFitDraw(
  naturalW: number,
  naturalH: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  fit: string | undefined,
  position: string | undefined,
): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } {
  const full = { sx: 0, sy: 0, sw: naturalW, sh: naturalH, dx, dy, dw, dh };
  if (!naturalW || !naturalH || dw <= 0 || dh <= 0) return full;

  // `none` would render at natural size, centered. Slide layouts never use
  // this, and `scale-down` + small images are rare, so collapse both to
  // `contain` for simplicity (it's the visually safer default).
  const mode = fit === "none" || fit === "scale-down" ? "contain" : fit || "fill";

  // Parse `object-position` — accept percentages or keywords. Default 50% 50%.
  const pos = parsePosition(position);

  const rectAR = dw / dh;
  const imgAR = naturalW / naturalH;

  if (mode === "cover") {
    // Scale the image to cover the rect, cropping the overflow axis.
    let sw = naturalW;
    let sh = naturalH;
    if (rectAR > imgAR) {
      sh = naturalW / rectAR;
    } else {
      sw = naturalH * rectAR;
    }
    const sx = (naturalW - sw) * pos.x;
    const sy = (naturalH - sh) * pos.y;
    return { sx, sy, sw, sh, dx, dy, dw, dh };
  }

  if (mode === "contain") {
    // Fit the image inside the rect, letterboxing the overflow axis.
    let vw = dw;
    let vh = dh;
    if (rectAR > imgAR) {
      vw = dh * imgAR;
    } else {
      vh = dw / imgAR;
    }
    return {
      sx: 0,
      sy: 0,
      sw: naturalW,
      sh: naturalH,
      dx: dx + (dw - vw) * pos.x,
      dy: dy + (dh - vh) * pos.y,
      dw: vw,
      dh: vh,
    };
  }

  // `fill` (CSS default) or unknown → stretch.
  return full;
}

// ── Slide background detection ───────────────────────────────────────────────
//
// Backgrounds need to be painted directly onto the canvas (Layer 1) rather
// than relying on the foreignObject. CSS gradients and CSS variables don't
// render reliably inside an SVG-loaded-as-img on every browser, which is what
// produced "white-only" exports for slides whose background was a gradient.

interface ParsedLinearGradient {
  angle: number;
  stops: { color: string; offset: number }[];
}

interface SlideBackground {
  color?: string;
  gradient?: ParsedLinearGradient;
}

/** Split a CSS value on top-level commas (respecting parentheses). */
function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const KEYWORD_ANGLES: Record<string, number> = {
  top: 0,
  right: 90,
  bottom: 180,
  left: 270,
  "top right": 45,
  "right top": 45,
  "bottom right": 135,
  "right bottom": 135,
  "bottom left": 225,
  "left bottom": 225,
  "top left": 315,
  "left top": 315,
};

function parseGradientAngle(spec: string): number | null {
  // Strip CSS Color 4 / Tailwind v4 colorspace prefix: "in oklch", "in srgb"…
  const cleaned = spec.toLowerCase().trim().replace(/^in\s+\S+(?:\s+\S+)?\s+/, "");
  if (cleaned.startsWith("to ")) {
    const dir = cleaned.slice(3).trim().replace(/\s+/g, " ");
    return KEYWORD_ANGLES[dir] ?? null;
  }
  const m = /^(-?\d+(?:\.\d+)?)\s*(deg|rad|turn|grad)$/.exec(cleaned);
  if (!m) return null;
  const v = parseFloat(m[1]);
  switch (m[2]) {
    case "rad":
      return (v * 180) / Math.PI;
    case "turn":
      return v * 360;
    case "grad":
      return v * 0.9;
    default:
      return v;
  }
}

/** Pull a single color expression off the front of a stop token. */
function parseColorStop(token: string): { color: string; offset?: number } | null {
  const t = token.trim();
  if (!t) return null;
  let i = 0;
  if (t.startsWith("#")) {
    while (i < t.length && !/\s/.test(t[i])) i++;
  } else if (/^[a-z]+\(/i.test(t)) {
    let depth = 0;
    for (; i < t.length; i++) {
      if (t[i] === "(") depth++;
      else if (t[i] === ")") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
  } else {
    while (i < t.length && !/\s/.test(t[i])) i++;
  }
  const color = t.slice(0, i).trim();
  if (!color) return null;
  const rest = t.slice(i).trim();
  const m = /^(-?\d+(?:\.\d+)?)\s*%/.exec(rest);
  if (m) return { color, offset: parseFloat(m[1]) / 100 };
  return { color };
}

function parseLinearGradient(layer: string): ParsedLinearGradient | null {
  const m = /^linear-gradient\(\s*([\s\S]+?)\s*\)\s*$/i.exec(layer.trim());
  if (!m) return null;
  const tokens = splitTopLevelCommas(m[1]);
  if (tokens.length < 2) return null;

  let angle = 180;
  let startIdx = 0;
  const angleFromFirst = parseGradientAngle(tokens[0]);
  if (angleFromFirst !== null) {
    angle = angleFromFirst;
    startIdx = 1;
  }

  const parsed: { color: string; offset?: number }[] = [];
  for (const tok of tokens.slice(startIdx)) {
    const s = parseColorStop(tok);
    if (s) parsed.push(s);
  }
  if (parsed.length < 2) return null;

  // Distribute missing offsets per CSS spec.
  if (parsed[0].offset === undefined) parsed[0].offset = 0;
  if (parsed[parsed.length - 1].offset === undefined) parsed[parsed.length - 1].offset = 1;
  let i = 1;
  while (i < parsed.length - 1) {
    if (parsed[i].offset !== undefined) {
      i++;
      continue;
    }
    let j = i;
    while (j < parsed.length && parsed[j].offset === undefined) j++;
    const prev = parsed[i - 1].offset as number;
    const next = parsed[j].offset as number;
    const span = j - (i - 1);
    for (let k = 0; k < j - i; k++) {
      parsed[i + k].offset = prev + ((next - prev) * (k + 1)) / span;
    }
    i = j;
  }
  // Clamp to monotonic.
  for (let k = 1; k < parsed.length; k++) {
    if ((parsed[k].offset as number) < (parsed[k - 1].offset as number)) {
      parsed[k].offset = parsed[k - 1].offset;
    }
  }

  return {
    angle,
    stops: parsed.map((p) => ({ color: p.color, offset: Math.max(0, Math.min(1, p.offset as number)) })),
  };
}

function applyLinearGradient(ctx: CanvasRenderingContext2D, g: ParsedLinearGradient, w: number, h: number) {
  const rad = (g.angle * Math.PI) / 180;
  const sx = Math.sin(rad);
  const sy = -Math.cos(rad);
  const cx = w / 2;
  const cy = h / 2;
  const len = Math.abs(w * sx) + Math.abs(h * sy);
  const half = len / 2;
  const grad = ctx.createLinearGradient(cx - sx * half, cy - sy * half, cx + sx * half, cy + sy * half);
  for (const s of g.stops) {
    try {
      grad.addColorStop(s.offset, s.color);
    } catch {
      /* invalid color string — skip this stop */
    }
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

/** Find every element that spans (close to) the full slide. */
function collectFullSlideElements(doc: Document): HTMLElement[] {
  const out: HTMLElement[] = [];
  const seen = new Set<Element>();
  const minW = CANVAS_W * 0.9;
  const minH = CANVAS_H * 0.9;
  const visit = (el: Element, depth: number) => {
    if (seen.has(el)) return;
    seen.add(el);
    const html = el as HTMLElement;
    if (html.getBoundingClientRect) {
      const rect = html.getBoundingClientRect();
      if (rect.width >= minW && rect.height >= minH) out.push(html);
    }
    if (depth >= 4) return;
    for (const child of Array.from(el.children)) visit(child, depth + 1);
  };
  visit(doc.documentElement, 0);
  return out;
}

function detectSlideBackground(win: Window, candidates: HTMLElement[]): SlideBackground | null {
  for (const el of candidates) {
    const cs = win.getComputedStyle(el);
    const bgImage = cs.backgroundImage;
    if (bgImage && bgImage !== "none") {
      for (const layer of splitTopLevelCommas(bgImage)) {
        const grad = parseLinearGradient(layer);
        if (grad) return { gradient: grad };
      }
    }
    const bgColor = cs.backgroundColor;
    if (bgColor && bgColor !== "rgba(0, 0, 0, 0)" && bgColor !== "transparent") {
      return { color: bgColor };
    }
  }
  return null;
}

/** Parse `object-position` / `background-position` into 0–1 fractions (center default). */
function parsePosition(value: string | undefined): { x: number; y: number } {
  if (!value) return { x: 0.5, y: 0.5 };
  const parts = value.trim().split(/\s+/);
  const parse = (token: string | undefined, fallback: number): number => {
    if (!token) return fallback;
    if (token === "left" || token === "top") return 0;
    if (token === "right" || token === "bottom") return 1;
    if (token === "center") return 0.5;
    const pct = /^(-?\d+(?:\.\d+)?)%$/.exec(token);
    if (pct) return Math.max(0, Math.min(1, parseFloat(pct[1]) / 100));
    return fallback;
  };
  return { x: parse(parts[0], 0.5), y: parse(parts[1], 0.5) };
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
  options: { hideText?: boolean } = {},
): Promise<HTMLCanvasElement> {
  const doc = iframe.contentDocument;
  if (!doc?.documentElement) throw new Error("Slide iframe has no document");
  const win = iframe.contentWindow;
  if (!win) throw new Error("Slide iframe has no window");

  // ── Optionally hide all text (used by hybrid PPTX export so the
  //    rasterized background doesn't double-render text that's also
  //    drawn as an editable overlay). We inject a stylesheet rather
  //    than mutate every element so layout stays identical.
  let hideTextStyle: HTMLStyleElement | null = null;
  if (options.hideText) {
    hideTextStyle = doc.createElement("style");
    hideTextStyle.textContent = `
      * {
        color: transparent !important;
        text-shadow: none !important;
        -webkit-text-fill-color: transparent !important;
        text-decoration-color: transparent !important;
        caret-color: transparent !important;
      }
    `;
    doc.head.appendChild(hideTextStyle);
  }

  // ── Collect the slide background (color or gradient) ─────────────────
  const fullSlideEls = collectFullSlideElements(doc);
  const slideBg = detectSlideBackground(win, fullSlideEls);

  // ── Collect images and hide them ──────────────────────────────────────
  interface ImageOverlay {
    dataUrl: string;
    x: number;
    y: number;
    w: number;
    h: number;
    opacity: number;
    /** Natural pixel dimensions of the source image — used for object-fit math. */
    naturalW?: number;
    naturalH?: number;
    /** CSS `object-fit` (`cover`, `contain`, `fill`, …). Absent for background-image overlays. */
    objectFit?: string;
    /** CSS `object-position`, e.g. "50% 50%". Absent for background-image overlays. */
    objectPosition?: string;
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
      const style = win.getComputedStyle(img);
      overlays.push({
        dataUrl,
        x: rect.left,
        y: rect.top,
        w: rect.width,
        h: rect.height,
        opacity: parseFloat(style.opacity) || 1,
        naturalW: img.naturalWidth || undefined,
        naturalH: img.naturalHeight || undefined,
        objectFit: style.objectFit || undefined,
        objectPosition: style.objectPosition || undefined,
      });
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
    if (!bg?.includes("data:image")) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;

    const match = bg.match(/url\(["']?(data:[^"')]+)["']?\)/);
    if (match) {
      // Map `background-size` to the equivalent `object-fit` so compositing
      // preserves aspect ratio for cover/contain backgrounds too.
      const bgSize = computed.backgroundSize;
      let objectFit: string | undefined;
      if (bgSize === "cover") objectFit = "cover";
      else if (bgSize === "contain") objectFit = "contain";
      overlays.push({
        dataUrl: match[1],
        x: rect.left,
        y: rect.top,
        w: rect.width,
        h: rect.height,
        opacity: parseFloat(computed.opacity) || 1,
        objectFit,
        objectPosition: computed.backgroundPosition || undefined,
      });
      savedBgEls.push({ el, orig: el.style.backgroundImage });
      el.style.backgroundImage = "none";
    }
  }

  // ── Make full-slide backgrounds transparent ───────────────────────────
  // The canvas paints these explicitly (Layer 1 below), so the foreignObject
  // must not double-render them — clear both the color and the image (which
  // is where gradients live) on every element that spans the whole slide.
  const savedFullBgs: { el: HTMLElement; color: string; image: string }[] = [];
  for (const el of fullSlideEls) {
    const cs = win.getComputedStyle(el);
    const hasColor =
      cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent";
    const hasImage = cs.backgroundImage && cs.backgroundImage !== "none";
    if (!hasColor && !hasImage) continue;
    savedFullBgs.push({ el, color: el.style.backgroundColor, image: el.style.backgroundImage });
    if (hasColor) el.style.backgroundColor = "transparent";
    if (hasImage) el.style.backgroundImage = "none";
  }

  // ── Render layout via SVG foreignObject ───────────────────────────────
  doc.documentElement.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  const xhtml = new XMLSerializer().serializeToString(doc.documentElement);

  // Restore backgrounds
  for (const { el, color, image } of savedFullBgs) {
    el.style.backgroundColor = color;
    el.style.backgroundImage = image;
  }

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

  // Layer 1: slide background (gradient or solid color, white fallback)
  if (slideBg?.gradient) {
    applyLinearGradient(ctx, slideBg.gradient, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = slideBg?.color ?? "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Layer 2: images (drawn on top of background, behind text/shapes)
  for (const info of overlays) {
    const overlayImg = new Image();
    await new Promise<void>((resolve) => {
      overlayImg.onload = () => resolve();
      overlayImg.onerror = () => resolve();
      overlayImg.src = info.dataUrl;
    });
    if (overlayImg.naturalWidth > 0) {
      const natW = info.naturalW ?? overlayImg.naturalWidth;
      const natH = info.naturalH ?? overlayImg.naturalHeight;
      const draw = computeObjectFitDraw(
        natW,
        natH,
        info.x * RASTER_SCALE,
        info.y * RASTER_SCALE,
        info.w * RASTER_SCALE,
        info.h * RASTER_SCALE,
        info.objectFit,
        info.objectPosition,
      );
      ctx.globalAlpha = info.opacity;
      ctx.drawImage(overlayImg, draw.sx, draw.sy, draw.sw, draw.sh, draw.dx, draw.dy, draw.dw, draw.dh);
      ctx.globalAlpha = 1;
    }
    overlayImg.src = ""; // release data URL reference
  }

  // Layer 3: foreignObject (text, shapes — transparent background)
  ctx.drawImage(svgImg, 0, 0, canvas.width, canvas.height);
  svgImg.src = ""; // release SVG data URL reference

  // Restore hidden elements
  for (const { el, vis } of savedImgVis) el.style.visibility = vis;
  for (const { el, orig } of savedBgEls) el.style.backgroundImage = orig;
  if (hideTextStyle?.parentNode) hideTextStyle.parentNode.removeChild(hideTextStyle);

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
 *
 * `hideText` suppresses all rendered text in the rasterization, which is
 * used by the hybrid PPTX export to avoid rendering text into the
 * background image (since it's also drawn as an editable overlay).
 */
export async function renderSlideToJpegDataUrl(html: string, options: { hideText?: boolean } = {}): Promise<string> {
  const { iframe, teardown } = await mountSlide(html);
  try {
    const canvas = await rasterizeSlideDoc(iframe, options);
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

    zip.file(`ppt/slides/slide${i + 1}.xml`, slideXmlWithImage());
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

function slideXmlWithImage(): string {
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
