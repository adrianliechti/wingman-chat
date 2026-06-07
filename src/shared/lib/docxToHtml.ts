import JSZip from "jszip";
import {
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
  type OoxmlTheme,
  parseRels,
  parseThemeDoc,
  parseXml,
  ptToPx,
  px,
  type Rel,
  relsPathFor,
  resolveTarget,
  toAlpha,
  toRoman,
  twipToPx,
} from "./ooxml";
import { ommlToMathml } from "./ommlToMathml";

/**
 * Converts a DOCX file to a single self-contained HTML document with high
 * content retention: styles.xml inheritance (docDefaults → named styles →
 * direct formatting), theme colors/fonts, multi-level numbering, tables
 * (borders, shading, merges), inline & floating images, hyperlinks and
 * page-sized "sheets" split at explicit page breaks.
 *
 * Render it in an iframe — a small inline script zooms the page to fit the
 * viewport width.
 */
export async function docxToHtml(file: File | Blob | ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(file as Blob);

  const docXml = await zip.file("word/document.xml")?.async("string");
  if (!docXml) {
    throw new Error("Invalid DOCX: missing word/document.xml");
  }

  const ctx: DocxCtx = {
    zip,
    doc: parseXml(docXml),
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
    fnRefs: [],
    enRefs: [],
  };

  // Independent parts — overlap the zip reads/parses
  await Promise.all([loadDocxRels(ctx), loadDocxTheme(ctx), loadStyles(ctx), loadNumbering(ctx), loadDocxNotes(ctx)]);

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
  zip: JSZip;
  doc: Document;
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
  /** footnote / endnote id → note element (separators excluded) */
  footnotes: Map<string, Element>;
  endnotes: Map<string, Element>;
  /** references in document order → assigned display number */
  fnRefs: { id: string; num: number }[];
  enRefs: { id: string; num: number }[];
}

async function loadDocxRels(ctx: DocxCtx): Promise<void> {
  const xml = await ctx.zip.file(relsPathFor("word/document.xml"))?.async("string");
  if (!xml) return;
  ctx.rels = parseRels(parseXml(xml));
}

async function loadDocxTheme(ctx: DocxCtx): Promise<void> {
  const xml = await ctx.zip.file("word/theme/theme1.xml")?.async("string");
  if (!xml) return;
  ctx.theme = parseThemeDoc(parseXml(xml));
}

async function loadStyles(ctx: DocxCtx): Promise<void> {
  const xml = await ctx.zip.file("word/styles.xml")?.async("string");
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
  const xml = await ctx.zip.file("word/numbering.xml")?.async("string");
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
  return loadMediaDataUrl(ctx.zip, ctx.mediaCache, path);
}

/** Load footnotes.xml / endnotes.xml. Separator notes (which carry a w:type)
 *  are skipped — only real notes are indexed by id. */
async function loadDocxNotes(ctx: DocxCtx): Promise<void> {
  const load = async (file: string, tag: string, map: Map<string, Element>): Promise<void> => {
    const xml = await ctx.zip.file(file)?.async("string");
    if (!xml) return;
    for (const note of parseXml(xml).getElementsByTagName(tag)) {
      const id = note.getAttribute("w:id");
      // Real notes have no w:type; separator/continuationSeparator/notice do.
      if (id && !note.getAttribute("w:type")) map.set(id, note);
    }
  };
  await Promise.all([
    load("word/footnotes.xml", "w:footnote", ctx.footnotes),
    load("word/endnotes.xml", "w:endnote", ctx.endnotes),
  ]);
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
    let hex = ctx.theme.colors[slot];
    if (hex) {
      const tint = el.getAttribute(`${themeAttr.replace("Color", "")}Tint`) || el.getAttribute("w:themeTint");
      const shade = el.getAttribute(`${themeAttr.replace("Color", "")}Shade`) || el.getAttribute("w:themeShade");
      if (tint) hex = mixHex(hex, parseInt(tint, 16) / 255, true);
      else if (shade) hex = mixHex(hex, parseInt(shade, 16) / 255, false);
      return `#${hex}`;
    }
  }
  const val = el.getAttribute(valAttr);
  if (val && val !== "auto") return `#${val}`;
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
  }

  const color = wordColor(chainChild(chain, "w:color"), ctx);
  if (color) styles.push(`color:${color}`);

  const highlight = chainChild(chain, "w:highlight")?.getAttribute("w:val");
  if (highlight && HIGHLIGHT_COLORS[highlight]) styles.push(`background-color:${HIGHLIGHT_COLORS[highlight]}`);
  else {
    const shd = chainChild(chain, "w:shd");
    const fill = shd?.getAttribute("w:fill");
    if (fill && fill !== "auto") styles.push(`background-color:#${fill}`);
  }

  const rFonts = chainChild(chain, "w:rFonts");
  let font = rFonts?.getAttribute("w:ascii") || "";
  const themeFont = rFonts?.getAttribute("w:asciiTheme");
  if (!font && themeFont) {
    font = themeFont.startsWith("major") ? ctx.theme.majorFont : ctx.theme.minorFont;
  }
  if (font) styles.push(`font-family:${cssFontStack(font)}`);

  const vertAlign = chainChild(chain, "w:vertAlign")?.getAttribute("w:val");
  if (vertAlign === "superscript") styles.push("vertical-align:super;font-size:0.7em");
  else if (vertAlign === "subscript") styles.push("vertical-align:sub;font-size:0.7em");

  if (chainOnOff(chain, "w:caps")) styles.push("text-transform:uppercase");
  else if (chainOnOff(chain, "w:smallCaps")) styles.push("font-variant:small-caps");

  const spacing = intAttr(chainChild(chain, "w:spacing"), "w:val");
  if (spacing) styles.push(`letter-spacing:${px(twipToPx(spacing))}`);

  if (chainOnOff(chain, "w:vanish")) styles.push("display:none");

  return styles;
}

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
        if (type !== "page") parts.push("<br/>");
        break;
      }
      case "w:cr":
        parts.push("<br/>");
        break;
      case "w:tab":
        parts.push('<span style="display:inline-block;width:36px;"></span>');
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
        parts.push(`<sup class="noteref"><a id="${kind}ref-${num}" href="#${kind}-${num}">${lbl}</a></sup>`);
        break;
      }
    }
  }

  const text = parts.join("");
  if (!text) return "";
  return styles.length ? `<span style="${styles.join(";")};">${text}</span>` : text;
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
    const v = srgb.getAttribute("val");
    if (v) return `#${v}`;
  }
  const sch = fill.getElementsByTagName("a:schemeClr")[0];
  if (sch) {
    const v = sch.getAttribute("val") || "";
    const slot = ({ tx1: "dk1", bg1: "lt1", tx2: "dk2", bg2: "lt2" } as Record<string, string>)[v] || v;
    const hex = ctx.theme.colors[slot];
    if (hex) return `#${hex}`;
  }
  return undefined;
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
    styles.push("display:flex", "flex-direction:column", `justify-content:${anchor === "ctr" ? "center" : "flex-end"}`);
  } else {
    styles.push(`display:${isAnchor ? "block" : "inline-block"}`);
    if (!isAnchor) styles.push("vertical-align:top");
  }
  if (isAnchor) {
    const align = descend(container, "wp:positionH", "wp:align")?.textContent;
    if (align === "right") styles.push("float:right", "margin:4px 0 4px 12px");
    else if (align === "left") styles.push("float:left", "margin:4px 12px 4px 0");
    else styles.push("margin:8px auto");
  }

  return `<div style="${styles.join(";")};">${inner}</div>`;
}

async function renderDrawing(ctx: DocxCtx, drawing: Element): Promise<string> {
  const container = child(drawing, "wp:inline") ?? child(drawing, "wp:anchor");
  if (!container) return "";

  const extent = child(container, "wp:extent");
  const w = emuToPx(intAttr(extent, "cx") ?? 0);
  const h = emuToPx(intAttr(extent, "cy") ?? 0);

  const graphicData = descend(container, "a:graphic", "a:graphicData");

  // Picture (a:blip)
  const blip = graphicData?.getElementsByTagName("a:blip")[0];
  if (blip) {
    const rId = getRId(blip);
    const rel = rId ? ctx.rels.get(rId) : undefined;
    if (rel && !rel.external) {
      const url = await loadDocxMedia(ctx, resolveTarget("word/document.xml", rel.target));
      if (url) {
        const styles = [`width:${px(w)}`, `height:${px(h)}`];
        if (container.tagName === "wp:anchor") {
          const align = descend(container, "wp:positionH", "wp:align")?.textContent;
          if (align === "right") styles.push("float:right", "margin:4px 0 4px 12px");
          else if (align === "left") styles.push("float:left", "margin:4px 12px 4px 0");
          else styles.push("display:block", "margin:8px auto");
        } else {
          styles.push("vertical-align:middle");
        }
        return `<img src="${url}" alt="" style="${styles.join(";")};"/>`;
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
    const fill = shape?.getAttribute("fillcolor");
    if (fill && shape?.getAttribute("filled") !== "f") styles.push(`background:${fill}`);
    if (shape?.getAttribute("stroked") !== "f") {
      const stroke = shape?.getAttribute("strokecolor") || "#000000";
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
  const url = await loadDocxMedia(ctx, resolveTarget("word/document.xml", rel.target));
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
    // Advance counters: increment this level, reset deeper ones
    const counters = ctx.listCounters.get(def.abstractId) ?? [];
    for (let l = 0; l < ilvl; l++) {
      if (counters[l] == null) counters[l] = def.levels.get(l)?.start ?? 1;
    }
    counters[ilvl] = counters[ilvl] == null ? lvl.start : counters[ilvl] + 1;
    counters.length = ilvl + 1;
    ctx.listCounters.set(def.abstractId, counters);

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
  pageBreakBefore?: boolean;
  pageBreakAfter?: boolean;
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
      styles.push(`line-height:${Math.round((line / 240) * 1000) / 1000}`);
    }
  }

  // Shading & borders
  const shd = chainChild(pChain, "w:shd");
  const fill = shd?.getAttribute("w:fill");
  if (fill && fill !== "auto") styles.push(`background-color:#${fill}`);

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
  let pageBreakAfter = false;

  // Field state: skip instruction text between fldChar begin…separate
  let inFieldInstr = 0;

  const walkInline = async (parent: Element): Promise<void> => {
    for (const node of parent.children) {
      switch (node.tagName) {
        case "w:r": {
          const fldChar = child(node, "w:fldChar");
          if (fldChar) {
            const type = fldChar.getAttribute("w:fldCharType");
            if (type === "begin") inFieldInstr++;
            else if (type === "separate" || type === "end") inFieldInstr = Math.max(0, inFieldInstr - 1);
            break;
          }
          if (inFieldInstr > 0) break;
          if (Array.from(node.getElementsByTagName("w:br")).some((br) => br.getAttribute("w:type") === "page")) {
            pageBreakAfter = true;
          }
          html += await renderRun(ctx, node, pStyleId);
          break;
        }
        case "w:hyperlink": {
          const rId = getRId(node, "id");
          const rel = rId ? ctx.rels.get(rId) : undefined;
          let inner = "";
          for (const r of childList(node, "w:r")) {
            inner += await renderRun(ctx, r, pStyleId);
          }
          if (rel?.external) {
            html += `<a href="${escapeHtml(rel.target)}" target="_blank" rel="noreferrer">${inner}</a>`;
          } else {
            html += inner;
          }
          break;
        }
        case "w:fldSimple":
        case "w:smartTag":
        case "w:ins":
          await walkInline(node);
          break;
        case "w:sdt": {
          const content = child(node, "w:sdtContent");
          if (content) await walkInline(content);
          break;
        }
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
  const styleAttr = allStyles.length ? ` style="${allStyles.join(";")};"` : "";

  return {
    html: `<div class="p"${styleAttr}>${markerHtml}${html || "&nbsp;"}</div>`,
    pageBreakBefore: chainOnOff([pPr], "w:pageBreakBefore"),
    pageBreakAfter,
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
          if (/^(font-weight|font-style|color|font-family|font-size|text-decoration|text-transform|font-variant|letter-spacing):/.test(decl)) {
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
    rowsHtml.push(`<tr${trStyle}>${cellsHtml.join("")}</tr>`);
  }

  return `<table style="${widthCss}margin:4px 0;"><colgroup>${colgroup}</colgroup><tbody>${rowsHtml.join("")}</tbody></table>`;
}

// ============================================================================
// Document assembly
// ============================================================================

/** Render the collected footnotes and endnotes as linked sections. Called
 *  after the body so references have been numbered in document order. */
async function renderNotesSection(ctx: DocxCtx): Promise<string> {
  const block = async (kind: NoteKind, title: string): Promise<string> => {
    const refs = kind === "fn" ? ctx.fnRefs : ctx.enRefs;
    const map = kind === "fn" ? ctx.footnotes : ctx.endnotes;
    if (!refs.length) return "";
    const items: string[] = [];
    // Index-based loop: rendering a note may reference further notes, which
    // append to the list and get rendered in turn.
    for (let i = 0; i < refs.length; i++) {
      const { id, num } = refs[i];
      const note = map.get(id);
      if (!note) continue;
      let content = "";
      for (const blk of note.children) {
        if (blk.tagName === "w:p") content += (await renderParagraph(ctx, blk)).html;
        else if (blk.tagName === "w:tbl") content += await renderTable(ctx, blk);
      }
      items.push(
        `<div class="note" id="${kind}-${num}"><a class="note-num" href="#${kind}ref-${num}">${noteLabel(kind, num)}</a><div class="note-body">${content}</div></div>`,
      );
    }
    return items.length ? `<div class="notes"><div class="notes-h">${title}</div>${items.join("")}</div>` : "";
  };
  return (await block("fn", "Footnotes")) + (await block("en", "Endnotes"));
}

async function renderDocument(ctx: DocxCtx): Promise<string> {
  const body = descend(ctx.doc.documentElement, "w:body");
  if (!body) throw new Error("Invalid DOCX: empty body");

  // Page geometry from the last section properties
  const sectPr = child(body, "w:sectPr") ?? ctx.doc.getElementsByTagName("w:sectPr")[0];
  const pgSz = child(sectPr, "w:pgSz");
  const pgMar = child(sectPr, "w:pgMar");
  const pageW = twipToPx(intAttr(pgSz, "w:w") ?? 12240);
  const pageH = twipToPx(intAttr(pgSz, "w:h") ?? 15840);
  const mt = twipToPx(intAttr(pgMar, "w:top") ?? 1440);
  const mr = twipToPx(intAttr(pgMar, "w:right") ?? 1440);
  const mb = twipToPx(intAttr(pgMar, "w:bottom") ?? 1440);
  const ml = twipToPx(intAttr(pgMar, "w:left") ?? 1440);

  // Walk blocks, splitting pages at explicit breaks
  const pages: string[][] = [[]];
  const pushPage = () => {
    if (pages[pages.length - 1].length > 0) pages.push([]);
  };

  const walkBlocks = async (parent: Element): Promise<void> => {
    for (const block of parent.children) {
      switch (block.tagName) {
        case "w:p": {
          const result = await renderParagraph(ctx, block);
          if (result.pageBreakBefore) pushPage();
          pages[pages.length - 1].push(result.html);
          if (result.pageBreakAfter) pushPage();
          // A section break mid-document also starts a new page
          if (descend(block, "w:pPr", "w:sectPr")) pushPage();
          break;
        }
        case "w:tbl":
          pages[pages.length - 1].push(await renderTable(ctx, block));
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

  // Footnotes / endnotes, appended on the final page (references are now numbered)
  const notesHtml = await renderNotesSection(ctx);
  if (notesHtml) pages[pages.length - 1].push(notesHtml);

  // Document-wide default text style (docDefaults + default paragraph style)
  const baseChain = buildRPrChain(ctx, undefined, undefined);
  const baseStyles = runStyles(ctx, baseChain);
  if (!baseStyles.some((s) => s.startsWith("font-size"))) baseStyles.push("font-size:14.67px");
  if (!baseStyles.some((s) => s.startsWith("font-family"))) {
    baseStyles.push(`font-family:${cssFontStack(ctx.theme.minorFont)}`);
  }

  const pagesHtml = pages.map((blocks) => `<div class="pg">${blocks.join("")}</div>`).join("");

  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8"><style>',
    "*{margin:0;padding:0;box-sizing:border-box;}",
    "html,body{background:#E9E9ED;}",
    `.pg{width:${px(pageW)};min-height:${px(pageH)};padding:${px(mt)} ${px(mr)} ${px(mb)} ${px(ml)};` +
      `background:#fff;margin:16px auto;box-shadow:0 1px 4px rgba(0,0,0,0.18);` +
      `${baseStyles.join(";")};color:#000;line-height:1.35;display:flow-root;}`,
    ".p{white-space:pre-wrap;word-wrap:break-word;min-height:1em;}",
    "table{border-collapse:collapse;table-layout:fixed;}",
    "td{word-wrap:break-word;}",
    "a{color:#0563C1;text-decoration:underline;}",
    "img{max-width:100%;}",
    ".math-block{display:block;text-align:center;margin:6px 0;}",
    "math{font-size:1.1em;}",
    ".noteref a{color:inherit;text-decoration:none;}",
    ".noteref a:hover{text-decoration:underline;}",
    ".notes{margin-top:20px;padding-top:8px;border-top:1px solid #C9CCD1;}",
    ".notes-h{font-size:0.82em;font-weight:bold;color:#444;margin-bottom:4px;}",
    ".note{display:flex;gap:6px;font-size:0.82em;line-height:1.35;margin:2px 0;}",
    ".note-num{color:#0563C1;text-decoration:none;flex:0 0 auto;min-width:1.4em;text-align:right;}",
    ".note-body .p{min-height:0;}",
    "</style></head><body>",
    pagesHtml,
    // Fit the page to the viewport width
    `<script>(function(){var W=${Math.ceil(pageW) + 32};function f(){var z=Math.min(1,document.documentElement.clientWidth/W);document.body.style.zoom=z;}window.addEventListener('resize',f);f();})();</script>`,
    "</body></html>",
  ].join("");
}
