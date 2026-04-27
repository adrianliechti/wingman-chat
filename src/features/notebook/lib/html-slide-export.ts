/**
 * Export HTML slides as PDF, PNG, or image-based PPTX.
 *
 * Slides are rasterized by walking the DOM to collect "paint events" in
 * document order — full-slide colour fills, full-slide gradients, and
 * image draws (from `<img>` and CSS `background-image: url(data:…)`).
 * The events are then replayed onto the canvas in DOM order, and finally
 * the foreignObject (text/shapes only) is drawn on top.
 *
 * Painting in DOM order matters for hero slides where an overlay `<div>`
 * sits after an `<img>` to dim the photo for legibility — collapsing all
 * full-slide bgs to a single "Layer 1" would put the overlay under the
 * image where it has no visual effect.
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
// Backgrounds are painted directly onto the canvas (Layer 1) rather than
// relying on the foreignObject path. CSS gradients and CSS variables don't
// render reliably inside an SVG-loaded-as-img across browsers, which is what
// produced "white-only" exports for slides whose background was a gradient.

interface ParsedLinearGradient {
  angle: number;
  stops: { color: string; offset: number }[];
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

/**
 * Resolve a `to <keyword>` direction to a degree angle.
 * For corners the angle depends on aspect ratio — CSS positions the gradient
 * line so that endpoints sit perpendicular to the corner-to-corner diagonal.
 */
function directionToAngle(dir: string, w: number, h: number): number | null {
  const corner = (Math.atan2(w, h) * 180) / Math.PI;
  switch (dir) {
    case "top":
      return 0;
    case "right":
      return 90;
    case "bottom":
      return 180;
    case "left":
      return 270;
    case "top right":
    case "right top":
      return corner;
    case "bottom right":
    case "right bottom":
      return 180 - corner;
    case "bottom left":
    case "left bottom":
      return 180 + corner;
    case "top left":
    case "left top":
      return 360 - corner;
    default:
      return null;
  }
}

/** A header token introduces the gradient line: an angle, a `to` direction, or a colorspace prefix. */
function isHeaderToken(s: string): boolean {
  const t = s.trim().toLowerCase();
  return /^(to|in)\s/.test(t) || /^-?\d+(?:\.\d+)?\s*(deg|rad|turn|grad)\b/.test(t);
}

function parseHeaderAngle(spec: string, w: number, h: number): number | null {
  const lower = spec.toLowerCase();
  const angleMatch = /(-?\d+(?:\.\d+)?)\s*(deg|rad|turn|grad)/.exec(lower);
  if (angleMatch) {
    const v = parseFloat(angleMatch[1]);
    switch (angleMatch[2]) {
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
  const dirMatch = /\bto\s+(top|right|bottom|left)(?:\s+(top|right|bottom|left))?/.exec(lower);
  if (dirMatch) {
    const dir = dirMatch[2] ? `${dirMatch[1]} ${dirMatch[2]}` : dirMatch[1];
    return directionToAngle(dir, w, h);
  }
  return null;
}

/** Pull a single color expression off the front of a stop token, plus an optional `<n>%` position. */
function parseColorStop(token: string): { color: string; offset?: number } | null {
  const t = token.trim();
  if (!t) return null;
  let end: number;
  if (t[0] === "#") {
    end = t.search(/\s/);
    if (end === -1) end = t.length;
  } else if (/^[a-z][a-z0-9]*\(/i.test(t)) {
    let depth = 0;
    let i = 0;
    while (i < t.length) {
      if (t[i] === "(") depth++;
      else if (t[i] === ")" && --depth === 0) {
        i++;
        break;
      }
      i++;
    }
    end = i;
  } else {
    const word = /^[a-z][a-z0-9-]*/i.exec(t);
    end = word ? word[0].length : 0;
  }
  const color = t.slice(0, end).trim();
  if (!color) return null;
  const pct = /^\s*(-?\d+(?:\.\d+)?)\s*%/.exec(t.slice(end));
  return pct ? { color, offset: parseFloat(pct[1]) / 100 } : { color };
}

/** Distribute undefined offsets evenly between defined neighbours, then clamp monotonically. */
function fillStopOffsets(stops: { color: string; offset?: number }[]): void {
  if (stops[0].offset === undefined) stops[0].offset = 0;
  const last = stops.length - 1;
  if (stops[last].offset === undefined) stops[last].offset = 1;
  let i = 1;
  while (i < last) {
    if (stops[i].offset !== undefined) {
      i++;
      continue;
    }
    let j = i;
    while (j < stops.length && stops[j].offset === undefined) j++;
    const prev = stops[i - 1].offset as number;
    const next = stops[j].offset as number;
    const span = j - (i - 1);
    for (let k = 0; k < j - i; k++) {
      stops[i + k].offset = prev + ((next - prev) * (k + 1)) / span;
    }
    i = j;
  }
  for (let k = 1; k < stops.length; k++) {
    if ((stops[k].offset as number) < (stops[k - 1].offset as number)) {
      stops[k].offset = stops[k - 1].offset;
    }
  }
}

function parseLinearGradient(layer: string, w: number, h: number): ParsedLinearGradient | null {
  const m = /^linear-gradient\(\s*([\s\S]+)\s*\)\s*$/i.exec(layer.trim());
  if (!m) return null;
  const tokens = splitTopLevelCommas(m[1]);
  if (tokens.length < 2) return null;

  let angle = 180;
  let startIdx = 0;
  if (isHeaderToken(tokens[0])) {
    const a = parseHeaderAngle(tokens[0], w, h);
    if (a !== null) angle = a;
    startIdx = 1;
  }

  const stops: { color: string; offset?: number }[] = [];
  for (const tok of tokens.slice(startIdx)) {
    const s = parseColorStop(tok);
    if (s) stops.push(s);
  }
  if (stops.length < 2) return null;

  fillStopOffsets(stops);
  return {
    angle,
    stops: stops.map((p) => ({ color: p.color, offset: Math.max(0, Math.min(1, p.offset as number)) })),
  };
}

function applyLinearGradient(ctx: CanvasRenderingContext2D, g: ParsedLinearGradient, w: number, h: number): boolean {
  const rad = (g.angle * Math.PI) / 180;
  const sx = Math.sin(rad);
  const sy = -Math.cos(rad);
  const cx = w / 2;
  const cy = h / 2;
  const half = (Math.abs(w * sx) + Math.abs(h * sy)) / 2;
  const grad = ctx.createLinearGradient(cx - sx * half, cy - sy * half, cx + sx * half, cy + sy * half);
  let added = 0;
  for (const s of g.stops) {
    try {
      grad.addColorStop(s.offset, s.color);
      added++;
    } catch {
      /* invalid color string — skip this stop */
    }
  }
  if (added < 2) return false;
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  return true;
}

// ── Paint events (DOM-order rasterization) ───────────────────────────────────

type PaintEvent =
  | { kind: "color"; index: number; color: string }
  | { kind: "gradient"; index: number; gradient: ParsedLinearGradient }
  | { kind: "image"; index: number; overlay: ImageOverlay };

interface Mutation {
  el: HTMLElement;
  prop: "visibility" | "backgroundColor" | "backgroundImage";
  prev: string;
}

function recordMutation(
  mutations: Mutation[],
  el: HTMLElement,
  prop: Mutation["prop"],
  next: string,
): void {
  mutations.push({ el, prop, prev: el.style[prop] });
  el.style[prop] = next;
}

function unwindMutations(mutations: Mutation[]): void {
  for (let i = mutations.length - 1; i >= 0; i--) {
    const { el, prop, prev } = mutations[i];
    el.style[prop] = prev;
  }
}

/**
 * Pull a data URL out of an `<img>`. Direct `data:` src wins; otherwise we
 * canvas-copy so the export doesn't depend on whether the foreignObject is
 * allowed to load nested data URLs (Chrome blocks; Safari taints). Cross-
 * origin sources throw on `toDataURL` and are silently skipped.
 */
function extractDataUrlFromImg(img: HTMLImageElement, hostDoc: Document): string | null {
  if (img.src.startsWith("data:")) return img.src;
  if (!img.complete || img.naturalWidth <= 0) return null;
  try {
    const c = hostDoc.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const cx = c.getContext("2d");
    if (!cx) return null;
    cx.drawImage(img, 0, 0);
    return c.toDataURL("image/png");
  } catch {
    return null;
  }
}

/** Pull a `data:` URL out of a single CSS background layer string. */
function extractDataUrlFromCssLayer(layer: string): string | null {
  const m = layer.match(/url\(["']?(data:[^"')]+)["']?\)/);
  return m ? m[1] : null;
}

function isFullSlideRect(rect: DOMRect): boolean {
  return rect.width >= CANVAS_W * 0.9 && rect.height >= CANVAS_H * 0.9;
}

/**
 * Walk the slide DOM in document order, emitting paint events and recording
 * the minimal style mutations needed to keep the foreignObject layer free of
 * the things we've already painted (full-slide bgs, image elements).
 *
 * Cross-realm safe — uses `tagName` and `"style" in el` rather than
 * `instanceof`, which fails for elements from an iframe's contentDocument.
 */
function collectPaintEvents(doc: Document, win: Window, mutations: Mutation[]): PaintEvent[] {
  const events: PaintEvent[] = [];
  let counter = 0;

  const visit = (el: Element) => {
    const index = counter++;
    const rect = el.getBoundingClientRect();
    const html = "style" in el ? (el as HTMLElement) : null;

    if (html) {
      const cs = win.getComputedStyle(html);
      const fullSlide = isFullSlideRect(rect);

      // Background-image: gradients and data-URL layers on a full-slide element.
      // CSS lists layers top-to-bottom; canvas paints later events on top, so
      // iterate in reverse to push bottom layer first.
      let clearedBgImage = false;
      if (fullSlide && cs.backgroundImage && cs.backgroundImage !== "none") {
        const layers = splitTopLevelCommas(cs.backgroundImage);
        for (let i = layers.length - 1; i >= 0; i--) {
          const layer = layers[i];
          const grad = parseLinearGradient(layer, CANVAS_W, CANVAS_H);
          if (grad) {
            events.push({ kind: "gradient", index, gradient: grad });
            if (!clearedBgImage) {
              recordMutation(mutations, html, "backgroundImage", "none");
              clearedBgImage = true;
            }
            continue;
          }
          const dataUrl = extractDataUrlFromCssLayer(layer);
          if (dataUrl) {
            const bgSize = cs.backgroundSize;
            const objectFit = bgSize === "cover" ? "cover" : bgSize === "contain" ? "contain" : undefined;
            events.push({
              kind: "image",
              index,
              overlay: {
                dataUrl,
                x: rect.left,
                y: rect.top,
                w: rect.width,
                h: rect.height,
                opacity: parseFloat(cs.opacity) || 1,
                objectFit,
                objectPosition: cs.backgroundPosition || undefined,
              },
            });
            if (!clearedBgImage) {
              recordMutation(mutations, html, "backgroundImage", "none");
              clearedBgImage = true;
            }
          }
        }
      }

      // Background-color on a full-slide element. CSS paints colour below all
      // bg-image layers, so splice it before any events already pushed from
      // this element.
      if (fullSlide) {
        const bgColor = cs.backgroundColor;
        if (bgColor && bgColor !== "rgba(0, 0, 0, 0)" && bgColor !== "transparent") {
          const firstFromHere = events.findIndex((e) => e.index === index);
          const colorEvent: PaintEvent = { kind: "color", index, color: bgColor };
          if (firstFromHere === -1) events.push(colorEvent);
          else events.splice(firstFromHere, 0, colorEvent);
          recordMutation(mutations, html, "backgroundColor", "transparent");
        }
      }
    }

    // <img> element — extract data URL and hide. Use tagName, not instanceof.
    if (el.tagName === "IMG" && rect.width >= 1 && rect.height >= 1) {
      const img = el as HTMLImageElement;
      const dataUrl = extractDataUrlFromImg(img, document);
      if (dataUrl) {
        const cs = win.getComputedStyle(img);
        events.push({
          kind: "image",
          index,
          overlay: {
            dataUrl,
            x: rect.left,
            y: rect.top,
            w: rect.width,
            h: rect.height,
            opacity: parseFloat(cs.opacity) || 1,
            naturalW: img.naturalWidth,
            naturalH: img.naturalHeight,
            objectFit: cs.objectFit || undefined,
            objectPosition: cs.objectPosition || undefined,
          },
        });
        recordMutation(mutations, img, "visibility", "hidden");
      }
    }

    for (const child of el.children) visit(child);
  };

  visit(doc.documentElement);
  return events;
}

async function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  const img = new Image();
  await new Promise<void>((resolve) => {
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = dataUrl;
  });
  return img;
}

async function replayPaintEvents(
  ctx: CanvasRenderingContext2D,
  events: PaintEvent[],
  w: number,
  h: number,
): Promise<void> {
  const firstIsBg = events[0]?.kind === "color" || events[0]?.kind === "gradient";
  if (!firstIsBg) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }

  for (const event of events) {
    if (event.kind === "color") {
      ctx.fillStyle = event.color;
      ctx.fillRect(0, 0, w, h);
    } else if (event.kind === "gradient") {
      if (!applyLinearGradient(ctx, event.gradient, w, h)) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
      }
    } else {
      const info = event.overlay;
      const overlayImg = await loadImageFromDataUrl(info.dataUrl);
      if (overlayImg.naturalWidth <= 0) continue;
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
  }
}

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
 * Rasterize a mounted slide onto a canvas.
 *
 * 1. Walk the DOM once collecting paint events (full-slide colour/gradient bgs,
 *    `<img>` overlays, CSS data-URL bg overlays) tagged with their DOM index.
 *    Mutate the DOM minimally (hide images, clear extracted bgs) and record
 *    every mutation so we can unwind on teardown.
 * 2. Serialize the cleared DOM into an SVG `<foreignObject>` so the
 *    text/shape layer renders without the bgs we already extracted.
 * 3. Replay events in DOM order onto the canvas, then drawImage(svgImg) on top.
 *
 * DOM-ordered replay reproduces CSS paint order, so an overlay `<div>`
 * that sits after an `<img>` darkens the photo on the canvas exactly as it
 * does in the browser preview.
 */
async function rasterizeSlideDoc(
  iframe: HTMLIFrameElement,
  options: { hideText?: boolean } = {},
): Promise<HTMLCanvasElement> {
  const doc = iframe.contentDocument;
  if (!doc?.documentElement) throw new Error("Slide iframe has no document");
  const win = iframe.contentWindow;
  if (!win) throw new Error("Slide iframe has no window");

  const mutations: Mutation[] = [];
  let hideTextStyle: HTMLStyleElement | null = null;

  try {
    // Optionally hide all text (used by hybrid PPTX export so the rasterized
    // background doesn't double-render text that's also drawn as an editable
    // overlay). A stylesheet keeps layout identical.
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

    const events = collectPaintEvents(doc, win, mutations);

    // Serialize the *cleared* DOM — bgs we'll paint on canvas are gone, images are hidden.
    doc.documentElement.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    const xhtml = new XMLSerializer().serializeToString(doc.documentElement);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}">` +
      `<foreignObject x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}">${xhtml}</foreignObject>` +
      `</svg>`;

    const svgImg = new Image();
    svgImg.decoding = "sync";
    await new Promise<void>((resolve, reject) => {
      svgImg.onload = () => resolve();
      svgImg.onerror = (event) => {
        console.error("[slide-export] SVG image failed to load", event);
        reject(new Error("Failed to rasterize slide (SVG img load failed)"));
      };
      svgImg.src = `data:image/svg+xml;base64,${utf8ToBase64(svg)}`;
    });
    try {
      await svgImg.decode();
    } catch {
      /* decode() can reject even when the image is usable — not fatal */
    }

    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W * RASTER_SCALE;
    canvas.height = CANVAS_H * RASTER_SCALE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2D canvas context");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    await replayPaintEvents(ctx, events, canvas.width, canvas.height);
    ctx.drawImage(svgImg, 0, 0, canvas.width, canvas.height);

    return canvas;
  } finally {
    unwindMutations(mutations);
    hideTextStyle?.parentNode?.removeChild(hideTextStyle);
  }
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
