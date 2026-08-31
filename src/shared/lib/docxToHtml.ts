import JSZip from "jszip";
import { ommlToMathml } from "./ommlToMathml";
import {
  assertOoxmlInputSize,
  child,
  childList,
  cssFontStack,
  descend,
  emuToPx,
  escapeHtml,
  getRId,
  intAttr,
  loadMediaDataUrl,
  mapBulletChar,
  mixHex,
  normalizeHexColor,
  OFFICE_PREVIEW_CSP,
  OoxmlPackageReader,
  type OoxmlTheme,
  parseRels,
  parseThemeDoc,
  parseXml,
  ptToPx,
  px,
  type Rel,
  relsPathFor,
  resolveTarget,
  sanitizeHyperlinkUrl,
  sanitizeCssColor,
  toAlpha,
  toRoman,
  twipToPx,
} from "./ooxml";

/**
 * Converts a DOCX file to a single self-contained HTML document with high
 * content retention: styles.xml inheritance (docDefaults → named styles →
 * direct formatting), theme colors/fonts, multi-level numbering, tables
 * (borders, shading, merges), inline & floating images, hyperlinks and
 * page-sized sheets with measured pagination, section furniture, and bounded
 * OOXML/media processing.
 *
 * Render it in an iframe — a small inline script zooms the page to fit the
 * viewport width.
 */
export async function docxToHtml(file: File | Blob | ArrayBuffer): Promise<string> {
  assertOoxmlInputSize(file);
  const zip = await JSZip.loadAsync(file as Blob);
  const reader = new OoxmlPackageReader(zip);

  const docXml = await reader.text("word/document.xml");
  if (!docXml) {
    throw new Error("Invalid DOCX: missing word/document.xml");
  }

  const ctx: DocxCtx = {
    reader,
    doc: parseXml(docXml),
    partPath: "word/document.xml",
    rels: new Map(),
    theme: { colors: {}, majorFont: "Calibri Light", minorFont: "Calibri" },
    styles: new Map(),
    defaultStyles: {},
    docDefaultRPr: undefined,
    docDefaultPPr: undefined,
    numbering: new Map(),
    listCounters: new Map(),
    mediaCache: new Map(),
    footnotes: new Map(),
    endnotes: new Map(),
    comments: new Map(),
    fnRefs: [],
    enRefs: [],
    commentRefs: [],
    sections: [],
    renderSectionIndex: 0,
    evenAndOddHeaders: false,
  };

  // Independent parts — overlap the zip reads/parses
  await Promise.all([
    loadDocxRels(ctx),
    loadDocxTheme(ctx),
    loadStyles(ctx),
    loadNumbering(ctx),
    loadDocxNotes(ctx),
    loadDocxComments(ctx),
    loadDocxSettings(ctx),
  ]);
  // Section furniture needs the document relationships resolved first.
  await loadDocxSections(ctx);

  return renderDocument(ctx);
}

// ============================================================================
// Context & part loading
// ============================================================================

interface NumLevel {
  numFmt: string;
  lvlText: string;
  start: number;
  rPr?: Element;
  pPr?: Element;
}

interface NumDef {
  abstractId: string;
  levels: Map<number, NumLevel>;
}

interface DocxCtx {
  reader: OoxmlPackageReader;
  doc: Document;
  partPath: string;
  rels: Map<string, Rel>;
  theme: OoxmlTheme;
  /** styleId → style element */
  styles: Map<string, Element>;
  /** default style per type (paragraph / character / table) */
  defaultStyles: Record<string, Element | undefined>;
  docDefaultRPr: Element | undefined;
  docDefaultPPr: Element | undefined;
  /** numId → definition */
  numbering: Map<string, NumDef>;
  /** abstractNumId → per-level counters */
  listCounters: Map<string, number[]>;
  /** media part path → data URL */
  mediaCache: Map<string, string>;
  /** footnote / endnote id → note story (separators excluded) */
  footnotes: Map<string, NotePart>;
  endnotes: Map<string, NotePart>;
  comments: Map<string, CommentPart>;
  /** references in document order → assigned display number */
  fnRefs: { id: string; num: number }[];
  enRefs: { id: string; num: number }[];
  commentRefs: { id: string; num: number }[];
  sections: DocxSection[];
  renderSectionIndex: number;
  evenAndOddHeaders: boolean;
}

interface HeaderFooter {
  doc: Document;
  rels: Map<string, Rel>;
  partPath: string;
}

interface NotePart {
  element: Element;
  rels: Map<string, Rel>;
  partPath: string;
}

interface CommentPart extends NotePart {
  author: string;
  date: string;
}

interface DocxSection {
  pageWidth: number;
  pageHeight: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  headerDistance: number;
  footerDistance: number;
  reserveHeader: boolean;
  reserveFooter: boolean;
  docGridType: string;
  docGridLinePitch: number;
  headers: Map<string, HeaderFooter>;
  footers: Map<string, HeaderFooter>;
  titlePage: boolean;
  breakType: "continuous" | "nextColumn" | "nextPage" | "evenPage" | "oddPage";
}

function sectionLength(
  element: Element | undefined,
  attribute: string,
  inherited: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const twips = intAttr(element, attribute);
  const value = twips === undefined ? (inherited ?? fallback) : twipToPx(twips);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : fallback));
}

async function loadDocxRels(ctx: DocxCtx): Promise<void> {
  const xml = await ctx.reader.text(relsPathFor("word/document.xml"));
  if (!xml) return;
  ctx.rels = parseRels(xml);
}

async function loadDocxTheme(ctx: DocxCtx): Promise<void> {
  const xml = await ctx.reader.text("word/theme/theme1.xml");
  if (!xml) return;
  ctx.theme = parseThemeDoc(parseXml(xml));
}

async function loadDocxSettings(ctx: DocxCtx): Promise<void> {
  const xml = await ctx.reader.text("word/settings.xml");
  if (!xml) return;
  const settings = parseXml(xml, "word/settings.xml");
  ctx.evenAndOddHeaders = onOff(settings.getElementsByTagName("w:evenAndOddHeaders")[0]) ?? false;
}

async function loadStyles(ctx: DocxCtx): Promise<void> {
  const xml = await ctx.reader.text("word/styles.xml");
  if (!xml) return;
  const doc = parseXml(xml);

  const docDefaults = doc.getElementsByTagName("w:docDefaults")[0];
  ctx.docDefaultRPr = descend(docDefaults, "w:rPrDefault", "w:rPr");
  ctx.docDefaultPPr = descend(docDefaults, "w:pPrDefault", "w:pPr");

  for (const style of doc.getElementsByTagName("w:style")) {
    const id = style.getAttribute("w:styleId");
    if (id) ctx.styles.set(id, style);
    if (style.getAttribute("w:default") === "1" || style.getAttribute("w:default") === "true") {
      const type = style.getAttribute("w:type") || "paragraph";
      ctx.defaultStyles[type] = style;
    }
  }
}

async function loadNumbering(ctx: DocxCtx): Promise<void> {
  const xml = await ctx.reader.text("word/numbering.xml");
  if (!xml) return;
  const doc = parseXml(xml);

  const abstracts = new Map<string, Map<number, NumLevel>>();
  for (const abs of doc.getElementsByTagName("w:abstractNum")) {
    const id = abs.getAttribute("w:abstractNumId");
    if (!id) continue;
    const levels = new Map<number, NumLevel>();
    for (const lvl of childList(abs, "w:lvl")) {
      const ilvl = intAttr(lvl, "w:ilvl") ?? 0;
      levels.set(ilvl, {
        numFmt: child(lvl, "w:numFmt")?.getAttribute("w:val") || "decimal",
        lvlText: child(lvl, "w:lvlText")?.getAttribute("w:val") || "%1.",
        start: intAttr(child(lvl, "w:start"), "w:val") ?? 1,
        rPr: child(lvl, "w:rPr"),
        pPr: child(lvl, "w:pPr"),
      });
    }
    abstracts.set(id, levels);
  }

  for (const num of doc.getElementsByTagName("w:num")) {
    const numId = num.getAttribute("w:numId");
    const absId = child(num, "w:abstractNumId")?.getAttribute("w:val");
    if (!numId || absId == null) continue;
    const levels = new Map(abstracts.get(absId) ?? []);
    // Level overrides (e.g. restart values)
    for (const ovr of childList(num, "w:lvlOverride")) {
      const ilvl = intAttr(ovr, "w:ilvl") ?? 0;
      const startOverride = intAttr(child(ovr, "w:startOverride"), "w:val");
      const lvlEl = child(ovr, "w:lvl");
      const existing = levels.get(ilvl);
      if (lvlEl) {
        levels.set(ilvl, {
          numFmt: child(lvlEl, "w:numFmt")?.getAttribute("w:val") || existing?.numFmt || "decimal",
          lvlText: child(lvlEl, "w:lvlText")?.getAttribute("w:val") || existing?.lvlText || "%1.",
          start: intAttr(child(lvlEl, "w:start"), "w:val") ?? existing?.start ?? 1,
          rPr: child(lvlEl, "w:rPr") ?? existing?.rPr,
          pPr: child(lvlEl, "w:pPr") ?? existing?.pPr,
        });
      } else if (existing && startOverride != null) {
        levels.set(ilvl, { ...existing, start: startOverride });
      }
    }
    ctx.numbering.set(numId, { abstractId: absId, levels });
  }
}

async function loadDocxMedia(ctx: DocxCtx, path: string): Promise<string | undefined> {
  return loadMediaDataUrl(ctx.reader, ctx.mediaCache, path);
}

/** Load footnotes.xml / endnotes.xml. Separator notes (which carry a w:type)
 *  are skipped — only real notes are indexed by id. */
async function loadDocxNotes(ctx: DocxCtx): Promise<void> {
  const load = async (file: string, tag: string, map: Map<string, NotePart>): Promise<void> => {
    const xml = await ctx.reader.text(file);
    if (!xml) return;
    const relsXml = await ctx.reader.text(relsPathFor(file));
    const rels = relsXml ? parseRels(relsXml) : new Map<string, Rel>();
    for (const note of parseXml(xml).getElementsByTagName(tag)) {
      const id = note.getAttribute("w:id");
      // Real notes have no w:type; separator/continuationSeparator/notice do.
      if (id && !note.getAttribute("w:type")) map.set(id, { element: note, rels, partPath: file });
    }
  };
  await Promise.all([
    load("word/footnotes.xml", "w:footnote", ctx.footnotes),
    load("word/endnotes.xml", "w:endnote", ctx.endnotes),
  ]);
}

async function loadDocxComments(ctx: DocxCtx): Promise<void> {
  const file = "word/comments.xml";
  const xml = await ctx.reader.text(file);
  if (!xml) return;
  const relsXml = await ctx.reader.text(relsPathFor(file));
  const rels = relsXml ? parseRels(relsXml) : new Map<string, Rel>();
  for (const comment of parseXml(xml, file).getElementsByTagName("w:comment")) {
    const id = comment.getAttribute("w:id");
    if (id == null) continue;
    ctx.comments.set(id, {
      element: comment,
      rels,
      partPath: file,
      author: comment.getAttribute("w:author") ?? "",
      date: comment.getAttribute("w:date") ?? "",
    });
  }
}

/** Load page geometry and inherited header/footer references for every section. */
async function loadDocxSections(ctx: DocxCtx): Promise<void> {
  const body = descend(ctx.doc.documentElement, "w:body");
  const sectPrs: Element[] = [];
  const collect = (parent: Element): void => {
    for (const block of parent.children) {
      if (block.tagName === "w:p") {
        const sectPr = descend(block, "w:pPr", "w:sectPr");
        if (sectPr) sectPrs.push(sectPr);
      } else if (block.tagName === "w:sdt") {
        const content = child(block, "w:sdtContent");
        if (content) collect(content);
      }
    }
  };
  if (body) {
    collect(body);
    const finalSection = child(body, "w:sectPr");
    if (finalSection) sectPrs.push(finalSection);
  }
  const parts = new Map<string, Promise<HeaderFooter | undefined>>();
  const loadPart = (partPath: string): Promise<HeaderFooter | undefined> => {
    const cached = parts.get(partPath);
    if (cached) return cached;
    const pending = (async () => {
      const xml = await ctx.reader.text(partPath);
      if (!xml) return undefined;
      const relsXml = await ctx.reader.text(relsPathFor(partPath));
      return { doc: parseXml(xml, partPath), rels: relsXml ? parseRels(relsXml) : new Map(), partPath };
    })();
    parts.set(partPath, pending);
    return pending;
  };

  let previous: DocxSection | undefined;
  for (const sectPr of sectPrs.length ? sectPrs : [undefined]) {
    const pgSz = child(sectPr, "w:pgSz");
    const pgMar = child(sectPr, "w:pgMar");
    const docGrid = child(sectPr, "w:docGrid");
    const headers = new Map(previous?.headers);
    const footers = new Map(previous?.footers);

    const loadReferences = async (tag: string, store: Map<string, HeaderFooter>): Promise<void> => {
      for (const ref of childList(sectPr, tag)) {
        const type = ref.getAttribute("w:type") || "default";
        const rId = getRId(ref, "id");
        const rel = rId ? ctx.rels.get(rId) : undefined;
        if (!rel || rel.external) continue;
        const partPath = resolveTarget("word/document.xml", rel.target);
        const loaded = partPath ? await loadPart(partPath) : undefined;
        if (loaded) store.set(type, loaded);
      }
    };
    await Promise.all([loadReferences("w:headerReference", headers), loadReferences("w:footerReference", footers)]);

    const pageWidth = sectionLength(pgSz, "w:w", previous?.pageWidth, 816, 96, 8_192);
    const pageHeight = sectionLength(pgSz, "w:h", previous?.pageHeight, 1_056, 96, 8_192);
    const topTwips = intAttr(pgMar, "w:top");
    const bottomTwips = intAttr(pgMar, "w:bottom");
    const marginTop =
      topTwips === undefined ? (previous?.marginTop ?? 96) : Math.min(Math.abs(twipToPx(topTwips)), pageHeight * 0.45);
    const marginBottom =
      bottomTwips === undefined
        ? (previous?.marginBottom ?? 96)
        : Math.min(Math.abs(twipToPx(bottomTwips)), pageHeight * 0.45);
    const rawBreakType = child(sectPr, "w:type")?.getAttribute("w:val") ?? "nextPage";
    const breakType = (["continuous", "nextColumn", "nextPage", "evenPage", "oddPage"] as const).includes(
      rawBreakType as DocxSection["breakType"],
    )
      ? (rawBreakType as DocxSection["breakType"])
      : "nextPage";
    const section: DocxSection = {
      pageWidth,
      pageHeight,
      marginTop,
      marginRight: sectionLength(pgMar, "w:right", previous?.marginRight, 96, 0, pageWidth * 0.45),
      marginBottom,
      marginLeft: sectionLength(pgMar, "w:left", previous?.marginLeft, 96, 0, pageWidth * 0.45),
      headerDistance: sectionLength(pgMar, "w:header", previous?.headerDistance, 48, 0, pageHeight * 0.45),
      footerDistance: sectionLength(pgMar, "w:footer", previous?.footerDistance, 48, 0, pageHeight * 0.45),
      reserveHeader: topTwips === undefined ? (previous?.reserveHeader ?? true) : topTwips >= 0,
      reserveFooter: bottomTwips === undefined ? (previous?.reserveFooter ?? true) : bottomTwips >= 0,
      docGridType: docGrid?.getAttribute("w:type") ?? previous?.docGridType ?? "default",
      docGridLinePitch: sectionLength(docGrid, "w:linePitch", previous?.docGridLinePitch, 0, 0, pageHeight),
      headers,
      footers,
      titlePage: !!child(sectPr, "w:titlePg") && onOff(child(sectPr, "w:titlePg")) !== false,
      breakType,
    };
    ctx.sections.push(section);
    previous = section;
  }
}

type NoteKind = "fn" | "en";

/** Assign (or reuse) a sequential display number for a note reference, in
 *  document order. Footnotes use arabic, endnotes lower-roman (Word defaults). */
function assignNote(ctx: DocxCtx, kind: NoteKind, id: string): number {
  const refs = kind === "fn" ? ctx.fnRefs : ctx.enRefs;
  const existing = refs.find((r) => r.id === id);
  if (existing) return existing.num;
  const num = refs.length + 1;
  refs.push({ id, num });
  return num;
}

function noteLabel(kind: NoteKind, num: number): string {
  return kind === "en" ? toRoman(num).toLowerCase() : String(num);
}

function assignComment(ctx: DocxCtx, id: string): number {
  const existing = ctx.commentRefs.find((reference) => reference.id === id);
  if (existing) return existing.num;
  const num = ctx.commentRefs.length + 1;
  ctx.commentRefs.push({ id, num });
  return num;
}

// ============================================================================
// Style chains
// ============================================================================

/** Style element chain from leaf to root following w:basedOn. */
function styleChain(ctx: DocxCtx, styleId: string | undefined): Element[] {
  const chain: Element[] = [];
  const seen = new Set<string>();
  let id = styleId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const style = ctx.styles.get(id);
    if (!style) break;
    chain.push(style);
    id = child(style, "w:basedOn")?.getAttribute("w:val") ?? undefined;
  }
  return chain;
}

/** Run-property lookup chain: direct rPr → char style → para style → defaults. */
function buildRPrChain(ctx: DocxCtx, rPr: Element | undefined, pStyleId: string | undefined): Element[] {
  const chain: Element[] = [];
  if (rPr) chain.push(rPr);

  const rStyleId = child(rPr, "w:rStyle")?.getAttribute("w:val") ?? undefined;
  for (const s of styleChain(ctx, rStyleId)) {
    const sRPr = child(s, "w:rPr");
    if (sRPr) chain.push(sRPr);
  }
  for (const s of styleChain(ctx, pStyleId)) {
    const sRPr = child(s, "w:rPr");
    if (sRPr) chain.push(sRPr);
  }
  const defP = ctx.defaultStyles.paragraph;
  if (defP && !pStyleId) {
    const sRPr = child(defP, "w:rPr");
    if (sRPr) chain.push(sRPr);
  }
  if (ctx.docDefaultRPr) chain.push(ctx.docDefaultRPr);
  return chain;
}

/** Paragraph-property lookup chain: direct pPr → para style chain → defaults. */
function buildPPrChain(ctx: DocxCtx, pPr: Element | undefined): { chain: Element[]; pStyleId?: string } {
  const chain: Element[] = [];
  if (pPr) chain.push(pPr);
  const pStyleId = child(pPr, "w:pStyle")?.getAttribute("w:val") ?? undefined;
  for (const s of styleChain(ctx, pStyleId)) {
    const sPPr = child(s, "w:pPr");
    if (sPPr) chain.push(sPPr);
  }
  const defP = ctx.defaultStyles.paragraph;
  if (defP && !pStyleId) {
    const sPPr = child(defP, "w:pPr");
    if (sPPr) chain.push(sPPr);
  }
  if (ctx.docDefaultPPr) chain.push(ctx.docDefaultPPr);
  return { chain, pStyleId };
}

function chainChild(chain: (Element | undefined)[], name: string): Element | undefined {
  for (const el of chain) {
    const c = child(el, name);
    if (c) return c;
  }
  return undefined;
}

/** Word on/off properties: presence = on unless w:val says otherwise. */
function onOff(el: Element | undefined): boolean | undefined {
  if (!el) return undefined;
  const v = el.getAttribute("w:val");
  if (v == null) return true;
  return !(v === "0" || v === "false" || v === "none" || v === "off");
}

function chainOnOff(chain: (Element | undefined)[], name: string): boolean {
  for (const el of chain) {
    const c = child(el, name);
    if (c) return onOff(c) ?? true;
  }
  return false;
}

function chainOnOffValue(chain: (Element | undefined)[], name: string): boolean | undefined {
  for (const el of chain) {
    const c = child(el, name);
    if (c) return onOff(c) ?? true;
  }
  return undefined;
}

// ============================================================================
// Colors
// ============================================================================

const WORD_THEME_SLOTS: Record<string, string> = {
  dark1: "dk1",
  light1: "lt1",
  dark2: "dk2",
  light2: "lt2",
  text1: "dk1",
  background1: "lt1",
  text2: "dk2",
  background2: "lt2",
  accent1: "accent1",
  accent2: "accent2",
  accent3: "accent3",
  accent4: "accent4",
  accent5: "accent5",
  accent6: "accent6",
  hyperlink: "hlink",
  followedHyperlink: "folHlink",
};

/**
 * Resolve a Word color-carrying element (w:color, w:shd via fill attrs, …):
 * explicit hex `w:val`, or `w:themeColor` (+ tint/shade as 00–FF hex factors).
 */
function wordColor(
  el: Element | undefined,
  ctx: DocxCtx,
  valAttr = "w:val",
  themeAttr = "w:themeColor",
): string | undefined {
  if (!el) return undefined;
  const themeColor = el.getAttribute(themeAttr);
  if (themeColor) {
    const slot = WORD_THEME_SLOTS[themeColor] || themeColor;
    let hex = normalizeHexColor(ctx.theme.colors[slot]);
    if (hex) {
      const tint = el.getAttribute(`${themeAttr.replace("Color", "")}Tint`) || el.getAttribute("w:themeTint");
      const shade = el.getAttribute(`${themeAttr.replace("Color", "")}Shade`) || el.getAttribute("w:themeShade");
      if (tint && /^[0-9a-f]{2}$/i.test(tint)) hex = mixHex(hex, parseInt(tint, 16) / 255, true);
      else if (shade && /^[0-9a-f]{2}$/i.test(shade)) hex = mixHex(hex, parseInt(shade, 16) / 255, false);
      return `#${hex}`;
    }
  }
  const val = normalizeHexColor(el.getAttribute(valAttr));
  if (val) return `#${val}`;
  return undefined;
}

const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: "#FFFF00",
  green: "#00FF00",
  cyan: "#00FFFF",
  magenta: "#FF00FF",
  blue: "#0000FF",
  red: "#FF0000",
  darkBlue: "#00008B",
  darkCyan: "#008B8B",
  darkGreen: "#006400",
  darkMagenta: "#8B008B",
  darkRed: "#8B0000",
  darkYellow: "#808000",
  darkGray: "#A9A9A9",
  lightGray: "#D3D3D3",
  black: "#000000",
  white: "#FFFFFF",
};

// ============================================================================
// Borders
// ============================================================================

/** Convert a Word border element (w:top, w:left, …) to CSS, or "none". */
function borderCss(el: Element | undefined, ctx: DocxCtx): string | undefined {
  if (!el) return undefined;
  const val = el.getAttribute("w:val");
  if (!val || val === "nil" || val === "none") return "none";
  // sz is in eighths of a point
  const w = Math.max(((intAttr(el, "w:sz") ?? 4) / 8) * (96 / 72), 0.75);
  const color = wordColor(el, ctx, "w:color") ?? "#000000";
  let style = "solid";
  if (val.includes("dash")) style = "dashed";
  else if (val.includes("dot")) style = "dotted";
  else if (val === "double") style = "double";
  return `${px(w)} ${style} ${color}`;
}

// ============================================================================
// Run rendering
// ============================================================================

function runStyles(ctx: DocxCtx, chain: (Element | undefined)[]): string[] {
  const styles: string[] = [];

  const szHalfPt = intAttr(chainChild(chain, "w:sz"), "w:val");
  if (szHalfPt) styles.push(`font-size:${px(ptToPx(szHalfPt / 2))}`);

  if (chainOnOff(chain, "w:b")) styles.push("font-weight:bold");
  if (chainOnOff(chain, "w:i")) styles.push("font-style:italic");

  const deco: string[] = [];
  const u = chainChild(chain, "w:u");
  const uVal = u?.getAttribute("w:val");
  if (u && uVal !== "none") deco.push("underline");
  if (chainOnOff(chain, "w:strike") || chainOnOff(chain, "w:dstrike")) deco.push("line-through");
  if (deco.length) {
    styles.push(`text-decoration:${deco.join(" ")}`);
    if (uVal === "double") styles.push("text-decoration-style:double");
    else if (uVal === "dotted") styles.push("text-decoration-style:dotted");
    else if (uVal?.includes("dash")) styles.push("text-decoration-style:dashed");
    else if (uVal === "wave") styles.push("text-decoration-style:wavy");
    // Underline can carry its own color (text-decoration-color).
    const uColor = wordColor(u, ctx, "w:color");
    if (uColor && deco.includes("underline")) styles.push(`text-decoration-color:${uColor}`);
  }

  const color = wordColor(chainChild(chain, "w:color"), ctx);
  if (color) styles.push(`color:${color}`);

  const highlight = chainChild(chain, "w:highlight")?.getAttribute("w:val");
  if (highlight && HIGHLIGHT_COLORS[highlight]) styles.push(`background-color:${HIGHLIGHT_COLORS[highlight]}`);
  else {
    // Run shading: theme fill (w:themeFill) or explicit w:fill.
    const shFill = wordColor(chainChild(chain, "w:shd"), ctx, "w:fill", "w:themeFill");
    if (shFill) styles.push(`background-color:${shFill}`);
  }

  // Font: ascii → hAnsi typeface, then their theme variants (major/minor).
  const rFonts = chainChild(chain, "w:rFonts");
  let font = rFonts?.getAttribute("w:ascii") || rFonts?.getAttribute("w:hAnsi") || "";
  const themeFont = rFonts?.getAttribute("w:asciiTheme") || rFonts?.getAttribute("w:hAnsiTheme");
  if (!font && themeFont) {
    font = themeFont.startsWith("major") ? ctx.theme.majorFont : ctx.theme.minorFont;
  }
  if (font) styles.push(`font-family:${cssFontStack(font)}`);

  const vertAlign = chainChild(chain, "w:vertAlign")?.getAttribute("w:val");
  if (vertAlign === "superscript") styles.push("vertical-align:super;font-size:0.7em");
  else if (vertAlign === "subscript") styles.push("vertical-align:sub;font-size:0.7em");

  // Raised/lowered text (w:position, half-points; positive = raised).
  const position = intAttr(chainChild(chain, "w:position"), "w:val");
  if (position) styles.push("position:relative", `bottom:${px(ptToPx(position / 2))}`);

  if (chainOnOff(chain, "w:caps")) styles.push("text-transform:uppercase");
  else if (chainOnOff(chain, "w:smallCaps")) styles.push("font-variant:small-caps");

  const spacing = intAttr(chainChild(chain, "w:spacing"), "w:val");
  if (spacing) styles.push(`letter-spacing:${px(twipToPx(spacing))}`);

  if (chainOnOff(chain, "w:vanish")) styles.push("display:none");

  return styles;
}

/** Private-use marker for a tab character, resolved during paragraph assembly. */
const TAB_SENTINEL = "\uE000";
/** Internal-only marker. Authored text is HTML-escaped before paragraph assembly. */
const PAGE_BREAK_SENTINEL = "<!--ooxml-authored-page-break-->";

async function renderRun(ctx: DocxCtx, r: Element, pStyleId: string | undefined): Promise<string> {
  const rPr = child(r, "w:rPr");
  const chain = buildRPrChain(ctx, rPr, pStyleId);
  const styles = runStyles(ctx, chain);

  const parts: string[] = [];
  for (const node of r.children) {
    switch (node.tagName) {
      case "w:t":
        parts.push(escapeHtml(node.textContent ?? ""));
        break;
      case "w:br": {
        const type = node.getAttribute("w:type");
        if (type === "page" || type === "column") parts.push(PAGE_BREAK_SENTINEL);
        else parts.push("<br/>");
        break;
      }
      case "w:lastRenderedPageBreak":
        // Cached output from a previous layout producer, not an authored break.
        break;
      case "w:cr":
        parts.push("<br/>");
        break;
      case "w:tab":
        // Sentinel — the paragraph turns these into fixed spacers or, for
        // TOC/index-style tab stops, flex segments with leaders.
        parts.push(TAB_SENTINEL);
        break;
      case "w:noBreakHyphen":
        parts.push("&#8209;");
        break;
      case "w:sym": {
        const charHex = node.getAttribute("w:char") || "B7";
        const font = node.getAttribute("w:font") || "";
        parts.push(escapeHtml(mapBulletChar(String.fromCharCode(parseInt(charHex, 16)), font)));
        break;
      }
      case "w:drawing":
        parts.push(await renderDrawing(ctx, node));
        break;
      case "w:pict":
        parts.push(await renderLegacyPict(ctx, node));
        break;
      case "w:footnoteReference":
      case "w:endnoteReference": {
        const kind: NoteKind = node.tagName === "w:endnoteReference" ? "en" : "fn";
        const id = node.getAttribute("w:id") ?? "";
        const notes = kind === "fn" ? ctx.footnotes : ctx.endnotes;
        if (!notes.has(id)) break; // separator/unknown — nothing to link
        const num = assignNote(ctx, kind, id);
        const lbl = noteLabel(kind, num);
        parts.push(
          `<sup class="noteref"><a id="${kind}ref-${num}" data-note-key="${kind}-${num}" href="#${kind}-${num}">${lbl}</a></sup>`,
        );
        break;
      }
      case "w:commentReference": {
        const id = node.getAttribute("w:id") ?? "";
        const comment = ctx.comments.get(id);
        if (!comment) break;
        const num = assignComment(ctx, id);
        const label = comment.author ? `Comment ${num} by ${comment.author}` : `Comment ${num}`;
        parts.push(
          `<sup class="commentref"><a id="commentref-${num}" href="#comment-${num}" title="${escapeHtml(label)}">${num}</a></sup>`,
        );
        break;
      }
    }
  }

  const text = parts.join("");
  if (!text) return "";
  // A tab-only run returns bare sentinels so the paragraph can split on them
  // for tab-stop layout without breaking span nesting.
  if (parts.every((p) => p === TAB_SENTINEL)) return text;
  if (!styles.length) return text;
  return text
    .split(PAGE_BREAK_SENTINEL)
    .map((part) => (part ? `<span style="${styles.join(";")};">${part}</span>` : ""))
    .join(PAGE_BREAK_SENTINEL);
}

// ============================================================================
// Images
// ============================================================================

/** Resolve a DrawingML color container (a:solidFill / a:ln) to CSS. Handles
 *  srgbClr and schemeClr (mapped to the document theme). */
function dmlSolidColor(fill: Element | undefined, ctx: DocxCtx): string | undefined {
  if (!fill) return undefined;
  const srgb = fill.getElementsByTagName("a:srgbClr")[0];
  if (srgb) {
    const v = normalizeHexColor(srgb.getAttribute("val"));
    if (v) return `#${v}`;
  }
  const sch = fill.getElementsByTagName("a:schemeClr")[0];
  if (sch) {
    const v = sch.getAttribute("val") || "";
    const slot = ({ tx1: "dk1", bg1: "lt1", tx2: "dk2", bg2: "lt2" } as Record<string, string>)[v] || v;
    const hex = normalizeHexColor(ctx.theme.colors[slot]);
    if (hex) return `#${hex}`;
  }
  return undefined;
}

function boundedEmuPx(value: number | undefined, maximum = 8_192): number {
  const converted = emuToPx(value ?? 0);
  return Number.isFinite(converted) ? Math.max(0, Math.min(converted, maximum)) : 0;
}

/** Approximate Word's anchored-object placement with native HTML float and
 * absolute-positioning primitives. Square/tight wrapping maps well to floats;
 * page/margin anchored no-wrap objects retain authored offsets and z-order. */
function drawingPlacementStyles(container: Element, width = 0, availableWidth = 0): string[] {
  if (container.tagName !== "wp:anchor") return ["vertical-align:middle"];

  const positionH = child(container, "wp:positionH");
  const positionV = child(container, "wp:positionV");
  const horizontal = child(positionH, "wp:align")?.textContent?.trim() ?? "";
  const vertical = child(positionV, "wp:align")?.textContent?.trim() ?? "";
  const relativeH = positionH?.getAttribute("relativeFrom") ?? "column";
  const relativeV = positionV?.getAttribute("relativeFrom") ?? "paragraph";
  const offsetH = boundedEmuPx(Number.parseInt(child(positionH, "wp:posOffset")?.textContent ?? "", 10), 16_384);
  const offsetV = boundedEmuPx(Number.parseInt(child(positionV, "wp:posOffset")?.textContent ?? "", 10), 16_384);
  const distanceTop = boundedEmuPx(intAttr(container, "distT"), 1_024);
  const distanceRight = boundedEmuPx(intAttr(container, "distR"), 1_024);
  const distanceBottom = boundedEmuPx(intAttr(container, "distB"), 1_024);
  const distanceLeft = boundedEmuPx(intAttr(container, "distL"), 1_024);
  const wrapTopBottom = !!child(container, "wp:wrapTopAndBottom");
  const wrapsText =
    !!child(container, "wp:wrapSquare") || !!child(container, "wp:wrapTight") || !!child(container, "wp:wrapThrough");
  const noWrap = !!child(container, "wp:wrapNone") || (!wrapTopBottom && !wrapsText);
  const behind = container.getAttribute("behindDoc") === "1" || container.getAttribute("behindDoc") === "true";
  const styles = [
    `margin:${px(distanceTop)} ${px(distanceRight)} ${px(distanceBottom)} ${px(distanceLeft)}`,
    `z-index:${behind ? 0 : Math.max(2, Math.min(2_000, 2 + (intAttr(container, "relativeHeight") ?? 0)))}`,
  ];

  const pagePositioned =
    (relativeH === "page" || relativeH === "margin" || relativeH === "column") &&
    (relativeV === "page" || relativeV === "margin");
  if ((noWrap || behind) && pagePositioned) {
    styles.push("position:absolute");
    if (horizontal === "right" || horizontal === "outside") {
      styles.push(relativeH === "page" ? "right:calc(0px - var(--pg-margin-right))" : "right:0");
    } else if (horizontal === "center") {
      styles.push("left:50%", "transform:translateX(-50%)");
    } else {
      styles.push(relativeH === "page" ? `left:calc(${px(offsetH)} - var(--pg-margin-left))` : `left:${px(offsetH)}`);
    }
    if (vertical === "bottom" || vertical === "outside") {
      styles.push(relativeV === "page" ? "bottom:calc(0px - var(--body-bottom))" : "bottom:0");
    } else if (vertical === "center") {
      styles.push("top:50%");
    } else {
      styles.push(relativeV === "page" ? `top:calc(${px(offsetV)} - var(--body-top))` : `top:${px(offsetV)}`);
    }
    return styles;
  }

  if (wrapTopBottom) {
    styles.push("display:block", "clear:both", "margin-left:auto", "margin-right:auto");
  } else if (horizontal === "right" || horizontal === "outside") {
    styles.push("float:right");
  } else if (horizontal === "center") {
    styles.push("display:block", "clear:both", "margin-left:auto", "margin-right:auto");
  } else if (availableWidth > 0 && offsetH > Math.max(64, (availableWidth - width) / 2)) {
    // CSS floats cannot wrap on both sides of an explicitly positioned Word
    // anchor. A far-column offset is best represented as a right float; adding
    // that offset as a left margin would consume the left text band as margin
    // and incorrectly force following paragraphs below the picture.
    styles.push("float:right");
  } else {
    styles.push("float:left");
    if (offsetH) styles.push(`margin-left:${px(offsetH)}`);
  }
  return styles;
}

/** Render a DrawingML WordprocessingShape (text box / autoshape with text). */
async function renderWpShape(ctx: DocxCtx, container: Element, wsp: Element, w: number, h: number): Promise<string> {
  const spPr = wsp.getElementsByTagName("wps:spPr")[0] ?? child(wsp, "wps:spPr");

  // Fill (solid; gradient approximated by its first stop)
  let bg = dmlSolidColor(child(spPr, "a:solidFill"), ctx);
  if (!bg) bg = dmlSolidColor(descend(spPr, "a:gradFill", "a:gsLst"), ctx);
  const noFill = !!child(spPr, "a:noFill");

  // Outline
  const ln = child(spPr, "a:ln");
  let borderCssVal: string | undefined;
  if (ln && !child(ln, "a:noFill")) {
    const color = dmlSolidColor(child(ln, "a:solidFill"), ctx);
    if (color) {
      const wEmu = intAttr(ln, "w");
      const widthPx = Math.max(wEmu ? emuToPx(wEmu) : 1, 0.75);
      const dash = child(ln, "a:prstDash")?.getAttribute("val") || "";
      const style = dash.includes("dot") ? "dotted" : dash.includes("dash") ? "dashed" : "solid";
      borderCssVal = `${px(widthPx)} ${style} ${color}`;
    }
  }

  // Geometry → border-radius for round/ellipse
  const prst = descend(spPr, "a:prstGeom")?.getAttribute("prst");
  let radiusCss: string | undefined;
  if (prst === "ellipse") radiusCss = "border-radius:50%";
  else if (prst?.startsWith("round")) radiusCss = `border-radius:${px(Math.min(w, h) * 0.12 || 8)}`;

  // Body insets + vertical anchor
  const bodyPr = child(wsp, "wps:bodyPr");
  const lIns = emuToPx(intAttr(bodyPr, "lIns") ?? 91440);
  const rIns = emuToPx(intAttr(bodyPr, "rIns") ?? 91440);
  const tIns = emuToPx(intAttr(bodyPr, "tIns") ?? 45720);
  const bIns = emuToPx(intAttr(bodyPr, "bIns") ?? 45720);
  const anchor = bodyPr?.getAttribute("anchor");

  // Text content
  const content = wsp.getElementsByTagName("w:txbxContent")[0];
  let inner = "";
  if (content) {
    for (const blk of content.children) {
      if (blk.tagName === "w:p") inner += (await renderParagraph(ctx, blk)).html;
      else if (blk.tagName === "w:tbl") inner += await renderTable(ctx, blk);
    }
  }
  // A shape with neither text, fill nor outline isn't worth a box.
  if (!inner && !bg && !borderCssVal) return "";

  const isAnchor = container.tagName === "wp:anchor";
  const vCenter = anchor === "ctr" || anchor === "b";
  const styles = [`width:${px(w)}`, "box-sizing:border-box", "overflow:hidden"];
  if (h) styles.push(`min-height:${px(h)}`);
  styles.push(`padding:${px(tIns)} ${px(rIns)} ${px(bIns)} ${px(lIns)}`);
  if (bg && !noFill) styles.push(`background:${bg}`);
  if (borderCssVal) styles.push(`border:${borderCssVal}`);
  if (radiusCss) styles.push(radiusCss);

  if (vCenter) {
    styles.push(
      `display:${isAnchor ? "flex" : "inline-flex"}`,
      "flex-direction:column",
      `justify-content:${anchor === "ctr" ? "center" : "flex-end"}`,
    );
  } else {
    styles.push("display:inline-block", "vertical-align:top");
  }
  const section = ctx.sections[ctx.renderSectionIndex];
  const availableWidth = section ? section.pageWidth - section.marginLeft - section.marginRight : 0;
  styles.push(...drawingPlacementStyles(container, w, availableWidth));

  return `<div style="${styles.join(";")};">${inner}</div>`;
}

async function renderDrawing(ctx: DocxCtx, drawing: Element): Promise<string> {
  const container = child(drawing, "wp:inline") ?? child(drawing, "wp:anchor");
  if (!container) return "";

  const extent = child(container, "wp:extent");
  const w = boundedEmuPx(intAttr(extent, "cx"));
  const h = boundedEmuPx(intAttr(extent, "cy"));

  const graphicData = descend(container, "a:graphic", "a:graphicData");

  // Picture (a:blip)
  const blip = graphicData?.getElementsByTagName("a:blip")[0];
  if (blip) {
    const rId = getRId(blip);
    const rel = rId ? ctx.rels.get(rId) : undefined;
    if (rel && !rel.external) {
      const url = await loadDocxMedia(ctx, resolveTarget(ctx.partPath, rel.target));
      if (url) {
        const styles = [...(w ? [`width:${px(w)}`] : []), ...(h ? [`height:${px(h)}`] : [])];
        const section = ctx.sections[ctx.renderSectionIndex];
        const availableWidth = section ? section.pageWidth - section.marginLeft - section.marginRight : 0;
        styles.push(...drawingPlacementStyles(container, w, availableWidth));
        const docPr = child(container, "wp:docPr");
        const alt = docPr?.getAttribute("descr") || docPr?.getAttribute("title") || docPr?.getAttribute("name") || "";
        return `<img src="${url}" alt="${escapeHtml(alt)}" style="${styles.join(";")};"/>`;
      }
    }
  }

  // Text box / shape (wps:wsp)
  const wsp = graphicData?.getElementsByTagName("wps:wsp")[0];
  if (wsp) return renderWpShape(ctx, container, wsp, w, h);

  // Chart / diagram placeholder
  const uri = graphicData?.getAttribute("uri") || "";
  if (uri.includes("/chart") || uri.includes("/diagram")) {
    return (
      `<span style="display:inline-block;width:${px(w)};height:${px(h)};border:1px dashed #c0c0c0;` +
      `border-radius:4px;color:#909090;font-size:12px;text-align:center;line-height:${px(h)};">Chart</span>`
    );
  }
  return "";
}

async function renderLegacyPict(ctx: DocxCtx, pict: Element): Promise<string> {
  // VML text box (v:shape/v:rect/v:roundrect with a <v:textbox><w:txbxContent>)
  const txbxContent = pict.getElementsByTagName("w:txbxContent")[0];
  if (txbxContent) {
    const shape =
      pict.getElementsByTagName("v:shape")[0] ??
      pict.getElementsByTagName("v:rect")[0] ??
      pict.getElementsByTagName("v:roundrect")[0];
    const styleAttr = shape?.getAttribute("style") || "";
    const wMatch = styleAttr.match(/width:([\d.]+)pt/);
    const hMatch = styleAttr.match(/height:([\d.]+)pt/);
    const styles = ["display:inline-block", "vertical-align:top", "box-sizing:border-box", "padding:4px 6px"];
    if (wMatch) styles.push(`width:${px(ptToPx(parseFloat(wMatch[1])))}`);
    if (hMatch) styles.push(`min-height:${px(ptToPx(parseFloat(hMatch[1])))}`);
    const fill = sanitizeCssColor(shape?.getAttribute("fillcolor"));
    if (fill && shape?.getAttribute("filled") !== "f") styles.push(`background:${fill}`);
    if (shape?.getAttribute("stroked") !== "f") {
      const stroke = sanitizeCssColor(shape?.getAttribute("strokecolor")) || "#000000";
      const sw = shape?.getAttribute("strokeweight");
      const swPx = sw ? ptToPx(parseFloat(sw)) : 1;
      styles.push(`border:${px(Math.max(swPx, 0.75))} solid ${stroke}`);
    }
    if (shape?.tagName === "v:roundrect") styles.push("border-radius:8px");
    let inner = "";
    for (const blk of txbxContent.children) {
      if (blk.tagName === "w:p") inner += (await renderParagraph(ctx, blk)).html;
      else if (blk.tagName === "w:tbl") inner += await renderTable(ctx, blk);
    }
    return `<div style="${styles.join(";")};">${inner}</div>`;
  }

  const imagedata = pict.getElementsByTagName("v:imagedata")[0];
  const rId = getRId(imagedata, "id");
  const rel = rId ? ctx.rels.get(rId) : undefined;
  if (!rel || rel.external) return "";
  const url = await loadDocxMedia(ctx, resolveTarget(ctx.partPath, rel.target));
  if (!url) return "";

  // Size from the VML shape style ("width:123pt;height:45pt")
  const shape = pict.getElementsByTagName("v:shape")[0];
  const styleAttr = shape?.getAttribute("style") || "";
  const wMatch = styleAttr.match(/width:([\d.]+)pt/);
  const hMatch = styleAttr.match(/height:([\d.]+)pt/);
  const dims: string[] = [];
  if (wMatch) dims.push(`width:${px(ptToPx(parseFloat(wMatch[1])))}`);
  if (hMatch) dims.push(`height:${px(ptToPx(parseFloat(hMatch[1])))}`);

  return `<img src="${url}" alt="" style="${dims.join(";")};vertical-align:middle;"/>`;
}

// ============================================================================
// Numbering
// ============================================================================

function formatNumber(fmt: string, n: number): string {
  switch (fmt) {
    case "lowerLetter":
      return toAlpha(n);
    case "upperLetter":
      return toAlpha(n).toUpperCase();
    case "lowerRoman":
      return toRoman(n);
    case "upperRoman":
      return toRoman(n).toUpperCase();
    case "none":
      return "";
    default:
      return String(n);
  }
}

interface NumberingInfo {
  marker: string;
  markerStyles: string[];
  lvlPPr?: Element;
}

function resolveNumbering(ctx: DocxCtx, numId: string, ilvl: number): NumberingInfo | undefined {
  const def = ctx.numbering.get(numId);
  if (!def) return undefined;
  const lvl = def.levels.get(ilvl);
  if (!lvl) return undefined;

  let marker: string;
  const markerStyles: string[] = [];

  if (lvl.numFmt === "bullet") {
    const ch = lvl.lvlText || "•";
    const font = child(lvl.rPr, "w:rFonts")?.getAttribute("w:ascii") || "";
    marker = ch.length === 1 ? mapBulletChar(ch, font) : ch;
  } else {
    // Advance counters: increment this level, reset deeper ones. Keyed by numId
    // (the list instance) — two numIds sharing an abstractNum number independently.
    const counters = ctx.listCounters.get(numId) ?? [];
    for (let l = 0; l < ilvl; l++) {
      if (counters[l] == null) counters[l] = def.levels.get(l)?.start ?? 1;
    }
    counters[ilvl] = counters[ilvl] == null ? lvl.start : counters[ilvl] + 1;
    counters.length = ilvl + 1;
    ctx.listCounters.set(numId, counters);

    marker = lvl.lvlText.replace(/%(\d)/g, (_, d) => {
      const l = parseInt(d, 10) - 1;
      const fmt = def.levels.get(l)?.numFmt ?? "decimal";
      const value = counters[l] ?? def.levels.get(l)?.start ?? 1;
      return formatNumber(fmt, value);
    });
  }

  if (lvl.rPr) {
    if (chainOnOff([lvl.rPr], "w:b")) markerStyles.push("font-weight:bold");
    const color = wordColor(child(lvl.rPr, "w:color"), ctx);
    if (color) markerStyles.push(`color:${color}`);
  }

  return { marker, markerStyles, lvlPPr: lvl.pPr };
}

// ============================================================================
// Paragraph rendering
// ============================================================================

interface BlockResult {
  html: string;
  pageSegments: string[];
  pageBreakBefore?: boolean;
}

type PageField = "PAGE" | "NUMPAGES" | "SECTION" | "SECTIONPAGES";

function pageField(instruction: string): PageField | undefined {
  const name = instruction.trim().split(/\s+/u)[0]?.toUpperCase();
  return name === "PAGE" || name === "NUMPAGES" || name === "SECTION" || name === "SECTIONPAGES" ? name : undefined;
}

async function renderParagraph(ctx: DocxCtx, p: Element): Promise<BlockResult> {
  const pPr = child(p, "w:pPr");
  const { chain: pChain, pStyleId } = buildPPrChain(ctx, pPr);

  // Numbering (direct or via style)
  const numPr = chainChild(pChain, "w:numPr");
  const numId = child(numPr, "w:numId")?.getAttribute("w:val");
  const ilvl = intAttr(child(numPr, "w:ilvl"), "w:val") ?? 0;
  const numbering = numId && numId !== "0" ? resolveNumbering(ctx, numId, ilvl) : undefined;

  // Effective indentation: direct/style ind, falling back to the list level's
  const indChain = numbering?.lvlPPr ? [...pChain.slice(0, -1), numbering.lvlPPr, pChain[pChain.length - 1]] : pChain;
  const ind = chainChild(indChain, "w:ind");
  const left = intAttr(ind, "w:left") ?? intAttr(ind, "w:start") ?? 0;
  const right = intAttr(ind, "w:right") ?? intAttr(ind, "w:end") ?? 0;
  const hanging = intAttr(ind, "w:hanging") ?? 0;
  const firstLine = intAttr(ind, "w:firstLine") ?? 0;

  const styles: string[] = [];

  // Alignment
  const jc = chainChild(pChain, "w:jc")?.getAttribute("w:val");
  if (jc === "center") styles.push("text-align:center");
  else if (jc === "right" || jc === "end") styles.push("text-align:right");
  else if (jc === "both" || jc === "distribute") styles.push("text-align:justify");

  // Indents
  if (left) styles.push(`padding-left:${px(twipToPx(left))}`);
  if (right) styles.push(`padding-right:${px(twipToPx(right))}`);
  if (hanging) styles.push(`text-indent:${px(-twipToPx(hanging))}`);
  else if (firstLine) styles.push(`text-indent:${px(twipToPx(firstLine))}`);

  // Spacing. w:before/w:after are in twips; w:beforeAutospacing/afterAutospacing
  // override them with Word's automatic paragraph spacing (rendered ≈14px, the
  // value Word uses for HTML/"web"-style auto spacing).
  const spacing = chainChild(pChain, "w:spacing");
  const contextual = chainOnOff(pChain, "w:contextualSpacing");
  const isOn = (v: string | null) => v === "1" || v === "true" || v === "on";
  const autoBefore = isOn(spacing?.getAttribute("w:beforeAutospacing") ?? null);
  const autoAfter = isOn(spacing?.getAttribute("w:afterAutospacing") ?? null);
  const AUTO_SPACING_PX = 14;
  if (!contextual) {
    if (autoBefore) styles.push(`margin-top:${px(AUTO_SPACING_PX)}`);
    else {
      const before = intAttr(spacing, "w:before") ?? 0;
      if (before) styles.push(`margin-top:${px(twipToPx(before))}`);
    }
    if (autoAfter) styles.push(`margin-bottom:${px(AUTO_SPACING_PX)}`);
    else {
      const after = intAttr(spacing, "w:after") ?? 0;
      if (after) styles.push(`margin-bottom:${px(twipToPx(after))}`);
    }
  }

  const line = intAttr(spacing, "w:line");
  const lineRule = spacing?.getAttribute("w:lineRule");
  if (line) {
    if (lineRule === "exact" || lineRule === "atLeast") {
      styles.push(`line-height:${px(twipToPx(line))}`);
    } else {
      const section = ctx.sections[ctx.renderSectionIndex];
      const multiple = Math.max(0.05, Math.min(line / 240, 20));
      if (section?.docGridLinePitch && (section.docGridType === "lines" || section.docGridType === "linesAndChars")) {
        // With an active document line grid, Word multiplies against the grid
        // pitch rather than a large run's font size. This is crucial for cover
        // headings (for example 56pt at 4.33 lines), which would otherwise
        // consume hundreds of pixels and force false page breaks.
        styles.push(`line-height:${px(section.docGridLinePitch * multiple)}`);
      } else {
        styles.push(`line-height:${Math.round(multiple * 1000) / 1000}`);
      }
    }
  }

  // Shading & borders (theme fill or explicit fill)
  const shFill = wordColor(chainChild(pChain, "w:shd"), ctx, "w:fill", "w:themeFill");
  if (shFill) styles.push(`background-color:${shFill}`);

  const pBdr = chainChild(pChain, "w:pBdr");
  if (pBdr) {
    for (const [side, tag] of [
      ["top", "w:top"],
      ["bottom", "w:bottom"],
      ["left", "w:left"],
      ["right", "w:right"],
    ] as const) {
      const css = borderCss(child(pBdr, tag), ctx);
      if (css && css !== "none")
        styles.push(`border-${side}:${css}`, side === "top" || side === "bottom" ? `padding-${side}:4px` : "");
    }
  }

  // Default paragraph run styling (so empty paragraphs and the marker size right)
  const paraRPrChain = buildRPrChain(ctx, child(pPr, "w:rPr"), pStyleId);
  const paraRunStyles = runStyles(ctx, paraRPrChain);

  // Runs & inline content
  let html = "";

  // Complex fields keep their instruction and result phases separate. Retain
  // page-dependent fields as data so the paginator can update cloned headers
  // and footers after the final physical page count is known.
  const fieldStack: { instruction: string; inResult: boolean }[] = [];
  const appendResult = (value: string): void => {
    const current = fieldStack[fieldStack.length - 1];
    const kind = current?.inResult ? pageField(current.instruction) : undefined;
    html += kind
      ? value
          .split(PAGE_BREAK_SENTINEL)
          .map((part) => (part ? `<span data-docx-field="${kind}">${part}</span>` : ""))
          .join(PAGE_BREAK_SENTINEL)
      : value;
  };

  const walkInline = async (parent: Element): Promise<void> => {
    for (const node of parent.children) {
      switch (node.tagName) {
        case "w:r": {
          const fldChar = child(node, "w:fldChar");
          if (fldChar) {
            const type = fldChar.getAttribute("w:fldCharType");
            if (type === "begin") fieldStack.push({ instruction: "", inResult: false });
            else if (type === "separate") {
              const current = fieldStack[fieldStack.length - 1];
              if (current) current.inResult = true;
            } else if (type === "end") fieldStack.pop();
            break;
          }
          const current = fieldStack[fieldStack.length - 1];
          if (current && !current.inResult) {
            current.instruction += Array.from(node.getElementsByTagName("w:instrText"))
              .map((part) => part.textContent ?? "")
              .join("");
            break;
          }
          appendResult(await renderRun(ctx, node, pStyleId));
          break;
        }
        case "w:hyperlink": {
          const rId = getRId(node, "id");
          const rel = rId ? ctx.rels.get(rId) : undefined;
          let inner = "";
          for (const r of childList(node, "w:r")) {
            inner += await renderRun(ctx, r, pStyleId);
          }
          const safeHref = rel?.external ? sanitizeHyperlinkUrl(rel.target) : undefined;
          if (safeHref) {
            appendResult(
              inner
                .split(PAGE_BREAK_SENTINEL)
                .map((part) =>
                  part ? `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${part}</a>` : "",
                )
                .join(PAGE_BREAK_SENTINEL),
            );
          } else {
            appendResult(inner);
          }
          break;
        }
        case "w:fldSimple": {
          const kind = pageField(node.getAttribute("w:instr") ?? "");
          if (kind) html += `<span data-docx-field="${kind}">`;
          await walkInline(node);
          if (kind) html += "</span>";
          break;
        }
        case "w:smartTag":
        case "w:ins":
        case "w:moveTo":
          await walkInline(node);
          break;
        case "w:sdt": {
          const content = child(node, "w:sdtContent");
          if (content) await walkInline(content);
          break;
        }
        case "w:commentRangeStart": {
          const id = node.getAttribute("w:id") ?? "";
          if (ctx.comments.has(id)) {
            const num = assignComment(ctx, id);
            html += `<a class="comment-anchor" id="comment-anchor-${num}" href="#comment-${num}" aria-label="Comment ${num}"></a>`;
          }
          break;
        }
        case "w:commentRangeEnd":
          break;
        case "mc:AlternateContent": {
          // Prefer the modern DrawingML Choice (text boxes/shapes live here);
          // fall back to the legacy VML Fallback only if there's no Choice.
          const choice = child(node, "mc:Choice") ?? child(node, "mc:Fallback");
          if (choice) await walkInline(choice);
          break;
        }
        case "w:drawing":
          html += await renderDrawing(ctx, node);
          break;
        case "w:pict":
          html += await renderLegacyPict(ctx, node);
          break;
        case "m:oMathPara":
          html += `<span class="math-block">${ommlToMathml(node, true)}</span>`;
          break;
        case "m:oMath":
          html += ommlToMathml(node, false);
          break;
      }
    }
  };
  await walkInline(p);

  // Tabs: TOC/index-style tab stops (a leader, or right/center/decimal stops)
  // become a flex row whose tab gaps stretch and carry leader dots; everything
  // else keeps a simple fixed-width spacer.
  const resolveTabs = (content: string): string => {
    if (!content.includes(TAB_SENTINEL)) return content;
    const tabsEl = chainChild(pChain, "w:tabs");
    const stops = tabsEl
      ? childList(tabsEl, "w:tab")
          .map((t) => ({ val: t.getAttribute("w:val"), leader: t.getAttribute("w:leader") }))
          .filter((t) => t.val !== "clear")
      : [];
    const leaderStop = stops.find((t) => t.leader && t.leader !== "none");
    const advanced = !!leaderStop || stops.some((t) => t.val === "right" || t.val === "center" || t.val === "decimal");
    if (advanced) {
      const leaderCls =
        leaderStop?.leader === "underscore"
          ? " ld-u"
          : leaderStop?.leader === "hyphen"
            ? " ld-h"
            : leaderStop?.leader
              ? " ld-d"
              : "";
      const segs = content.split(TAB_SENTINEL);
      const inner = segs
        .map((s, i) => (i === 0 ? `<span>${s}</span>` : `<span class="tab-ld${leaderCls}"></span><span>${s}</span>`))
        .join("");
      return `<div class="tab-row">${inner}</div>`;
    }
    return content.split(TAB_SENTINEL).join('<span style="display:inline-block;min-width:36px;"></span>');
  };

  // List marker
  let markerHtml = "";
  if (numbering && html) {
    const markerWidth = hanging ? twipToPx(hanging) : 24;
    const ms = [...numbering.markerStyles, "display:inline-block", `min-width:${px(markerWidth)}`];
    markerHtml = `<span style="${ms.join(";")};">${escapeHtml(numbering.marker)}</span>`;
    if (!hanging) {
      // Give bullet lists a hanging layout even without explicit ind
      styles.push(`padding-left:${px(twipToPx(left) + markerWidth)}`, `text-indent:${px(-markerWidth)}`);
    }
  }

  const allStyles = [...paraRunStyles, ...styles].filter(Boolean);
  const keepNext = chainOnOff(pChain, "w:keepNext");
  const commonPaginationAttrs = [
    chainOnOff(pChain, "w:keepLines") ? ' data-keep-lines="1"' : "",
    chainOnOffValue(pChain, "w:widowControl") !== false ? ' data-widow-control="1"' : "",
  ].join("");
  const rawSegments = html.split(PAGE_BREAK_SENTINEL);
  const pageSegments = rawSegments.map((segment, index) => {
    const segmentStyles = [...allStyles];
    if (index > 0) segmentStyles.push("margin-top:0", "text-indent:0");
    if (index < rawSegments.length - 1) segmentStyles.push("margin-bottom:0");
    const styleAttr = segmentStyles.length ? ` style="${segmentStyles.join(";")};"` : "";
    const marker = index === 0 ? markerHtml : "";
    const keepNextAttr = keepNext && index === rawSegments.length - 1 ? ' data-keep-next="1"' : "";
    return `<div class="p"${keepNextAttr}${commonPaginationAttrs}${styleAttr}>${marker}${resolveTabs(segment) || "&nbsp;"}</div>`;
  });

  return {
    html: pageSegments.join(""),
    pageSegments,
    pageBreakBefore: chainOnOff(pChain, "w:pageBreakBefore"),
  };
}

// ============================================================================
// Table rendering
// ============================================================================

async function renderTable(ctx: DocxCtx, tbl: Element): Promise<string> {
  const tblPr = child(tbl, "w:tblPr");
  const tblStyleId = child(tblPr, "w:tblStyle")?.getAttribute("w:val") ?? undefined;
  const tblPrChain: (Element | undefined)[] = [tblPr, ...styleChain(ctx, tblStyleId).map((s) => child(s, "w:tblPr"))];

  const tblBorders = chainChild(tblPrChain, "w:tblBorders");
  const insideH = borderCss(child(tblBorders, "w:insideH"), ctx);
  const insideV = borderCss(child(tblBorders, "w:insideV"), ctx);

  // Default cell margins
  const cellMar = chainChild(tblPrChain, "w:tblCellMar");
  const defMar = {
    top: twipToPx(intAttr(child(cellMar, "w:top"), "w:w") ?? 0),
    left: twipToPx(intAttr(child(cellMar, "w:left"), "w:w") ?? 108),
    bottom: twipToPx(intAttr(child(cellMar, "w:bottom"), "w:w") ?? 0),
    right: twipToPx(intAttr(child(cellMar, "w:right"), "w:w") ?? 108),
  };

  const colWidths = childList(child(tbl, "w:tblGrid"), "w:gridCol").map((c) => twipToPx(intAttr(c, "w:w") ?? 0));
  const gridSum = colWidths.reduce((a, b) => a + b, 0);

  // Table width: explicit pct (value either "100%" or fiftieths of a
  // percent), explicit dxa, or the grid sum. Generators sometimes emit
  // placeholder grids (tiny widths) with a pct table width — use
  // proportional columns then.
  const tblW = chainChild(tblPrChain, "w:tblW");
  const tblWType = tblW?.getAttribute("w:type");
  const tblWRaw = tblW?.getAttribute("w:w") || "";
  let widthCss: string;
  if (tblWType === "pct") {
    let pct = parseFloat(tblWRaw) || 100;
    if (!tblWRaw.includes("%") && pct > 100) pct = pct / 50;
    widthCss = `width:${Math.min(pct, 100)}%;`;
  } else if (tblWType === "dxa" && parseFloat(tblWRaw) > 0) {
    widthCss = `width:${px(twipToPx(parseFloat(tblWRaw)))};max-width:100%;`;
  } else {
    widthCss = gridSum > 50 ? `width:${px(gridSum)};max-width:100%;` : "width:100%;";
  }
  const useProportional = tblWType === "pct" || gridSum <= 50;
  const colgroup = colWidths
    .map((w) => {
      if (useProportional && gridSum > 0) {
        return `<col style="width:${Math.round((w / gridSum) * 10000) / 100}%"/>`;
      }
      return `<col style="width:${px(w)}"/>`;
    })
    .join("");

  const rows = childList(tbl, "w:tr");

  // ── Table-style conditional formatting (ECMA-376 §17.7.6) ─────────────────
  // Built-in styles ("Light List - Accent 1", banded grids, …) keep their
  // header shading, banded-row fills, borders and fonts in styles.xml as a
  // base format plus w:tblStylePr conditional blocks. w:tblLook selects which
  // conditionals apply to each cell.
  const tblStyleChainArr = styleChain(ctx, tblStyleId); // leaf → root
  const numCols = colWidths.length;
  const lastRowIndex = rows.length - 1;

  const lookEl = chainChild(tblPrChain, "w:tblLook");
  const lookFlag = (name: string, bit: number, dflt: boolean): boolean => {
    const a = lookEl?.getAttribute(`w:${name}`);
    if (a != null) return a === "1" || a === "true";
    const valHex = lookEl?.getAttribute("w:val");
    if (valHex) return (parseInt(valHex, 16) & bit) !== 0;
    return dflt;
  };
  const look = {
    firstRow: lookFlag("firstRow", 0x0020, true),
    lastRow: lookFlag("lastRow", 0x0040, false),
    firstCol: lookFlag("firstColumn", 0x0080, true),
    lastCol: lookFlag("lastColumn", 0x0100, false),
    hBand: !lookFlag("noHBand", 0x0200, false),
    vBand: !lookFlag("noVBand", 0x0400, false),
  };
  const rowBand = intAttr(chainChild(tblPrChain, "w:tblStyleRowBandSize"), "w:val") || 1;
  const colBand = intAttr(chainChild(tblPrChain, "w:tblStyleColBandSize"), "w:val") || 1;

  /** w:tblStylePr blocks of a type across the style chain (leaf first); the
   *  whole table's base format is the style element itself. */
  const condBlocks = (type: string): Element[] => {
    const out: Element[] = [];
    for (const st of tblStyleChainArr) {
      if (type === "wholeTable") out.push(st);
      else for (const sp of childList(st, "w:tblStylePr")) if (sp.getAttribute("w:type") === type) out.push(sp);
    }
    return out;
  };

  /** Conditional types active for a cell, highest priority first. */
  const cellCondTypes = (ri: number, colIndex: number, gridSpan: number): string[] => {
    const fr = look.firstRow && ri === 0;
    const lr = look.lastRow && ri === lastRowIndex;
    const fc = look.firstCol && colIndex === 0;
    const lc = look.lastCol && colIndex + gridSpan >= numCols;
    const types: string[] = [];
    if (fr && fc) types.push("nwCell");
    if (fr && lc) types.push("neCell");
    if (lr && fc) types.push("swCell");
    if (lr && lc) types.push("seCell");
    if (fr) types.push("firstRow");
    if (lr) types.push("lastRow");
    if (fc) types.push("firstCol");
    if (lc) types.push("lastCol");
    if (look.hBand && !fr && !lr) {
      const ord = ri - (look.firstRow ? 1 : 0);
      types.push(Math.floor(ord / rowBand) % 2 === 0 ? "band1Horz" : "band2Horz");
    }
    if (look.vBand && !fc && !lc) {
      const ord = colIndex - (look.firstCol ? 1 : 0);
      types.push(Math.floor(ord / colBand) % 2 === 0 ? "band1Vert" : "band2Vert");
    }
    return types;
  };

  /** Ordered (highest first) tcPr & rPr for a cell from the table style,
   *  including wholeTable as the lowest-priority base. */
  const cellStyleProps = (ri: number, colIndex: number, gridSpan: number): { tcPr: Element[]; rPr: Element[] } => {
    const tcPr: Element[] = [];
    const rPr: Element[] = [];
    if (!tblStyleChainArr.length) return { tcPr, rPr };
    for (const type of [...cellCondTypes(ri, colIndex, gridSpan), "wholeTable"]) {
      for (const block of condBlocks(type)) {
        const tc = child(block, "w:tcPr");
        if (tc) tcPr.push(tc);
        const rp = child(block, "w:rPr");
        if (rp) rPr.push(rp);
      }
    }
    return { tcPr, rPr };
  };

  // Build a column-index map to resolve vertical merges
  type CellInfo = { tc: Element; colIndex: number; gridSpan: number };
  const grid: CellInfo[][] = rows.map((row) => {
    let colIndex = 0;
    return childList(row, "w:tc").map((tc) => {
      const gridSpan = intAttr(child(child(tc, "w:tcPr"), "w:gridSpan"), "w:val") ?? 1;
      const info = { tc, colIndex, gridSpan };
      colIndex += gridSpan;
      return info;
    });
  });

  const vMergeOf = (tc: Element): string | null => {
    const vm = child(child(tc, "w:tcPr"), "w:vMerge");
    if (!vm) return null;
    return vm.getAttribute("w:val") || "continue";
  };

  const rowsHtml: string[] = [];
  for (let ri = 0; ri < rows.length; ri++) {
    const trPr = child(rows[ri], "w:trPr");
    const trHeight = intAttr(child(trPr, "w:trHeight"), "w:val");
    const cantSplit = onOff(child(trPr, "w:cantSplit")) ?? false;
    const repeatHeader = onOff(child(trPr, "w:tblHeader")) ?? false;
    const cellsHtml: string[] = [];

    for (const info of grid[ri]) {
      const { tc, colIndex, gridSpan } = info;
      const merge = vMergeOf(tc);
      if (merge === "continue") continue; // swallowed by the restart cell above

      // Count continuation cells below for rowspan
      let rowSpan = 1;
      if (merge === "restart") {
        for (let rj = ri + 1; rj < rows.length; rj++) {
          const below = grid[rj].find((c) => c.colIndex === colIndex);
          if (below && vMergeOf(below.tc) === "continue") rowSpan++;
          else break;
        }
      }

      const tcPr = child(tc, "w:tcPr");
      const sp = cellStyleProps(ri, colIndex, gridSpan);
      const styles: string[] = [
        `padding:${px(defMar.top)} ${px(defMar.right)} ${px(defMar.bottom)} ${px(defMar.left)}`,
      ];

      // Borders: explicit cell → table-style cell borders → table inside/outer
      const tcBorders = child(tcPr, "w:tcBorders");
      const styleTcBorders = sp.tcPr.map((t) => child(t, "w:tcBorders")).filter((e): e is Element => !!e);
      for (const [side, tag] of [
        ["top", "w:top"],
        ["left", "w:left"],
        ["bottom", "w:bottom"],
        ["right", "w:right"],
      ] as const) {
        let css = borderCss(child(tcBorders, tag), ctx);
        if (css === undefined) {
          for (const stb of styleTcBorders) {
            css = borderCss(child(stb, tag), ctx);
            if (css !== undefined) break;
          }
        }
        if (css === undefined) {
          const isOuterRow = (side === "top" && ri === 0) || (side === "bottom" && ri === rows.length - 1);
          const isOuterCol =
            (side === "left" && colIndex === 0) || (side === "right" && colIndex + gridSpan >= colWidths.length);
          if (isOuterRow || isOuterCol) {
            css = borderCss(child(tblBorders, tag), ctx);
          } else {
            css = side === "top" || side === "bottom" ? insideH : insideV;
          }
        }
        if (css && css !== "none") styles.push(`border-${side}:${css}`);
      }

      // Shading: explicit cell fill → table-style cell/conditional fill
      let fillCss = wordColor(child(tcPr, "w:shd"), ctx, "w:fill", "w:themeFill");
      if (!fillCss) {
        for (const t of sp.tcPr) {
          fillCss = wordColor(child(t, "w:shd"), ctx, "w:fill", "w:themeFill");
          if (fillCss) break;
        }
      }
      if (fillCss) styles.push(`background-color:${fillCss}`);

      let vAlign = child(tcPr, "w:vAlign")?.getAttribute("w:val");
      if (!vAlign) {
        for (const t of sp.tcPr) {
          const v = child(t, "w:vAlign")?.getAttribute("w:val");
          if (v) {
            vAlign = v;
            break;
          }
        }
      }
      styles.push(`vertical-align:${vAlign === "center" ? "middle" : vAlign === "bottom" ? "bottom" : "top"}`);

      // Table-style run formatting (bold header, banded font color, …) applied
      // as inherited cell CSS; direct run formatting on each run still wins.
      if (sp.rPr.length) {
        for (const decl of runStyles(ctx, sp.rPr)) {
          if (
            /^(font-weight|font-style|color|font-family|font-size|text-decoration|text-transform|font-variant|letter-spacing):/.test(
              decl,
            )
          ) {
            styles.push(decl);
          }
        }
      }

      // Cell content: paragraphs and nested tables
      let content = "";
      for (const block of tc.children) {
        if (block.tagName === "w:p") content += (await renderParagraph(ctx, block)).html;
        else if (block.tagName === "w:tbl") content += await renderTable(ctx, block);
      }

      const spanAttrs = `${gridSpan > 1 ? ` colspan="${gridSpan}"` : ""}${rowSpan > 1 ? ` rowspan="${rowSpan}"` : ""}`;
      cellsHtml.push(`<td${spanAttrs} style="${styles.join(";")};">${content}</td>`);
    }

    const trStyle = trHeight ? ` style="height:${px(twipToPx(trHeight))};"` : "";
    const rowAttrs = `${cantSplit ? ' data-cant-split="1"' : ""}${repeatHeader ? ' data-repeat-header="1"' : ""}`;
    rowsHtml.push(`<tr${rowAttrs}${trStyle}>${cellsHtml.join("")}</tr>`);
  }

  return `<table style="${widthCss}margin:4px 0;"><colgroup>${colgroup}</colgroup><tbody>${rowsHtml.join("")}</tbody></table>`;
}

// ============================================================================
// Document assembly
// ============================================================================

/** Render note bodies after the main story has assigned their display numbers. */
async function renderNoteItems(ctx: DocxCtx, kind: NoteKind, includeId: boolean): Promise<string[]> {
  const refs = kind === "fn" ? ctx.fnRefs : ctx.enRefs;
  const map = kind === "fn" ? ctx.footnotes : ctx.endnotes;
  const items: string[] = [];
  // Index-based loop: rendering a note may reference further notes, which
  // append to the list and get rendered in turn.
  for (let i = 0; i < refs.length; i++) {
    const { id, num } = refs[i];
    const notePart = map.get(id);
    if (!notePart) continue;
    let content = "";
    const savedRels = ctx.rels;
    const savedPartPath = ctx.partPath;
    ctx.rels = notePart.rels;
    ctx.partPath = notePart.partPath;
    try {
      for (const blk of notePart.element.children) {
        if (blk.tagName === "w:p") content += (await renderParagraph(ctx, blk)).html;
        else if (blk.tagName === "w:tbl") content += await renderTable(ctx, blk);
      }
    } finally {
      ctx.rels = savedRels;
      ctx.partPath = savedPartPath;
    }
    const key = `${kind}-${num}`;
    items.push(
      `<div class="note" data-note-key="${key}"${includeId ? ` id="${key}"` : ""}>` +
        `<a class="note-num" href="#${kind}ref-${num}">${noteLabel(kind, num)}</a>` +
        `<div class="note-body">${content}</div></div>`,
    );
  }
  return items;
}

async function renderEndnotesSection(ctx: DocxCtx): Promise<string> {
  const items = await renderNoteItems(ctx, "en", true);
  return items.length ? `<div class="notes endnotes"><div class="notes-h">Endnotes</div>${items.join("")}</div>` : "";
}

async function renderFootnoteTemplate(ctx: DocxCtx): Promise<string> {
  const items = await renderNoteItems(ctx, "fn", false);
  return items.length ? `<template id="docx-footnotes">${items.join("")}</template>` : "";
}

async function renderCommentsSection(ctx: DocxCtx): Promise<string> {
  if (!ctx.commentRefs.length) return "";
  const items: string[] = [];
  for (const { id, num } of ctx.commentRefs) {
    const comment = ctx.comments.get(id);
    if (!comment) continue;
    const savedRels = ctx.rels;
    const savedPartPath = ctx.partPath;
    ctx.rels = comment.rels;
    ctx.partPath = comment.partPath;
    let content = "";
    try {
      for (const block of comment.element.children) {
        if (block.tagName === "w:p") content += (await renderParagraph(ctx, block)).html;
        else if (block.tagName === "w:tbl") content += await renderTable(ctx, block);
      }
    } finally {
      ctx.rels = savedRels;
      ctx.partPath = savedPartPath;
    }
    const meta = [comment.author, comment.date.slice(0, 10)].filter(Boolean).map(escapeHtml).join(" · ");
    items.push(
      `<div class="comment" id="comment-${num}"><a class="comment-num" href="#commentref-${num}">${num}</a>` +
        `<div class="comment-content">${meta ? `<div class="comment-meta">${meta}</div>` : ""}${content}</div></div>`,
    );
  }
  return items.length
    ? `<button class="comments-toggle" type="button" aria-controls="docx-comments" aria-expanded="false">` +
        `Comments <span>${items.length}</span></button>` +
        `<aside class="comments" id="docx-comments" aria-label="Document comments" hidden>` +
        `<div class="comments-head"><strong>Comments</strong><button type="button" data-comments-close aria-label="Close comments">×</button></div>` +
        `<div class="comments-list">${items.join("")}</div></aside>`
    : "";
}

/** Render the block-level children (paragraphs, tables, content controls) of a container. */
async function renderBlocks(ctx: DocxCtx, parent: Element): Promise<string> {
  let html = "";
  for (const block of parent.children) {
    if (block.tagName === "w:p") html += (await renderParagraph(ctx, block)).html;
    else if (block.tagName === "w:tbl") html += await renderTable(ctx, block);
    else if (block.tagName === "w:sdt") {
      const content = child(block, "w:sdtContent");
      if (content) html += await renderBlocks(ctx, content);
    }
  }
  return html;
}

/** Render a header/footer part with its own relationships in scope. */
async function renderHeaderFooter(ctx: DocxCtx, hf: HeaderFooter): Promise<string> {
  const saved = ctx.rels;
  const savedPartPath = ctx.partPath;
  ctx.rels = hf.rels;
  ctx.partPath = hf.partPath;
  try {
    return await renderBlocks(ctx, hf.doc.documentElement);
  } finally {
    ctx.rels = saved;
    ctx.partPath = savedPartPath;
  }
}

const DOCX_PAGINATION_SCRIPT = `(function(){
var LIMIT=10000,originalPages;
function pages(){return document.querySelectorAll('body > .pg')}
function pageBody(page){
  for(var i=0;i<page.children.length;i++)if(page.children[i].classList.contains('pg-body'))return page.children[i];
  return null;
}
function resetPages(){
  document.body.style.zoom='1';
  if(!originalPages){
    originalPages=Array.prototype.map.call(pages(),function(page){return page.cloneNode(true)});
    return;
  }
  Array.prototype.forEach.call(pages(),function(page){page.remove()});
  var anchor=document.querySelector('body > template[id^="pg-template-"]');
  for(var i=0;i<originalPages.length;i++)document.body.insertBefore(originalPages[i].cloneNode(true),anchor);
}
function numberVar(page,name){
  var value=parseFloat(getComputedStyle(page).getPropertyValue(name));
  return isFinite(value)?Math.max(0,value):0;
}
function sectionAtEnd(page){
  var body=pageBody(page),section=page.dataset.section;
  if(!body)return section;
  for(var i=0;i<body.children.length;i++)if(body.children[i].dataset.sectionStart)section=body.children[i].dataset.sectionStart;
  return section;
}
function nextPage(page){
  var section=sectionAtEnd(page),next=page.nextElementSibling;
  if(next&&next.classList.contains('pg')&&!next.dataset.hardStart&&next.dataset.section===section)return next;
  var template=document.getElementById('pg-template-'+section);
  if(!template||!template.content||!template.content.firstElementChild)return null;
  next=template.content.firstElementChild.cloneNode(true);
  page.after(next);
  return next;
}
function selectVariant(root,kind){
  if(!root)return;
  var variants=root.querySelectorAll(':scope > .hf-variant'),selected=null;
  for(var i=0;i<variants.length;i++){
    variants[i].hidden=true;
    if(variants[i].dataset.kind===kind)selected=variants[i];
  }
  if(!selected&&kind!=='default')for(var j=0;j<variants.length;j++)if(variants[j].dataset.kind==='default')selected=variants[j];
  if(selected)selected.hidden=false;
  root.hidden=!selected;
}
function syncFields(all){
  var counts={};
  for(var i=0;i<all.length;i++)counts[all[i].dataset.section]=(counts[all[i].dataset.section]||0)+1;
  for(var pageIndex=0;pageIndex<all.length;pageIndex++){
    var page=all[pageIndex],fields=page.querySelectorAll('[data-docx-field]');
    for(var j=0;j<fields.length;j++){
      var kind=fields[j].dataset.docxField,value='';
      if(kind==='PAGE')value=String(pageIndex+1);
      else if(kind==='NUMPAGES')value=String(all.length);
      else if(kind==='SECTION')value=String((parseInt(page.dataset.section,10)||0)+1);
      else if(kind==='SECTIONPAGES')value=String(counts[page.dataset.section]||1);
      if(value)fields[j].textContent=value;
    }
  }
}
function syncFurniture(page,index,firstInSection){
  var first=firstInSection&&page.dataset.titlePage==='1';
  var even=page.dataset.evenOdd==='1'&&(index+1)%2===0;
  var kind=first?'first':even?'even':'default';
  selectVariant(page.querySelector(':scope > .hf-top'),kind);
  selectVariant(page.querySelector(':scope > .hf-bot'),kind);
}
function reserveFurniture(page){
  var top=numberVar(page,'--pg-margin-top'),bottom=numberVar(page,'--pg-margin-bottom');
  var header=page.querySelector(':scope > .hf-top'),footer=page.querySelector(':scope > .hf-bot');
  if(page.dataset.reserveHeader==='1'&&header&&!header.hidden)top=Math.max(top,numberVar(page,'--header-distance')+header.offsetHeight);
  if(page.dataset.reserveFooter==='1'&&footer&&!footer.hidden)bottom=Math.max(bottom,numberVar(page,'--footer-distance')+footer.offsetHeight);
  page.style.setProperty('--body-top',top+'px');
  page.style.setProperty('--body-bottom',bottom+'px');
  page.dataset.footerReserve=String(bottom);
  var body=pageBody(page);
  if(body){body.style.top=top+'px';body.style.bottom=bottom+'px'}
}
function footnoteSource(template,key){
  if(!template||!template.content)return null;
  var sources=template.content.querySelectorAll('[data-note-key]');
  for(var i=0;i<sources.length;i++)if(sources[i].dataset.noteKey===key)return sources[i];
  return null;
}
function syncNotes(page){
  var body=pageBody(page),notes=page.querySelector(':scope > .pg-notes');
  if(!body||!notes)return;
  notes.replaceChildren();
  var template=document.getElementById('docx-footnotes'),refs=body.querySelectorAll('a[data-note-key^="fn-"]'),seen={};
  for(var i=0;i<refs.length;i++){
    var key=refs[i].dataset.noteKey;
    if(!key||seen[key])continue;
    var source=footnoteSource(template,key);
    if(source){var clone=source.cloneNode(true);clone.id=key;notes.appendChild(clone);seen[key]=true}
  }
  notes.hidden=!notes.children.length;
  var base=parseFloat(page.dataset.footerReserve||'0')||0;
  notes.style.bottom=base+'px';
  var reserve=base+(notes.hidden?0:notes.offsetHeight+6);
  page.style.setProperty('--body-bottom',reserve+'px');
  body.style.bottom=reserve+'px';
}
function normalizeParity(){
  Array.prototype.forEach.call(document.querySelectorAll('body > .pg[data-parity-blank]'),function(page){page.remove()});
  var all=pages();
  for(var i=0;i<all.length;i++){
    var desired=all[i].dataset.startParity;
    if(!desired)continue;
    var pageNumber=i+1,correct=desired==='odd'?pageNumber%2===1:pageNumber%2===0;
    if(correct)continue;
    var section=i>0?sectionAtEnd(all[i-1]):all[i].dataset.section;
    var template=document.getElementById('pg-template-'+section);
    if(!template||!template.content||!template.content.firstElementChild)continue;
    var blank=template.content.firstElementChild.cloneNode(true),blankBody=pageBody(blank);
    blank.dataset.parityBlank='1';blank.dataset.hardStart='1';blank.classList.add('pg-blank');
    blank.removeAttribute('data-start-parity');if(blankBody)blankBody.replaceChildren();
    all[i].before(blank);all=pages();i++;
  }
}
function syncAll(){
  normalizeParity();
  var all=pages(),seen={};
  syncFields(all);
  for(var i=0;i<all.length;i++){
    var section=all[i].dataset.section,first=!seen[section];seen[section]=true;
    syncFurniture(all[i],i,first);reserveFurniture(all[i]);syncNotes(all[i]);
  }
}
function fits(body){return body.scrollHeight<=body.clientHeight+1}
function textNodes(root){
  var walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),nodes=[],node;
  while((node=walker.nextNode()))nodes.push(node);
  return nodes;
}
function pointAt(nodes,offset){
  var seen=0;
  for(var i=0;i<nodes.length;i++){
    var length=nodes[i].data.length;
    if(offset<=seen+length)return {node:nodes[i],offset:offset-seen};
    seen+=length;
  }
  var last=nodes[nodes.length-1];
  return {node:last,offset:last?last.data.length:0};
}
function fragment(root,start,end){
  var nodes=textNodes(root);
  if(!nodes.length)return document.createDocumentFragment();
  var a=pointAt(nodes,start),b=pointAt(nodes,end),range=document.createRange();
  range.setStart(a.node,a.offset);range.setEnd(b.node,b.offset);
  return range.cloneContents();
}
function safeTextOffset(root,offset){
  var text=root.textContent||'',best=offset;
  var before=text.charCodeAt(best-1),after=text.charCodeAt(best);
  if(best>0&&best<text.length&&before>=55296&&before<=56319&&after>=56320&&after<=57343)best--;
  var floor=Math.max(1,best-80);
  for(var i=best;i>floor;i--){var code=text.charCodeAt(i-1);if(code===9||code===10||code===13||code===32||code===45||(code>=8208&&code<=8212))return i}
  return best;
}
function visualLines(root){
  var range=document.createRange();range.selectNodeContents(root);
  var rects=range.getClientRects(),tops=[];
  for(var i=0;i<rects.length;i++)if(rects[i].width||rects[i].height){
    var top=Math.round(rects[i].top*2)/2,known=false;
    for(var j=0;j<tops.length;j++)if(Math.abs(tops[j]-top)<1){known=true;break}
    if(!known)tops.push(top);
  }
  return tops.length;
}
function splitParagraph(paragraph,body,target){
  if(paragraph.dataset.keepLines||paragraph.querySelector('img,svg,math,table,.tab-row,[id]'))return false;
  var source=paragraph.cloneNode(true),nodes=textNodes(source),total=0;
  for(var i=0;i<nodes.length;i++)total+=nodes[i].data.length;
  if(total<2)return false;
  var low=1,high=total-1,best=0;
  while(low<=high){
    var mid=(low+high)>>1;
    paragraph.replaceChildren(fragment(source,0,mid));
    if(fits(body)){best=mid;low=mid+1}else high=mid-1;
  }
  best=safeTextOffset(source,best);
  if(best<1||best>=total){paragraph.replaceChildren(fragment(source,0,total));return false}
  var attempts=0;
  while(best>0&&attempts++<256){
    paragraph.replaceChildren(fragment(source,0,best));
    var rest=source.cloneNode(false);rest.removeAttribute('data-keep-next');rest.appendChild(fragment(source,best,total));
    target.insertBefore(rest,target.firstChild);
    var firstLines=visualLines(paragraph),lastLines=visualLines(rest);
    if(!paragraph.dataset.widowControl||(!firstLines&&!lastLines)||(firstLines>=2&&lastLines>=2))return true;
    rest.remove();
    if(firstLines<2)break;
    best=safeTextOffset(source,best-1);
  }
  paragraph.replaceChildren(fragment(source,0,total));
  return false;
}
function splitTable(table,body,target){
  var tbody=table.tBodies&&table.tBodies[0];
  if(!tbody||tbody.rows.length<2||table.querySelector('[rowspan]'))return false;
  var originalRows=Array.prototype.slice.call(tbody.rows),headerCount=0;
  while(headerCount<originalRows.length&&originalRows[headerCount].dataset.repeatHeader)headerCount++;
  if(headerCount===originalRows.length)headerCount=0;
  var headerClones=[];
  for(var h=0;h<headerCount;h++)headerClones.push(originalRows[h].cloneNode(true));
  var tail=table.cloneNode(false),children=table.children;
  for(var i=0;i<children.length;i++)if(children[i].tagName==='COLGROUP')tail.appendChild(children[i].cloneNode(true));
  var tailBody=document.createElement('tbody'),movedRows=[];tail.appendChild(tailBody);
  while(!fits(body)&&tbody.rows.length>1)movedRows.unshift(tbody.rows[tbody.rows.length-1]);
  if(!movedRows.length)return false;
  for(var j=0;j<headerClones.length;j++)tailBody.appendChild(headerClones[j]);
  for(var k=0;k<movedRows.length;k++)tailBody.appendChild(movedRows[k]);
  if(headerCount&&tbody.rows.length===headerCount)table.remove();
  target.insertBefore(tail,target.firstChild);
  return true;
}
function paginate(){
  resetPages();syncAll();
  var operations=0;
  for(var index=0;index<LIMIT;index++){
    var all=pages();
    if(index>=all.length)break;
    var page=all[index],body=pageBody(page);
    if(!body||body.clientHeight<=0)continue;
    while(!fits(body)&&operations++<LIMIT){
      var targetPage=nextPage(page);syncAll();
      var target=targetPage&&pageBody(targetPage),last=body.lastElementChild;
      if(!target||!last)break;
      if(body.children.length===1){
        var split=last.tagName==='TABLE'?splitTable(last,body,target):last.classList.contains('p')&&splitParagraph(last,body,target);
        if(!split){page.style.height='auto';body.style.overflow='visible';break}
      }else target.insertBefore(last,target.firstChild);
      syncAll();
    }
    var following=page.nextElementSibling;
    if(following&&following.classList.contains('pg')&&!following.dataset.hardStart){
      var followingBody=pageBody(following),keep=body.lastElementChild;
      while(keep&&keep.dataset.keepNext&&followingBody&&followingBody.firstElementChild&&operations++<LIMIT){
        followingBody.insertBefore(keep,followingBody.firstChild);keep=body.lastElementChild;syncAll();
      }
    }
  }
  syncAll();
}
window.__ooxmlPaginate=paginate;
})();`;

async function renderDocument(ctx: DocxCtx): Promise<string> {
  const body = descend(ctx.doc.documentElement, "w:body");
  if (!body) throw new Error("Invalid DOCX: empty body");

  interface PageDraft {
    blocks: string[];
    section: number;
    hardStart: boolean;
    startParity?: "odd" | "even";
  }

  // Explicit breaks remain hard boundaries. Measured continuation pages are
  // inserted before them by the iframe paginator instead of flowing across.
  let sectionIndex = 0;
  const pages: PageDraft[] = [{ blocks: [], section: 0, hardStart: false }];
  const pushPage = (section = sectionIndex, startParity?: "odd" | "even") => {
    const current = pages[pages.length - 1];
    if (current.blocks.length > 0) pages.push({ blocks: [], section, hardStart: true, startParity });
    else {
      current.section = section;
      if (startParity) current.startParity = startParity;
    }
  };
  const continuousGeometryMatches = (left: DocxSection, right: DocxSection): boolean =>
    ["pageWidth", "pageHeight", "marginTop", "marginRight", "marginBottom", "marginLeft"].every(
      (key) =>
        Math.abs(left[key as keyof DocxSection] as number) === Math.abs(right[key as keyof DocxSection] as number),
    );

  const walkBlocks = async (parent: Element): Promise<void> => {
    for (const block of parent.children) {
      switch (block.tagName) {
        case "w:p": {
          ctx.renderSectionIndex = sectionIndex;
          const result = await renderParagraph(ctx, block);
          if (result.pageBreakBefore) pushPage();
          for (let segmentIndex = 0; segmentIndex < result.pageSegments.length; segmentIndex++) {
            if (segmentIndex > 0) pushPage(sectionIndex);
            pages[pages.length - 1].blocks.push(result.pageSegments[segmentIndex]);
          }
          // A paragraph-level sectPr closes the current section. The body-level
          // sectPr describes the final section and is not itself a content block.
          if (descend(block, "w:pPr", "w:sectPr")) {
            const endingSection = ctx.sections[sectionIndex];
            const nextSectionIndex = Math.min(sectionIndex + 1, ctx.sections.length - 1);
            const nextSection = ctx.sections[nextSectionIndex];
            sectionIndex = nextSectionIndex;
            if (
              endingSection?.breakType === "continuous" &&
              nextSection &&
              continuousGeometryMatches(endingSection, nextSection)
            ) {
              pages[pages.length - 1].blocks.push(
                `<div class="section-boundary" data-section-start="${sectionIndex}"></div>`,
              );
            } else {
              // nextColumn falls back to a page because this lightweight HTML
              // renderer does not model Word's independent column cursors.
              pushPage(
                sectionIndex,
                endingSection?.breakType === "oddPage"
                  ? "odd"
                  : endingSection?.breakType === "evenPage"
                    ? "even"
                    : undefined,
              );
            }
          }
          break;
        }
        case "w:tbl":
          ctx.renderSectionIndex = sectionIndex;
          pages[pages.length - 1].blocks.push(await renderTable(ctx, block));
          break;
        case "w:sdt": {
          const content = child(block, "w:sdtContent");
          if (content) await walkBlocks(content);
          break;
        }
      }
    }
  };
  await walkBlocks(body);

  // Physical-page footnotes are cloned from a hidden template by the paginator;
  // endnotes remain an end-of-document story.
  const footnotesTemplate = await renderFootnoteTemplate(ctx);
  const endnotesHtml = await renderEndnotesSection(ctx);
  if (endnotesHtml) pages[pages.length - 1].blocks.push(endnotesHtml);
  const commentsHtml = await renderCommentsSection(ctx);

  // Document-wide default text style (docDefaults + default paragraph style)
  const baseChain = buildRPrChain(ctx, undefined, undefined);
  const baseStyles = runStyles(ctx, baseChain);
  if (!baseStyles.some((s) => s.startsWith("font-size"))) baseStyles.push("font-size:14.67px");
  if (!baseStyles.some((s) => s.startsWith("font-family"))) {
    baseStyles.push(`font-family:${cssFontStack(ctx.theme.minorFont)}`);
  }

  interface RenderedSection extends DocxSection {
    defaultHeader: string;
    defaultFooter: string;
    firstHeader: string;
    firstFooter: string;
    evenHeader: string;
    evenFooter: string;
  }
  const renderedSections: RenderedSection[] = [];
  for (let renderedSectionIndex = 0; renderedSectionIndex < ctx.sections.length; renderedSectionIndex++) {
    const section = ctx.sections[renderedSectionIndex];
    ctx.renderSectionIndex = renderedSectionIndex;
    const defaultHeaderPart = section.headers.get("default");
    const defaultFooterPart = section.footers.get("default");
    const firstHeaderPart = section.titlePage ? section.headers.get("first") : undefined;
    const firstFooterPart = section.titlePage ? section.footers.get("first") : undefined;
    const evenHeaderPart = ctx.evenAndOddHeaders ? section.headers.get("even") : undefined;
    const evenFooterPart = ctx.evenAndOddHeaders ? section.footers.get("even") : undefined;
    renderedSections.push({
      ...section,
      defaultHeader: defaultHeaderPart ? await renderHeaderFooter(ctx, defaultHeaderPart) : "",
      defaultFooter: defaultFooterPart ? await renderHeaderFooter(ctx, defaultFooterPart) : "",
      firstHeader: firstHeaderPart ? await renderHeaderFooter(ctx, firstHeaderPart) : "",
      firstFooter: firstFooterPart ? await renderHeaderFooter(ctx, firstFooterPart) : "",
      evenHeader: evenHeaderPart ? await renderHeaderFooter(ctx, evenHeaderPart) : "",
      evenFooter: evenFooterPart ? await renderHeaderFooter(ctx, evenFooterPart) : "",
    });
  }

  const sectionStyle = (section: DocxSection): string =>
    [
      `--pg-width:${px(section.pageWidth)}`,
      `--pg-height:${px(section.pageHeight)}`,
      `--pg-margin-top:${px(section.marginTop)}`,
      `--pg-margin-right:${px(section.marginRight)}`,
      `--pg-margin-bottom:${px(section.marginBottom)}`,
      `--pg-margin-left:${px(section.marginLeft)}`,
      `--header-distance:${px(section.headerDistance)}`,
      `--footer-distance:${px(section.footerDistance)}`,
      `--body-top:${px(section.marginTop)}`,
      `--body-bottom:${px(section.marginBottom)}`,
    ].join(";");
  const furniture = (className: string, variants: { default: string; first: string; even: string }): string => {
    const parts = (["default", "first", "even"] as const)
      .filter((kind) => variants[kind])
      .map((kind) => `<div class="hf-variant" data-kind="${kind}" hidden>${variants[kind]}</div>`)
      .join("");
    return `<div class="hf ${className}"${parts ? "" : " hidden"}>${parts}</div>`;
  };
  const pageShell = (
    section: RenderedSection,
    index: number,
    bodyHtml: string,
    hardStart: boolean,
    startParity?: "odd" | "even",
  ): string => {
    return (
      `<div class="pg" data-section="${index}" data-title-page="${section.titlePage ? 1 : 0}" ` +
      `data-even-odd="${ctx.evenAndOddHeaders ? 1 : 0}" data-reserve-header="${section.reserveHeader ? 1 : 0}" ` +
      `data-reserve-footer="${section.reserveFooter ? 1 : 0}"${hardStart ? ' data-hard-start="1"' : ""}` +
      `${startParity ? ` data-start-parity="${startParity}"` : ""} ` +
      `style="${sectionStyle(section)}">` +
      furniture("hf-top", {
        default: section.defaultHeader,
        first: section.firstHeader,
        even: section.evenHeader,
      }) +
      `<div class="pg-body">${bodyHtml}</div>` +
      `<div class="pg-notes" hidden></div>` +
      furniture("hf-bot", {
        default: section.defaultFooter,
        first: section.firstFooter,
        even: section.evenFooter,
      }) +
      `</div>`
    );
  };

  const pagesHtml = pages
    .map((page) => {
      const index = Math.max(0, Math.min(page.section, renderedSections.length - 1));
      const section = renderedSections[index];
      return pageShell(section, index, page.blocks.join(""), page.hardStart, page.startParity);
    })
    .join("");
  const pageTemplates = renderedSections
    .map((section, index) => `<template id="pg-template-${index}">${pageShell(section, index, "", false)}</template>`)
    .join("");

  return [
    "<!DOCTYPE html>",
    `<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${OFFICE_PREVIEW_CSP}"><style>`,
    "*{margin:0;padding:0;box-sizing:border-box;}",
    "html,body{background:#E9E9ED;}",
    ".pg{width:var(--pg-width);height:var(--pg-height);position:relative;overflow:hidden;" +
      `background:#fff;margin:16px auto;box-shadow:0 1px 4px rgba(0,0,0,0.18);` +
      `${baseStyles.join(";")};color:#000;line-height:1.35;}`,
    ".p{white-space:pre-wrap;overflow-wrap:break-word;min-height:1em;orphans:2;widows:2;}",
    "table{border-collapse:collapse;table-layout:fixed;}",
    "td{word-wrap:break-word;}",
    "a{color:#0563C1;text-decoration:underline;}",
    "img{max-width:100%;}",
    ".math-block{display:block;text-align:center;margin:6px 0;}",
    "math{font-size:1.1em;}",
    ".noteref a{color:inherit;text-decoration:none;}",
    ".noteref a:hover{text-decoration:underline;}",
    ".commentref{display:inline-block;position:relative;width:0;height:0;line-height:0;}",
    ".commentref a{position:absolute;left:2px;top:-1.35em;display:grid;place-items:center;min-width:1.25em;height:1.25em;border-radius:999px;background:#FFF1A8;color:#604B00;font-size:.72em;line-height:1;text-decoration:none;z-index:5;}",
    ".comment-anchor{position:relative;top:-.15em;}",
    ".notes{margin-top:20px;padding-top:8px;border-top:1px solid #C9CCD1;}",
    ".notes-h{font-size:0.82em;font-weight:bold;color:#444;margin-bottom:4px;}",
    ".note{display:flex;gap:6px;font-size:0.82em;line-height:1.35;margin:2px 0;}",
    ".note-num{color:#0563C1;text-decoration:none;flex:0 0 auto;min-width:1.4em;text-align:right;}",
    ".note-body .p{min-height:0;}",
    ".comments-toggle{position:fixed;right:14px;top:14px;z-index:20;border:1px solid #C6A528;border-radius:999px;padding:7px 11px;background:#FFFBE8;color:#332800;font:600 13px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.16);cursor:pointer;}",
    ".comments-toggle span{display:inline-grid;place-items:center;min-width:1.35em;height:1.35em;margin-left:4px;border-radius:999px;background:#E3C24B;}",
    ".comments{position:fixed;right:14px;top:54px;z-index:21;width:min(360px,calc(100vw - 28px));max-height:calc(100vh - 68px);overflow:hidden;background:#fff;border:1px solid #D8B94C;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.22);font-family:system-ui,sans-serif;}",
    ".comments[hidden]{display:none;}.comments-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #E6DDAF;}",
    ".comments-head button{border:0;background:transparent;font:22px/1 system-ui,sans-serif;cursor:pointer;color:#5B5441;}.comments-list{max-height:calc(100vh - 118px);overflow:auto;padding:6px;}",
    ".comment{display:flex;gap:8px;margin:5px 0;padding:8px;background:#FFFBE8;border-left:3px solid #E3C24B;border-radius:3px;font-size:12px;}",
    ".comment.is-active{outline:2px solid #C6A528;outline-offset:-1px;}",
    ".comment-num{display:grid;place-items:center;align-self:start;min-width:1.45em;height:1.45em;border-radius:999px;background:#E3C24B;color:#332800;text-decoration:none;font-weight:bold;}",
    ".comment-content{min-width:0;flex:1;}.comment-content .p{min-height:0;}.comment-meta{font-size:.86em;color:#6B6250;margin-bottom:3px;}",
    ".pg-body{position:absolute;left:var(--pg-margin-left);right:var(--pg-margin-right);top:var(--body-top);bottom:var(--body-bottom);display:flow-root;overflow:hidden;}",
    ".hf{position:absolute;left:var(--pg-margin-left);right:var(--pg-margin-right);color:#3c3c3c;z-index:3;}",
    ".hf-top{top:var(--header-distance);}",
    ".hf-bot{bottom:var(--footer-distance);}",
    ".hf-variant[hidden]{display:none;}",
    ".hf .p{min-height:0;}",
    ".pg-notes{position:absolute;left:var(--pg-margin-left);right:var(--pg-margin-right);bottom:var(--body-bottom);max-height:42%;overflow:hidden;padding-top:5px;border-top:1px solid #777;background:#fff;z-index:4;}",
    ".pg-notes[hidden]{display:none;}",
    ".pg-notes .note{font-size:0.78em;line-height:1.25;}",
    ".section-boundary{display:none!important;}",
    ".tab-row{display:flex;align-items:baseline;width:100%;}",
    ".tab-ld{flex:1 1 auto;min-width:1.5em;align-self:center;height:0;margin:0 3px;position:relative;top:0.35em;}",
    ".tab-ld.ld-d{border-bottom:1.5px dotted;}",
    ".tab-ld.ld-h{border-bottom:1px dashed;}",
    ".tab-ld.ld-u{border-bottom:1px solid;top:0.45em;}",
    "</style></head><body>",
    pagesHtml,
    footnotesTemplate,
    pageTemplates,
    commentsHtml,
    // Paginate after fonts/images settle, then fit the page stack to the viewport.
    `<script>${DOCX_PAGINATION_SCRIPT}(function(){var userZoom=1;function f(){document.body.style.zoom='1';var W=0,p=document.querySelectorAll('body > .pg');for(var i=0;i<p.length;i++)W=Math.max(W,p[i].offsetWidth);var z=Math.min(1,document.documentElement.clientWidth/(W+32));document.body.style.zoom=z*userZoom;}function run(){window.__ooxmlPaginate();f()}function setupComments(){var toggle=document.querySelector('.comments-toggle'),panel=document.getElementById('docx-comments');if(!toggle||!panel)return;function setOpen(open,id){panel.hidden=!open;toggle.setAttribute('aria-expanded',open?'true':'false');var items=panel.querySelectorAll('.comment');for(var i=0;i<items.length;i++)items[i].classList.toggle('is-active',items[i].id===id);if(open&&id){var item=document.getElementById(id);if(item)item.scrollIntoView({block:'nearest'})}}toggle.addEventListener('click',function(){setOpen(panel.hidden)});var close=panel.querySelector('[data-comments-close]');if(close)close.addEventListener('click',function(){setOpen(false);toggle.focus()});document.addEventListener('click',function(event){var target=event.target,link=target&&target.closest&&target.closest('a[href^="#comment-"]');if(!link)return;event.preventDefault();setOpen(true,link.getAttribute('href').slice(1))});document.addEventListener('keydown',function(event){if(event.key==='Escape'&&!panel.hidden){setOpen(false);toggle.focus()}})}window.addEventListener('message',function(event){var data=event.data;if(event.source!==parent||!data||data.type!=='wingman:docx-zoom')return;var next=Number(data.value);if(!Number.isFinite(next))return;userZoom=Math.max(.5,Math.min(2,next));f()});window.addEventListener('resize',f);window.addEventListener('load',run);if(document.fonts&&document.fonts.ready)document.fonts.ready.then(run);requestAnimationFrame(run);setupComments()})();</script>`,
    "</body></html>",
  ].join("");
}
