/**
 * Static HTML slide DOM parser.
 *
 * Mounts an HTML slide in an iframe, walks the DOM to extract text,
 * images, and shapes with their computed positions and styles.
 * Used by the hybrid PPTX export to create editable overlays.
 */

import { CANVAS_H, CANVAS_W } from "./pptx-utils";

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
}

export interface ParsedElement {
  type: "text" | "image" | "shape";
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  color?: string;
  textAlign?: string;
  paragraphs?: ParsedParagraph[];
  backgroundColor?: string;
  borderRadius?: number;
  borderColor?: string;
  borderWidth?: number;
  opacity?: number;
  imageData?: string;
  /** Natural pixel dimensions of the source image — used to preserve aspect ratio in PPTX. */
  naturalW?: number;
  naturalH?: number;
  /** CSS `object-fit` for <img> elements (`cover`, `contain`, `fill`, …). */
  objectFit?: string;
}

export interface ParsedSlide {
  background: string;
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

    const bodyStyle = win.getComputedStyle(body);
    let background = bodyStyle.backgroundColor || "rgb(255, 255, 255)";

    if (background === "rgba(0, 0, 0, 0)" || background === "transparent") {
      const firstChild = body.firstElementChild;
      if (firstChild) {
        const childStyle = win.getComputedStyle(firstChild);
        background = childStyle.backgroundColor || "rgb(255, 255, 255)";
      }
    }

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
          const dataUrl = await getImageDataUrl(imgEl);
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
        const hasBg = style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent";
        const hasBorder = style.borderWidth !== "0px" && style.borderStyle !== "none";

        if ((hasBg || hasBorder) && !isLeaf) {
          elements.push({
            type: "shape",
            x: rect.left,
            y: rect.top,
            w: rect.width,
            h: rect.height,
            backgroundColor: hasBg ? style.backgroundColor : undefined,
            borderRadius: parseFloat(style.borderRadius) || 0,
            borderColor: hasBorder ? style.borderColor : undefined,
            borderWidth: hasBorder ? parseFloat(style.borderWidth) || 0 : 0,
            opacity: parseFloat(style.opacity),
          });
        }

        if (isLeaf) {
          const paragraphs = extractParagraphs(el, win);
          if (paragraphs.length > 0) {
            elements.push({
              type: "text",
              x: rect.left,
              y: rect.top,
              w: rect.width,
              h: rect.height,
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

    return { background, elements };
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

function extractParagraphs(el: HTMLElement, win: Window): ParsedParagraph[] {
  const style = win.getComputedStyle(el);

  if (el.tagName === "UL" || el.tagName === "OL") {
    return [...el.querySelectorAll("li")]
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
        };
      })
      .filter((p) => p.text);
  }

  const text = el.textContent?.trim();
  if (!text) return [];

  return [
    {
      text,
      fontSize: parseFloat(style.fontSize) || 16,
      fontFamily: style.fontFamily?.split(",")[0]?.replace(/["']/g, "").trim() || "Calibri",
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      color: style.color,
      textAlign: style.textAlign,
    },
  ];
}

function skipChildren(walker: TreeWalker, parent: Element) {
  let next = walker.nextNode() as Element | null;
  while (next && parent.contains(next)) {
    next = walker.nextNode() as Element | null;
  }
  if (next) walker.previousNode();
}

async function rasterizeSvg(svg: SVGSVGElement, width: number, height: number): Promise<string | null> {
  let url: string | undefined;
  try {
    const svgStr = new XMLSerializer().serializeToString(svg);
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

async function getImageDataUrl(img: HTMLImageElement): Promise<string | null> {
  if (img.src.startsWith("data:")) return img.src;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
