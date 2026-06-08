/**
 * Static HTML slide DOM parser.
 *
 * Mounts an HTML slide in an iframe, walks the DOM to extract text,
 * images, and shapes with their computed positions and styles.
 * Used by the hybrid PPTX export to create editable overlays.
 */

import { CANVAS_H, CANVAS_W, imgToDataUrl } from "./pptx-utils";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ParsedParagraph {
  text: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  color?: string;
  textAlign?: string;
  isBullet?: boolean;
  /** Computed line-height as a multiple of the font size (1.2 = "normal"). */
  lineHeightRatio?: number;
  /** Computed letter-spacing in CSS px (0 = "normal"). */
  letterSpacingPx?: number;
}

export interface ParsedElement {
  type: "text" | "image";
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * True when `paragraphs` are the element's measured visual lines (one
   * paragraph per rendered line). The exporter then disables wrapping so the
   * text can never re-wrap differently from the rasterized background.
   */
  preWrapped?: boolean;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  color?: string;
  textAlign?: string;
  paragraphs?: ParsedParagraph[];
  imageData?: string;
  /** Natural pixel dimensions of the source image — used to preserve aspect ratio in PPTX. */
  naturalW?: number;
  naturalH?: number;
  /** CSS `object-fit` for <img> elements (`cover`, `contain`, `fill`, …). */
  objectFit?: string;
}

export interface ParsedSlide {
  elements: ParsedElement[];
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function parseSlideHtml(html: string): Promise<ParsedSlide> {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-9999px";
  iframe.style.width = `${CANVAS_W}px`;
  iframe.style.height = `${CANVAS_H}px`;
  iframe.style.border = "none";
  iframe.style.overflow = "hidden";
  iframe.srcdoc = html;

  document.body.appendChild(iframe);

  await new Promise<void>((resolve) => {
    iframe.onload = () => resolve();
  });

  try {
    await iframe.contentDocument?.fonts.ready;
  } catch {
    // ignore
  }

  try {
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) throw new Error("iframe content unavailable");
    const body = doc.body;

    const elements: ParsedElement[] = [];
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
    const visited = new Set<Element>();

    let node: Element | null = walker.currentNode as Element;
    while (node) {
      if (node !== body && !visited.has(node)) {
        visited.add(node);
        const el = node as HTMLElement;
        const style = win.getComputedStyle(el);

        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
          node = walker.nextNode() as Element | null;
          continue;
        }

        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) {
          node = walker.nextNode() as Element | null;
          continue;
        }

        // SVG → rasterize
        if (el.tagName === "SVG" || el.tagName === "svg") {
          const dataUrl = await rasterizeSvg(el as unknown as SVGSVGElement, rect.width, rect.height);
          if (dataUrl) {
            elements.push({
              type: "image",
              x: rect.left,
              y: rect.top,
              w: rect.width,
              h: rect.height,
              imageData: dataUrl,
            });
          }
          skipChildren(walker, el);
          node = walker.nextNode() as Element | null;
          continue;
        }

        // IMG
        if (el.tagName === "IMG") {
          const imgEl = el as HTMLImageElement;
          const dataUrl = imgToDataUrl(imgEl);
          if (dataUrl) {
            elements.push({
              type: "image",
              x: rect.left,
              y: rect.top,
              w: rect.width,
              h: rect.height,
              imageData: dataUrl,
              naturalW: imgEl.naturalWidth || undefined,
              naturalH: imgEl.naturalHeight || undefined,
              objectFit: style.objectFit || undefined,
            });
          }
          node = walker.nextNode() as Element | null;
          continue;
        }

        const isLeaf = isLeafTextBlock(el);

        if (isLeaf) {
          const { paragraphs, preWrapped } = extractParagraphs(el, win);
          if (paragraphs.length > 0) {
            elements.push({
              type: "text",
              x: rect.left,
              y: rect.top,
              w: rect.width,
              h: rect.height,
              preWrapped,
              fontSize: parseFloat(style.fontSize) || 16,
              fontFamily: style.fontFamily?.split(",")[0]?.replace(/["']/g, "").trim() || "Calibri",
              fontWeight: style.fontWeight,
              fontStyle: style.fontStyle,
              color: style.color,
              textAlign: style.textAlign,
              paragraphs,
            });
            skipChildren(walker, el);
          }
        }
      }
      node = walker.nextNode() as Element | null;
    }

    return { elements };
  } finally {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  }
}

// ── DOM helpers ─────────────────────────────────────────────────────────────

function isLeafTextBlock(el: HTMLElement): boolean {
  const text = el.textContent?.trim();
  if (!text) return false;

  const blockTags = new Set([
    "DIV",
    "SECTION",
    "ARTICLE",
    "MAIN",
    "NAV",
    "ASIDE",
    "HEADER",
    "FOOTER",
    "UL",
    "OL",
    "TABLE",
    "FIGURE",
  ]);

  if (blockTags.has(el.tagName)) {
    for (const child of el.children) {
      if (
        blockTags.has(child.tagName) ||
        ["H1", "H2", "H3", "H4", "H5", "H6", "P", "BLOCKQUOTE", "PRE", "LI"].includes(child.tagName)
      ) {
        return false;
      }
    }
  }

  const textTags = new Set([
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "P",
    "LI",
    "BLOCKQUOTE",
    "PRE",
    "FIGCAPTION",
    "TD",
    "TH",
    "DT",
    "DD",
    "LABEL",
  ]);
  if (textTags.has(el.tagName)) return true;

  const inlineTags = new Set(["SPAN", "A", "STRONG", "EM", "B", "I", "CODE"]);
  if (inlineTags.has(el.tagName)) {
    const parent = el.parentElement;
    if (parent && !textTags.has(parent.tagName) && !inlineTags.has(parent.tagName)) {
      return true;
    }
    return false;
  }

  if (el.tagName === "DIV") {
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) return true;
    }
  }

  return false;
}

/**
 * Computed line-height as a ratio of the font size. Browsers resolve
 * "normal" to ~1.2 for most fonts; treat it as exactly that so the PPTX
 * spacing reproduces the measured box heights.
 */
function lineHeightRatioOf(style: CSSStyleDeclaration): number {
  const fs = parseFloat(style.fontSize) || 16;
  const lh = parseFloat(style.lineHeight);
  if (!Number.isFinite(lh) || lh <= 0) return 1.2;
  return Math.round((lh / fs) * 1000) / 1000;
}

function letterSpacingPxOf(style: CSSStyleDeclaration): number {
  const ls = parseFloat(style.letterSpacing);
  return Number.isFinite(ls) ? ls : 0;
}

function extractParagraphs(el: HTMLElement, win: Window): { paragraphs: ParsedParagraph[]; preWrapped: boolean } {
  const style = win.getComputedStyle(el);

  if (el.tagName === "UL" || el.tagName === "OL") {
    const paragraphs = [...el.querySelectorAll("li")]
      .map((li) => {
        const liStyle = win.getComputedStyle(li);
        return {
          text: li.textContent?.trim() || "",
          fontSize: parseFloat(liStyle.fontSize) || parseFloat(style.fontSize) || 16,
          fontFamily: liStyle.fontFamily?.split(",")[0]?.replace(/["']/g, "").trim() || "Calibri",
          fontWeight: liStyle.fontWeight,
          fontStyle: liStyle.fontStyle,
          color: liStyle.color,
          textAlign: liStyle.textAlign,
          isBullet: true,
          lineHeightRatio: lineHeightRatioOf(liStyle),
          letterSpacingPx: letterSpacingPxOf(liStyle),
        };
      })
      .filter((p) => p.text);
    return { paragraphs, preWrapped: false };
  }

  const text = el.textContent?.trim();
  if (!text) return { paragraphs: [], preWrapped: false };

  // Export the element's measured visual lines as one paragraph each.
  // Re-wrapping is the main source of drift between the browser layout
  // and PPTX renderers (PowerPoint, the in-app preview) — pinning the
  // line breaks makes the overlay text match the rasterized background.
  const lines = splitTextLines(el);
  const base = {
    fontSize: parseFloat(style.fontSize) || 16,
    fontFamily: style.fontFamily?.split(",")[0]?.replace(/["']/g, "").trim() || "Calibri",
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    color: style.color,
    textAlign: style.textAlign,
    lineHeightRatio: lineHeightRatioOf(style),
    letterSpacingPx: letterSpacingPxOf(style),
  };

  if (lines.length > 1) {
    return { paragraphs: lines.map((line) => ({ text: line, ...base })), preWrapped: true };
  }
  return { paragraphs: [{ text, ...base }], preWrapped: true };
}

/**
 * Split a text element into its rendered visual lines by measuring each
 * character's Range rect and grouping consecutive characters by line top.
 * Collapsed whitespace (zero-size rects) is skipped; runs of source
 * whitespace are normalized to single spaces.
 */
function splitTextLines(el: HTMLElement): string[] {
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();

  const lines: { top: number; text: string }[] = [];
  let cur: { top: number; text: string } | null = null;

  for (let tn = walker.nextNode() as Text | null; tn; tn = walker.nextNode() as Text | null) {
    const content = tn.textContent ?? "";
    for (let i = 0; i < content.length; i++) {
      range.setStart(tn, i);
      range.setEnd(tn, i + 1);
      const r = range.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // collapsed whitespace
      if (!cur || Math.abs(r.top - cur.top) > r.height * 0.5) {
        if (cur) lines.push(cur);
        cur = { top: r.top, text: content[i] };
      } else {
        cur.text += content[i];
      }
    }
  }
  if (cur) lines.push(cur);

  return lines.map((l) => l.text.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function skipChildren(walker: TreeWalker, parent: Element) {
  let next = walker.nextNode() as Element | null;
  while (next && parent.contains(next)) {
    next = walker.nextNode() as Element | null;
  }
  if (next) walker.previousNode();
}

/**
 * Style properties to bake into the SVG clone before standalone
 * serialization. Computed values resolve CSS variables (`fill="var(--x)"`),
 * `inherit`, and document-stylesheet rules — none of which survive when the
 * SVG is loaded as an isolated image (where unresolved fills paint black).
 */
const SVG_INLINE_PROPS = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
  "stop-color",
  "stop-opacity",
] as const;

function inlineSvgComputedStyles(src: SVGSVGElement, clone: SVGSVGElement, win: Window): void {
  const srcEls: Element[] = [src, ...src.querySelectorAll("*")];
  const cloneEls: Element[] = [clone, ...clone.querySelectorAll("*")];
  for (let i = 0; i < srcEls.length && i < cloneEls.length; i++) {
    const cs = win.getComputedStyle(srcEls[i]);
    let styleText = "";
    for (const prop of SVG_INLINE_PROPS) {
      const v = cs.getPropertyValue(prop);
      if (v) styleText += `${prop}:${v};`;
    }
    if (styleText) cloneEls[i].setAttribute("style", styleText);
  }
}

async function rasterizeSvg(svg: SVGSVGElement, width: number, height: number): Promise<string | null> {
  let url: string | undefined;
  try {
    const win = svg.ownerDocument.defaultView;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    // The clone may have been sized by CSS — pin the layout size explicitly
    // so the standalone image rasterizes at the rendered dimensions.
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    if (win) inlineSvgComputedStyles(svg, clone, win);

    const svgStr = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    url = URL.createObjectURL(blob);
    const objUrl = url;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = objUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width * 2, height * 2);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}
