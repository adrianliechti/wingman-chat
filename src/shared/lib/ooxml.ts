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

export interface Rel {
  target: string;
  type: string;
  external: boolean;
}

/** Path of the .rels part describing `partPath`. */
export function relsPathFor(partPath: string): string {
  const dir = partPath.substring(0, partPath.lastIndexOf("/"));
  const name = partPath.substring(partPath.lastIndexOf("/") + 1);
  return `${dir}/_rels/${name}.rels`;
}

/** Parse a .rels document into an rId → relationship map. */
export function parseRels(doc: Document | null): Map<string, Rel> {
  const rels = new Map<string, Rel>();
  if (!doc) return rels;
  for (const rel of doc.getElementsByTagName("Relationship")) {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (id && target) {
      rels.set(id, {
        target,
        type: rel.getAttribute("Type") || "",
        external: rel.getAttribute("TargetMode") === "External",
      });
    }
  }
  return rels;
}

/**
 * Load a zip-internal media part as a data URL, with caching. Unsupported
 * formats (EMF/WMF, …) cache an empty sentinel and return undefined.
 */
export async function loadMediaDataUrl(
  zip: { file(path: string): { async(type: "base64"): Promise<string> } | null },
  cache: Map<string, string>,
  path: string,
): Promise<string | undefined> {
  const cached = cache.get(path);
  if (cached !== undefined) return cached || undefined;

  const ext = path.substring(path.lastIndexOf(".") + 1).toLowerCase();
  const mime = MEDIA_MIME[ext];
  if (!mime) {
    cache.set(path, "");
    return undefined;
  }

  const base64 = await zip.file(path)?.async("base64");
  const dataUrl = base64 ? `data:${mime};base64,${base64}` : "";
  cache.set(path, dataUrl);
  return dataUrl || undefined;
}

// ============================================================================
// Theme (DrawingML a:clrScheme / a:fontScheme — shared by pptx/docx/xlsx)
// ============================================================================

export interface OoxmlTheme {
  /** Theme color slots (dk1, lt1, accent1, …) → hex without '#' */
  colors: Record<string, string>;
  majorFont: string;
  minorFont: string;
}

export function parseThemeDoc(doc: Document | null): OoxmlTheme {
  const theme: OoxmlTheme = { colors: {}, majorFont: "Calibri Light", minorFont: "Calibri" };
  if (!doc) return theme;

  const clrScheme = doc.getElementsByTagName("a:clrScheme")[0];
  if (clrScheme) {
    for (const slot of clrScheme.children) {
      const name = slot.tagName.replace("a:", "");
      const hex = child(slot, "a:srgbClr")?.getAttribute("val") || child(slot, "a:sysClr")?.getAttribute("lastClr");
      if (hex) theme.colors[name] = hex;
    }
  }

  const fontScheme = doc.getElementsByTagName("a:fontScheme")[0];
  const major = child(child(fontScheme, "a:majorFont"), "a:latin")?.getAttribute("typeface");
  const minor = child(child(fontScheme, "a:minorFont"), "a:latin")?.getAttribute("typeface");
  if (major) theme.majorFont = major;
  if (minor) theme.minorFont = minor;
  return theme;
}

// ============================================================================
// Colors & fonts
// ============================================================================

/**
 * Mix a 6-digit hex color toward white (tint) or black (shade).
 * `keep` is the fraction of the original color retained (0..1).
 */
export function mixHex(hex: string, keep: number, towardWhite: boolean): string {
  const c = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  return c
    .map((v) => {
      const n = towardWhite ? v * keep + 255 * (1 - keep) : v * keep;
      return Math.max(0, Math.min(255, Math.round(n)))
        .toString(16)
        .padStart(2, "0");
    })
    .join("")
    .toUpperCase();
}

/**
 * CSS font-family stack for a document-declared typeface. Quotes and
 * backslashes are stripped — the value lands inside single quotes within a
 * double-quoted style attribute, where a stray quote would truncate the rule.
 */
export function cssFontStack(font: string): string {
  const safe = font.replace(/['"\\]/g, "");
  return `'${safe}', 'Segoe UI', system-ui, -apple-system, sans-serif`;
}

// ============================================================================
// List numbering & bullet glyphs
// ============================================================================

export function toAlpha(n: number): string {
  let s = "";
  let v = n;
  while (v > 0) {
    s = String.fromCharCode(((v - 1) % 26) + 97) + s;
    v = Math.floor((v - 1) / 26);
  }
  return s;
}

const ROMAN: [number, string][] = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

export function toRoman(n: number): string {
  let s = "";
  let v = n;
  for (const [val, sym] of ROMAN) {
    while (v >= val) {
      s += sym;
      v -= val;
    }
  }
  return s;
}

/** Wingdings/Symbol/Courier glyph codes → Unicode equivalents. */
const SYMBOL_GLYPHS: Record<number, string> = {
  183: "•",
  161: "○",
  167: "▪",
  216: "➢",
  252: "✓",
  118: "❖",
  108: "●",
  110: "■",
  117: "◆",
  113: "❑",
  111: "○",
  45: "–",
};

/**
 * Map a bullet character from a symbolic font (Wingdings, Symbol, Courier
 * bullets) to a Unicode glyph browsers can render. Codes in the F0xx private
 * use area are normalized first. Non-symbolic fonts pass through unchanged.
 */
export function mapBulletChar(char: string, font: string): string {
  if (!char) return "•";
  let code = char.charCodeAt(0);
  const isPua = code >= 0xf000;
  if (isPua) code -= 0xf000;
  const f = font.toLowerCase();
  if (isPua || f.includes("wingdings") || f.includes("symbol") || f.includes("courier")) {
    // Real Unicode glyphs (≥ U+2000) already render fine; raw symbolic codes
    // fall back to a plain bullet.
    return SYMBOL_GLYPHS[code] ?? (code >= 0x2000 ? String.fromCharCode(code) : "•");
  }
  return String.fromCharCode(code);
}
