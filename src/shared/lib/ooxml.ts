/**
 * Shared helpers for parsing Office Open XML (pptx/docx) parts:
 * XML traversal, unit conversion, escaping and relationship targets.
 */

export const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** 914400 EMU per inch / 96 px per inch */
export const EMU_PER_PX = 9525;

export function emuToPx(emu: number): number {
  return Math.round((emu / EMU_PER_PX) * 100) / 100;
}

/** Points → CSS px (96 dpi) */
export function ptToPx(pt: number): number {
  return Math.round(pt * (96 / 72) * 100) / 100;
}

/** Twentieths of a point (Word's "dxa") → CSS px */
export function twipToPx(twip: number): number {
  return Math.round((twip / 15) * 100) / 100;
}

export function px(n: number): string {
  return `${Math.round(n * 100) / 100}px`;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, "application/xml");
}

// ============================================================================
// XML traversal (tag names are namespace-prefixed, e.g. "w:p", "a:blip")
// ============================================================================

export function child(el: Element | undefined | null, name: string): Element | undefined {
  if (!el) return undefined;
  for (const c of el.children) {
    if (c.tagName === name) return c;
  }
  return undefined;
}

export function childList(el: Element | undefined | null, name?: string): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  for (const c of el.children) {
    if (!name || c.tagName === name) out.push(c);
  }
  return out;
}

export function descend(el: Element | undefined | null, ...path: string[]): Element | undefined {
  let cur: Element | undefined = el ?? undefined;
  for (const name of path) {
    cur = child(cur, name);
    if (!cur) return undefined;
  }
  return cur;
}

export function intAttr(el: Element | undefined | null, attr: string): number | undefined {
  const v = el?.getAttribute(attr);
  if (v == null) return undefined;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
}

export function boolAttr(el: Element | undefined | null, attr: string): boolean | undefined {
  const v = el?.getAttribute(attr);
  if (v == null) return undefined;
  return v === "1" || v === "true" || v === "on";
}

export function getRId(el: Element | undefined | null, attr = "embed"): string | null {
  if (!el) return null;
  return el.getAttributeNS(R_NS, attr) || el.getAttribute(`r:${attr}`);
}

// ============================================================================
// Relationships & media
// ============================================================================

/** Resolve a relationship target relative to the part that declares it. */
export function resolveTarget(partPath: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = partPath.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

export const MEDIA_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
};
