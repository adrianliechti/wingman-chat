import JSZip from "jszip";
import {
  child,
  cssFontStack,
  emuToPx,
  escapeHtml,
  loadMediaDataUrl,
  mixHex,
  parseThemeDoc,
  parseXml,
  ptToPx,
  px,
  resolveTarget,
} from "./ooxml";
import { type FillResolver, parseChart, renderChartSvg } from "./ooxmlChart";

/**
 * Converts an XLSX file to one self-contained HTML document per sheet with
 * spreadsheet-grade fidelity: cell styles (fonts, fills, borders, number
 * formats), theme & indexed colors, merged cells, column widths and row
 * heights, hyperlinks, and Excel-style row/column headers.
 */

export interface XlsxHtmlResult {
  sheets: { name: string; html: string }[];
}

/** Rendering caps — beyond this the sheet is truncated with a notice. */
const MAX_ROWS = 2000;
const MAX_COLS = 100;

export async function xlsxToHtml(file: File | Blob | ArrayBuffer): Promise<XlsxHtmlResult> {
  const zip = await JSZip.loadAsync(file as Blob);

  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  const ctx: XlsxCtx = {
    zip,
    workbookDoc: workbookXml ? parseXml(workbookXml) : null,
    sharedStrings: [],
    themeColors: [],
    numFmts: new Map(),
    fonts: [],
    fills: [],
    borders: [],
    cellXfs: [],
    dxfs: [],
    date1904: false,
    mediaCache: new Map(),
  };

  loadWorkbookProps(ctx);
  await loadThemeColors(ctx); // before shared strings so rich-text run colors resolve
  await loadSharedStrings(ctx);
  await loadCellStyles(ctx);

  const sheets = await getSheetEntries(ctx);
  if (sheets.length === 0) {
    throw new Error("Invalid XLSX: no sheets found");
  }

  const out: XlsxHtmlResult = { sheets: [] };
  for (const entry of sheets) {
    const xml = await zip.file(entry.path)?.async("string");
    if (!xml) continue;
    const rels = await loadSheetRels(ctx, entry.path);
    const drawing = await loadSheetDrawing(ctx, entry.path);
    out.sheets.push({ name: entry.name, html: await renderSheet(ctx, xml, rels, drawing) });
  }

  if (out.sheets.length === 0) {
    throw new Error("Invalid XLSX: no readable sheets");
  }
  return out;
}

// ============================================================================
// Context & part loading
// ============================================================================

interface FontStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  sizePt?: number;
  color?: string;
  name?: string;
}

interface BorderSide {
  style: string;
  color: string;
}

interface BorderStyle {
  left?: BorderSide;
  right?: BorderSide;
  top?: BorderSide;
  bottom?: BorderSide;
}

interface CellXf {
  numFmtId: number;
  fontId: number;
  fillId: number;
  borderId: number;
  hAlign?: string;
  vAlign?: string;
  wrapText?: boolean;
  indent?: number;
  rotation?: number;
}

/** A shared/inline string: pre-rendered HTML plus its plain text (for matching). */
interface RichString {
  html: string;
  text: string;
}

/** Differential format (ECMA-376 §18.8.14) referenced by conditional rules. */
interface Dxf {
  fontColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fill?: string;
}

interface XlsxCtx {
  zip: JSZip;
  workbookDoc: Document | null;
  sharedStrings: RichString[];
  themeColors: string[];
  numFmts: Map<number, string>;
  fonts: FontStyle[];
  fills: (string | undefined)[];
  borders: BorderStyle[];
  cellXfs: CellXf[];
  dxfs: Dxf[];
  date1904: boolean;
  /** media part path → data URL (embedded drawing images) */
  mediaCache: Map<string, string>;
}

function els(parent: Document | Element | undefined | null, name: string): Element[] {
  if (!parent) return [];
  return Array.from(parent.getElementsByTagNameNS("*", name));
}

function firstEl(parent: Document | Element | undefined | null, name: string): Element | undefined {
  return els(parent, name)[0];
}

function loadWorkbookProps(ctx: XlsxCtx): void {
  const pr = firstEl(ctx.workbookDoc, "workbookPr");
  ctx.date1904 = pr?.getAttribute("date1904") === "1" || pr?.getAttribute("date1904") === "true";
}

async function loadSharedStrings(ctx: XlsxCtx): Promise<void> {
  const xml = await ctx.zip.file("xl/sharedStrings.xml")?.async("string");
  if (!xml) return;
  const doc = parseXml(xml);
  ctx.sharedStrings = els(doc, "si").map((si) => parseRichString(si, ctx));
}

/** CSS for a rich-text run's <rPr> (b/i/u/strike/sz/color/font). */
function richRunStyle(rPr: Element | undefined, ctx: XlsxCtx): string {
  if (!rPr) return "";
  const on = (name: string): boolean => {
    const el = firstEl(rPr, name);
    if (!el) return false;
    const v = el.getAttribute("val");
    return v !== "0" && v !== "false";
  };
  const s: string[] = [];
  if (on("b")) s.push("font-weight:bold");
  if (on("i")) s.push("font-style:italic");
  const deco: string[] = [];
  if (on("u")) deco.push("underline");
  if (on("strike")) deco.push("line-through");
  if (deco.length) s.push(`text-decoration:${deco.join(" ")}`);
  const sz = firstEl(rPr, "sz")?.getAttribute("val");
  if (sz) s.push(`font-size:${px(ptToPx(parseFloat(sz)))}`);
  const color = xlsxColor(firstEl(rPr, "color"), ctx);
  if (color) s.push(`color:${color}`);
  const font = firstEl(rPr, "rFont")?.getAttribute("val") || firstEl(rPr, "name")?.getAttribute("val");
  if (font) s.push(`font-family:${cssFontStack(font)}`);
  return s.join(";");
}

/**
 * Parse a shared-string <si> or inline <is>. Plain strings collapse to escaped
 * text; rich strings (multiple <r> runs) render each run as a styled span so
 * inline bold/italic/color/font is preserved.
 */
function parseRichString(node: Element, ctx: XlsxCtx): RichString {
  const runs = els(node, "r");
  if (!runs.length) {
    const text = els(node, "t")
      .map((t) => t.textContent ?? "")
      .join("");
    return { html: escapeHtml(text), text };
  }
  let html = "";
  let text = "";
  for (const r of runs) {
    const t = firstEl(r, "t")?.textContent ?? "";
    text += t;
    const style = richRunStyle(firstEl(r, "rPr"), ctx);
    html += style ? `<span style="${style};">${escapeHtml(t)}</span>` : escapeHtml(t);
  }
  return { html, text };
}

/** Excel theme color indices: lt1, dk1, lt2, dk2, accent1–6, hlink, folHlink */
async function loadThemeColors(ctx: XlsxCtx): Promise<void> {
  const xml = await ctx.zip.file("xl/theme/theme1.xml")?.async("string");
  if (!xml) {
    ctx.themeColors = [
      "FFFFFF",
      "000000",
      "E7E6E6",
      "44546A",
      "4472C4",
      "ED7D31",
      "A5A5A5",
      "FFC000",
      "5B9BD5",
      "70AD47",
    ];
    return;
  }
  const byName = parseThemeDoc(parseXml(xml)).colors;
  ctx.themeColors = [
    byName.lt1 || "FFFFFF",
    byName.dk1 || "000000",
    byName.lt2 || "E7E6E6",
    byName.dk2 || "44546A",
    byName.accent1 || "4472C4",
    byName.accent2 || "ED7D31",
    byName.accent3 || "A5A5A5",
    byName.accent4 || "FFC000",
    byName.accent5 || "5B9BD5",
    byName.accent6 || "70AD47",
    byName.hlink || "0563C1",
    byName.folHlink || "954F72",
  ];
}

/** Standard legacy indexed palette (subset most files use). */
const INDEXED_COLORS: Record<number, string> = {
  0: "000000",
  1: "FFFFFF",
  2: "FF0000",
  3: "00FF00",
  4: "0000FF",
  5: "FFFF00",
  6: "FF00FF",
  7: "00FFFF",
  8: "000000",
  9: "FFFFFF",
  10: "FF0000",
  11: "00FF00",
  12: "0000FF",
  13: "FFFF00",
  14: "FF00FF",
  15: "00FFFF",
  16: "800000",
  17: "008000",
  18: "000080",
  19: "808000",
  20: "800080",
  21: "008080",
  22: "C0C0C0",
  23: "808080",
  40: "00CCFF",
  41: "CCFFFF",
  42: "CCFFCC",
  43: "FFFF99",
  44: "99CCFF",
  45: "FF99CC",
  46: "CC99FF",
  47: "FFCC99",
  48: "3366FF",
  49: "33CCCC",
  50: "99CC00",
  51: "FFCC00",
  52: "FF9900",
  53: "FF6600",
  54: "666699",
  55: "969696",
  56: "003366",
  57: "339966",
  58: "003300",
  59: "333300",
  60: "993300",
  61: "993366",
  62: "333399",
  63: "333333",
  64: "000000",
  65: "FFFFFF",
};

/** Resolve a <color>-style element (rgb / theme+tint / indexed attributes). */
function xlsxColor(el: Element | undefined, ctx: XlsxCtx): string | undefined {
  if (!el) return undefined;
  if (el.getAttribute("auto") === "1") return undefined;

  const rgb = el.getAttribute("rgb");
  if (rgb) return `#${rgb.length === 8 ? rgb.slice(2) : rgb}`;

  const themeIdx = el.getAttribute("theme");
  if (themeIdx != null) {
    let hex = ctx.themeColors[parseInt(themeIdx, 10)] ?? "000000";
    const tint = parseFloat(el.getAttribute("tint") || "0");
    if (tint) hex = applyTint(hex, tint);
    return `#${hex}`;
  }

  const indexed = el.getAttribute("indexed");
  if (indexed != null) {
    const hex = INDEXED_COLORS[parseInt(indexed, 10)];
    return hex ? `#${hex}` : undefined;
  }
  return undefined;
}

/** Excel tint: positive lightens toward white, negative darkens. */
function applyTint(hex: string, tint: number): string {
  return tint > 0 ? mixHex(hex, 1 - tint, true) : mixHex(hex, 1 + tint, false);
}

async function loadCellStyles(ctx: XlsxCtx): Promise<void> {
  const xml = await ctx.zip.file("xl/styles.xml")?.async("string");
  if (!xml) return;
  const doc = parseXml(xml);

  for (const nf of els(firstEl(doc, "numFmts"), "numFmt")) {
    const id = parseInt(nf.getAttribute("numFmtId") || "", 10);
    const code = nf.getAttribute("formatCode");
    if (!Number.isNaN(id) && code) ctx.numFmts.set(id, code);
  }

  // Presence means "on" unless val explicitly disables (Excel writes
  // <b val="0"/> to switch OFF an inherited toggle).
  const flagOn = (el: Element | undefined): boolean => {
    if (!el) return false;
    const v = el.getAttribute("val");
    return v !== "0" && v !== "false" && v !== "none";
  };

  for (const font of els(firstEl(doc, "fonts"), "font")) {
    const szAttr = firstEl(font, "sz")?.getAttribute("val");
    ctx.fonts.push({
      bold: flagOn(firstEl(font, "b")),
      italic: flagOn(firstEl(font, "i")),
      underline: flagOn(firstEl(font, "u")),
      strike: flagOn(firstEl(font, "strike")),
      sizePt: szAttr ? parseFloat(szAttr) : undefined,
      color: xlsxColor(firstEl(font, "color"), ctx),
      name: firstEl(font, "name")?.getAttribute("val") ?? undefined,
    });
  }

  for (const fill of els(firstEl(doc, "fills"), "fill")) {
    const pattern = firstEl(fill, "patternFill");
    const type = pattern?.getAttribute("patternType");
    if (!pattern || type === "none" || !type) {
      ctx.fills.push(undefined);
      continue;
    }
    // Solid fills use fgColor; approximate other patterns the same way
    ctx.fills.push(xlsxColor(firstEl(pattern, "fgColor"), ctx) ?? xlsxColor(firstEl(pattern, "bgColor"), ctx));
  }

  for (const border of els(firstEl(doc, "borders"), "border")) {
    const side = (name: string): BorderSide | undefined => {
      const el = firstEl(border, name);
      const style = el?.getAttribute("style");
      if (!el || !style || style === "none") return undefined;
      return { style, color: xlsxColor(firstEl(el, "color"), ctx) ?? "#9CA3AF" };
    };
    ctx.borders.push({ left: side("left"), right: side("right"), top: side("top"), bottom: side("bottom") });
  }

  const cellXfs = firstEl(doc, "cellXfs");
  for (const xf of els(cellXfs, "xf")) {
    const alignment = firstEl(xf, "alignment");
    ctx.cellXfs.push({
      numFmtId: parseInt(xf.getAttribute("numFmtId") || "0", 10),
      fontId: parseInt(xf.getAttribute("fontId") || "0", 10),
      fillId: parseInt(xf.getAttribute("fillId") || "0", 10),
      borderId: parseInt(xf.getAttribute("borderId") || "0", 10),
      hAlign: alignment?.getAttribute("horizontal") ?? undefined,
      vAlign: alignment?.getAttribute("vertical") ?? undefined,
      wrapText: alignment?.getAttribute("wrapText") === "1" || alignment?.getAttribute("wrapText") === "true",
      indent: parseInt(alignment?.getAttribute("indent") || "0", 10) || undefined,
      rotation: parseInt(alignment?.getAttribute("textRotation") || "0", 10) || undefined,
    });
  }

  // Differential formats for conditional formatting. In a CF <dxf> the visible
  // highlight is stored in the patternFill's bgColor (not fgColor like a normal
  // cell fill) — a well-known Excel quirk — so prefer bgColor here.
  for (const dxf of els(firstEl(doc, "dxfs"), "dxf")) {
    const font = firstEl(dxf, "font");
    const pattern = firstEl(dxf, "patternFill");
    ctx.dxfs.push({
      fontColor: font ? xlsxColor(firstEl(font, "color"), ctx) : undefined,
      bold: font && firstEl(font, "b") ? flagOn(firstEl(font, "b")) : undefined,
      italic: font && firstEl(font, "i") ? flagOn(firstEl(font, "i")) : undefined,
      underline: font && firstEl(font, "u") ? flagOn(firstEl(font, "u")) : undefined,
      strike: font && firstEl(font, "strike") ? flagOn(firstEl(font, "strike")) : undefined,
      fill: pattern
        ? (xlsxColor(firstEl(pattern, "bgColor"), ctx) ?? xlsxColor(firstEl(pattern, "fgColor"), ctx))
        : undefined,
    });
  }
}

interface SheetEntry {
  name: string;
  path: string;
}

async function getSheetEntries(ctx: XlsxCtx): Promise<SheetEntry[]> {
  const relsXml = await ctx.zip.file("xl/_rels/workbook.xml.rels")?.async("string");

  const rIdToPath = new Map<string, string>();
  if (relsXml) {
    for (const rel of els(parseXml(relsXml), "Relationship")) {
      if ((rel.getAttribute("Type") || "").includes("/worksheet")) {
        let target = rel.getAttribute("Target") || "";
        target = target.replace(/^\.\//, "");
        if (target.startsWith("/")) target = target.slice(1);
        else if (!target.startsWith("xl/")) target = `xl/${target}`;
        rIdToPath.set(rel.getAttribute("Id") || "", target);
      }
    }
  }

  const entries: SheetEntry[] = [];
  if (ctx.workbookDoc) {
    let i = 0;
    for (const sheet of els(ctx.workbookDoc, "sheet")) {
      i++;
      const rId =
        sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ||
        sheet.getAttribute("r:id") ||
        "";
      // Skip hidden sheets in the preview? Keep them — users expect parity with tabs.
      entries.push({
        name: sheet.getAttribute("name") || `Sheet${i}`,
        path: rIdToPath.get(rId) || `xl/worksheets/sheet${i}.xml`,
      });
    }
  }

  if (entries.length === 0) {
    const paths = Object.keys(ctx.zip.files)
      .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(p))
      .sort();
    for (let i = 0; i < paths.length; i++) entries.push({ name: `Sheet${i + 1}`, path: paths[i] });
  }
  return entries;
}

async function loadSheetRels(ctx: XlsxCtx, sheetPath: string): Promise<Map<string, string>> {
  const dir = sheetPath.substring(0, sheetPath.lastIndexOf("/"));
  const name = sheetPath.substring(sheetPath.lastIndexOf("/") + 1);
  const xml = await ctx.zip.file(`${dir}/_rels/${name}.rels`)?.async("string");
  const map = new Map<string, string>();
  if (!xml) return map;
  for (const rel of els(parseXml(xml), "Relationship")) {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (id && target && rel.getAttribute("TargetMode") === "External") map.set(id, target);
  }
  return map;
}

// ============================================================================
// Worksheet drawings (embedded images & charts)
// ============================================================================

interface SheetDrawing {
  doc: Document;
  path: string;
  rels: Map<string, string>;
}

/** Load a worksheet's drawing part (drawingN.xml) and its relationships. */
async function loadSheetDrawing(ctx: XlsxCtx, sheetPath: string): Promise<SheetDrawing | null> {
  const dir = sheetPath.substring(0, sheetPath.lastIndexOf("/"));
  const name = sheetPath.substring(sheetPath.lastIndexOf("/") + 1);
  const relsXml = await ctx.zip.file(`${dir}/_rels/${name}.rels`)?.async("string");
  if (!relsXml) return null;

  let target: string | undefined;
  for (const rel of els(parseXml(relsXml), "Relationship")) {
    if ((rel.getAttribute("Type") || "").endsWith("/drawing")) target = rel.getAttribute("Target") || undefined;
  }
  if (!target) return null;

  const drawingPath = resolveTarget(sheetPath, target);
  const dxml = await ctx.zip.file(drawingPath)?.async("string");
  if (!dxml) return null;

  const ddir = drawingPath.substring(0, drawingPath.lastIndexOf("/"));
  const dname = drawingPath.substring(drawingPath.lastIndexOf("/") + 1);
  const drelsXml = await ctx.zip.file(`${ddir}/_rels/${dname}.rels`)?.async("string");
  const rels = new Map<string, string>();
  if (drelsXml) {
    for (const rel of els(parseXml(drelsXml), "Relationship")) {
      const id = rel.getAttribute("Id");
      const t = rel.getAttribute("Target");
      if (id && t) rels.set(id, t);
    }
  }
  return { doc: parseXml(dxml), path: drawingPath, rels };
}

const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** DrawingML scheme/srgb color resolver for chart fills, using the workbook theme. */
function drawingFill(ctx: XlsxCtx): FillResolver {
  const tc = ctx.themeColors;
  const scheme: Record<string, string | undefined> = {
    lt1: tc[0],
    dk1: tc[1],
    lt2: tc[2],
    dk2: tc[3],
    bg1: tc[0],
    tx1: tc[1],
    bg2: tc[2],
    tx2: tc[3],
    accent1: tc[4],
    accent2: tc[5],
    accent3: tc[6],
    accent4: tc[7],
    accent5: tc[8],
    accent6: tc[9],
    hlink: tc[10],
    folHlink: tc[11],
  };
  return (spPr) => {
    const fill = child(spPr, "a:solidFill");
    if (!fill) return undefined;
    const srgb = child(fill, "a:srgbClr");
    if (srgb?.getAttribute("val")) return `#${srgb.getAttribute("val")}`;
    const sch = child(fill, "a:schemeClr");
    if (sch) {
      const hex = scheme[sch.getAttribute("val") || ""];
      if (hex) return `#${hex}`;
    }
    return undefined;
  };
}

/**
 * Render a sheet's drawings as an absolutely-positioned overlay. `colX`/`rowY`
 * convert a grid cell index to its pixel offset within the rendered table.
 */
async function renderDrawings(
  ctx: XlsxCtx,
  drawing: SheetDrawing,
  colX: (c: number) => number,
  rowY: (r: number) => number,
): Promise<string> {
  const anchors = [...els(drawing.doc, "twoCellAnchor"), ...els(drawing.doc, "oneCellAnchor")];
  if (!anchors.length) return "";

  const accents = ctx.themeColors.slice(4, 10).map((h) => (h ? `#${h}` : undefined));
  const resolveFill = drawingFill(ctx);
  const items: string[] = [];

  for (const anchor of anchors) {
    const from = firstEl(anchor, "from");
    if (!from) continue;
    const num = (parent: Element | undefined, tag: string) => parseInt(firstEl(parent, tag)?.textContent || "0", 10);
    const fromCol = num(from, "col");
    const fromRow = num(from, "row");
    const x = colX(fromCol) + emuToPx(num(from, "colOff"));
    const y = rowY(fromRow) + emuToPx(num(from, "rowOff"));

    let w: number;
    let h: number;
    const to = firstEl(anchor, "to");
    if (to) {
      w = colX(num(to, "col")) + emuToPx(num(to, "colOff")) - x;
      h = rowY(num(to, "row")) + emuToPx(num(to, "rowOff")) - y;
    } else {
      const ext = firstEl(anchor, "ext");
      w = emuToPx(parseInt(ext?.getAttribute("cx") || "0", 10));
      h = emuToPx(parseInt(ext?.getAttribute("cy") || "0", 10));
    }
    if (w <= 0 || h <= 0) continue;
    const pos = `position:absolute;left:${px(x)};top:${px(y)};width:${px(w)};height:${px(h)};`;

    // Picture
    const blip = firstEl(anchor, "blip");
    if (blip) {
      const rId = blip.getAttributeNS(REL_NS, "embed") || blip.getAttribute("r:embed");
      const target = rId ? drawing.rels.get(rId) : undefined;
      if (target) {
        const url = await loadMediaDataUrl(ctx.zip, ctx.mediaCache, resolveTarget(drawing.path, target));
        if (url) items.push(`<img src="${url}" alt="" style="${pos}object-fit:contain;"/>`);
      }
      continue;
    }

    // Chart
    const chartEl = firstEl(anchor, "chart");
    if (chartEl) {
      const rId = chartEl.getAttributeNS(REL_NS, "id") || chartEl.getAttribute("r:id");
      const target = rId ? drawing.rels.get(rId) : undefined;
      if (target) {
        const cxml = await ctx.zip.file(resolveTarget(drawing.path, target))?.async("string");
        if (cxml) {
          const data = parseChart(parseXml(cxml), resolveFill, accents);
          if (data?.series.length) {
            items.push(
              `<div style="${pos}background:#fff;border:1px solid #E3E6EA;">${renderChartSvg(data, w, h)}</div>`,
            );
          }
        }
      }
    }
  }

  return items.length ? `<div style="position:absolute;top:0;left:0;pointer-events:none;">${items.join("")}</div>` : "";
}

// ============================================================================
// Number formatting
// ============================================================================

// US-English built-in number formats (ECMA-376 §18.8.30).
const BUILTIN_FORMATS: Record<number, string> = {
  0: "General",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  12: "# ?/?",
  13: "# ??/??",
  14: "m/d/yyyy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "m/d/yyyy h:mm",
  37: "#,##0;(#,##0)",
  38: "#,##0;[Red](#,##0)",
  39: "#,##0.00;(#,##0.00)",
  40: "#,##0.00;[Red](#,##0.00)",
  44: '_("$"* #,##0.00_);_("$"* (#,##0.00);_("$"* "-"??_);_(@_)',
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mm:ss.0",
  48: "##0.0E+0",
  49: "@",
  // Japanese-locale built-ins (East-Asian Office writes these IDs back with
  // these de-facto codes; the era/weekday tokens are handled below).
  27: "[$-411]ge.m.d",
  28: '[$-411]ggge"年"m"月"d"日"',
  29: '[$-411]ggge"年"m"月"d"日"',
  30: "m/d/yy",
  31: 'yyyy"年"m"月"d"日"',
  55: 'yyyy"年"m"月"',
  56: 'm"月"d"日"',
};

function formatCode(ctx: XlsxCtx, numFmtId: number): string {
  return ctx.numFmts.get(numFmtId) ?? BUILTIN_FORMATS[numFmtId] ?? "General";
}

// ── Date / time ───────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Japanese short / long weekday names (aaa / aaaa format codes). */
const JP_WEEKDAY_SHORT = ["日", "月", "火", "水", "木", "金", "土"];
const JP_WEEKDAY_LONG = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];

/** Japanese imperial eras, newest-first (ECMA-376 §18.8.30 g/gg/ggg, e/ee). */
const JP_ERAS: { start: number; abbr: string; short: string; long: string }[] = [
  { start: Date.UTC(2019, 4, 1), abbr: "R", short: "令", long: "令和" },
  { start: Date.UTC(1989, 0, 8), abbr: "H", short: "平", long: "平成" },
  { start: Date.UTC(1926, 11, 25), abbr: "S", short: "昭", long: "昭和" },
  { start: Date.UTC(1912, 6, 30), abbr: "T", short: "大", long: "大正" },
  { start: Date.UTC(1868, 0, 25), abbr: "M", short: "明", long: "明治" },
];

function resolveJpEra(date: Date): { abbr: string; short: string; long: string; year: number } {
  for (const era of JP_ERAS) {
    if (date.getTime() >= era.start) {
      return {
        abbr: era.abbr,
        short: era.short,
        long: era.long,
        year: date.getUTCFullYear() - new Date(era.start).getUTCFullYear() + 1,
      };
    }
  }
  const last = JP_ERAS[JP_ERAS.length - 1];
  return { abbr: last.abbr, short: last.short, long: last.long, year: date.getUTCFullYear() };
}

/**
 * Convert an Excel date serial to a UTC Date. The 1900 system uses the
 * 1899-12-30 epoch (which absorbs Excel's 1900-leap-year bug); the 1904
 * system is offset by 1462 days, so we fold it into the same conversion.
 */
function excelSerialToUTCDate(serial: number, date1904: boolean): Date {
  const adjusted = date1904 ? serial + 1462 : serial;
  return new Date((adjusted - 25569) * 86400000);
}

/** True if a format code is a date/time format (ECMA-376 §18.8.30). */
function isDateFormatCode(code: string): boolean {
  // Elapsed-time brackets [h]/[m]/[s] are themselves time formats — detect
  // before stripping bracket content.
  if (/\[[hms]+\]/i.test(code)) return true;
  // Strip quoted literals and bracket metadata, then look for date/time tokens.
  // y/m/d/h/s never appear unquoted in a numeric format spec (which uses only
  // #0?.,%Ee), so any of them signals a date/time; aaa+ is the Japanese
  // weekday code. (The reference requires y/d here and so misclassifies
  // time-only "h:mm" and month-name "mmm" formats as plain numbers.)
  const stripped = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
  return /[ymdhs]/i.test(stripped) || /a{3,}/i.test(stripped);
}

/**
 * Format an Excel date serial using an ECMA-376 format code. Supports
 * y/yy/yyyy, m..mmmmm, d..dddd, h/hh (12- or 24-hour via AM/PM), m/mm minutes,
 * s/ss, AM/PM, A/P, [h]/[m]/[s] elapsed time, quoted literals, escapes, and
 * Japanese era (g/gg/ggg, e/ee) and weekday (aaa/aaaa) codes.
 */
function formatExcelDateCode(serial: number, fmtCode: string, date1904: boolean): string {
  const date = excelSerialToUTCDate(serial, date1904);
  const yr = date.getUTCFullYear();
  const mo = date.getUTCMonth() + 1;
  const dy = date.getUTCDate();
  const wd = date.getUTCDay();
  const hr = date.getUTCHours();
  const mi = date.getUTCMinutes();
  const sc = date.getUTCSeconds();

  const section = fmtCode.split(";")[0];
  const hasAmPm = /am\/pm|a\/p/i.test(section);
  let era: ReturnType<typeof resolveJpEra> | null = null;
  const getEra = () => {
    if (!era) era = resolveJpEra(date);
    return era;
  };

  let result = "";
  let i = 0;
  let prevWasHour = false;

  while (i < section.length) {
    const ch = section[i];
    if (ch === '"') {
      i++;
      while (i < section.length && section[i] !== '"') result += section[i++];
      if (i < section.length) i++;
      prevWasHour = false;
    } else if (ch === "[") {
      const end = section.indexOf("]", i);
      const inner = end > i ? section.slice(i + 1, end) : "";
      const elapsed = inner.match(/^([hms])\1*$/i);
      if (elapsed) {
        const kind = elapsed[1].toLowerCase();
        const sign = serial < 0 ? "-" : "";
        const absSec = Math.floor(Math.abs(serial) * 86400);
        const v = kind === "h" ? Math.floor(absSec / 3600) : kind === "m" ? Math.floor(absSec / 60) : absSec;
        result += sign + (inner.length >= 2 ? String(v).padStart(inner.length, "0") : String(v));
        i = end + 1;
        prevWasHour = kind === "h";
      } else {
        i = end >= 0 ? end + 1 : section.length;
      }
    } else if (ch === "_" || ch === "*") {
      i += 2; // pad / fill char pair — drop both
    } else if (ch === "\\") {
      if (i + 1 < section.length) result += section[i + 1];
      i += 2;
      prevWasHour = false;
    } else if (ch === "y" || ch === "Y") {
      let n = 0;
      while (i < section.length && section[i].toLowerCase() === "y") {
        n++;
        i++;
      }
      result += n <= 2 ? String(yr).slice(-2) : String(yr).padStart(4, "0");
      prevWasHour = false;
    } else if (ch === "m" || ch === "M") {
      let n = 0;
      while (i < section.length && section[i].toLowerCase() === "m") {
        n++;
        i++;
      }
      // Minutes when right after h/hh, or right before :s/:ss; else month.
      const rest = section.slice(i).replace(/\[[^\]]*\]/g, "");
      if (prevWasHour || /^:s/i.test(rest)) {
        result += n >= 2 ? String(mi).padStart(2, "0") : String(mi);
      } else if (n === 1) result += String(mo);
      else if (n === 2) result += String(mo).padStart(2, "0");
      else if (n === 3) result += MONTH_NAMES[mo - 1].slice(0, 3);
      else if (n === 4) result += MONTH_NAMES[mo - 1];
      else result += MONTH_NAMES[mo - 1][0];
      prevWasHour = false;
    } else if (ch === "d" || ch === "D") {
      let n = 0;
      while (i < section.length && section[i].toLowerCase() === "d") {
        n++;
        i++;
      }
      if (n === 1) result += String(dy);
      else if (n === 2) result += String(dy).padStart(2, "0");
      else if (n === 3) result += WEEKDAY_NAMES[wd].slice(0, 3);
      else result += WEEKDAY_NAMES[wd];
      prevWasHour = false;
    } else if (ch === "h" || ch === "H") {
      let n = 0;
      while (i < section.length && section[i].toLowerCase() === "h") {
        n++;
        i++;
      }
      const h = hasAmPm ? hr % 12 || 12 : hr;
      result += n >= 2 ? String(h).padStart(2, "0") : String(h);
      prevWasHour = true;
    } else if (ch === "s" || ch === "S") {
      let n = 0;
      while (i < section.length && section[i].toLowerCase() === "s") {
        n++;
        i++;
      }
      result += n >= 2 ? String(sc).padStart(2, "0") : String(sc);
      prevWasHour = false;
    } else if (ch === "g" || ch === "G") {
      let n = 0;
      while (i < section.length && section[i].toLowerCase() === "g") {
        n++;
        i++;
      }
      const e = getEra();
      result += n === 1 ? e.abbr : n === 2 ? e.short : e.long;
      prevWasHour = false;
    } else if (ch === "e" || ch === "E") {
      let n = 0;
      while (i < section.length && section[i].toLowerCase() === "e") {
        n++;
        i++;
      }
      const y = getEra().year;
      result += n >= 2 ? String(y).padStart(2, "0") : String(y);
      prevWasHour = false;
    } else if (ch === "A" || ch === "a") {
      const upper = section.slice(i).toUpperCase();
      if (upper.startsWith("AAAA")) {
        result += JP_WEEKDAY_LONG[wd];
        i += 4;
      } else if (upper.startsWith("AAA")) {
        result += JP_WEEKDAY_SHORT[wd];
        i += 3;
      } else if (upper.startsWith("AM/PM")) {
        result += hr < 12 ? "AM" : "PM";
        i += 5;
      } else if (upper.startsWith("A/P")) {
        result += hr < 12 ? "A" : "P";
        i += 3;
      } else {
        result += ch;
        i++;
      }
      prevWasHour = false;
    } else {
      result += ch;
      i++;
      if (ch !== ":" && ch !== "/" && ch !== "-" && ch !== "." && ch !== " ") prevWasHour = false;
    }
  }
  return result;
}

// ── Numbers ─────────────────────────────────────────────────────────────────

function formatThousands(num: number, decimals: number): string {
  return num.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function countDecimalPlaces(fmt: string): number {
  const m = fmt.match(/\.([0#?]+)/);
  return m ? m[1].length : 0;
}

type FmtToken =
  | { kind: "lit"; text: string }
  | { kind: "num" }
  | { kind: "percent" }
  | { kind: "sci"; expSign: boolean };

/**
 * Split a format section into ordered tokens, preserving literal surroundings
 * (quoted strings, escapes, unquoted symbols like $/€/¥) so they can be
 * reassembled around the formatted number. Drops [..] metadata, _-pad and
 * *-fill pairs (ECMA-376 §18.8.30).
 */
function tokenizeNumberFormat(section: string): { tokens: FmtToken[]; numSpec: string } {
  const tokens: FmtToken[] = [];
  let numSpec = "";
  let numPushed = false;
  let sciPushed = false;
  const pushLit = (s: string) => {
    if (!s) return;
    const last = tokens[tokens.length - 1];
    if (last && last.kind === "lit") last.text += s;
    else tokens.push({ kind: "lit", text: s });
  };
  const ensureNum = () => {
    if (!numPushed) {
      tokens.push({ kind: "num" });
      numPushed = true;
    }
  };

  let i = 0;
  while (i < section.length) {
    const ch = section[i];
    if (ch === '"') {
      i++;
      let s = "";
      while (i < section.length && section[i] !== '"') s += section[i++];
      if (i < section.length) i++;
      pushLit(s);
    } else if (ch === "\\") {
      if (i + 1 < section.length) pushLit(section[i + 1]);
      i += 2;
    } else if (ch === "[") {
      while (i < section.length && section[i] !== "]") i++;
      if (i < section.length) i++;
    } else if (ch === "_" || ch === "*") {
      i += 2;
    } else if (ch === "#" || ch === "0" || ch === "?" || ch === "." || ch === ",") {
      ensureNum();
      numSpec += ch;
      i++;
    } else if (ch === "%") {
      tokens.push({ kind: "percent" });
      i++;
    } else if ((ch === "E" || ch === "e") && (section[i + 1] === "+" || section[i + 1] === "-")) {
      if (!sciPushed) {
        tokens.push({ kind: "sci", expSign: section[i + 1] === "+" });
        sciPushed = true;
      }
      i += 2;
      while (i < section.length && section[i] === "0") i++;
    } else {
      pushLit(ch);
      i++;
    }
  }
  return { tokens, numSpec };
}

function formatNumberSpec(value: number, numSpec: string): string {
  // Trailing commas scale the value down by 1000 each (e.g. #,##0, = thousands,
  // #,##0,, = millions — pervasive in financial statements).
  const scale = numSpec.match(/,+$/);
  if (scale) {
    value /= 1000 ** scale[0].length;
    numSpec = numSpec.slice(0, -scale[0].length);
  }
  const hasThousands = numSpec.includes(",") && /[#0]/.test(numSpec);
  const dec = countDecimalPlaces(numSpec);
  if (hasThousands) return formatThousands(value, dec);
  if (numSpec.includes(".")) return value.toFixed(dec);
  if (/[#0?]/.test(numSpec)) return Math.round(value).toString();
  return String(value);
}

function applyFormatCode(num: number, formatCode: string): string {
  // Up to 4 sections: positive;negative;zero;text (§18.8.30). Pick the one
  // matching the sign; a dedicated negative section formats the magnitude
  // (the minus is conveyed by the section's own literals, e.g. parentheses).
  const sections = formatCode.split(";");
  let section: string;
  let useMagnitude = false;
  if (num > 0) section = sections[0];
  else if (num < 0) {
    if (sections.length > 1) {
      section = sections[1];
      useMagnitude = true;
    } else section = sections[0];
  } else section = sections.length > 2 ? sections[2] : sections[0];

  const { tokens, numSpec } = tokenizeNumberFormat(section);
  const hasPercent = tokens.some((t) => t.kind === "percent");
  const sciTok = tokens.find((t) => t.kind === "sci") as Extract<FmtToken, { kind: "sci" }> | undefined;

  let value = useMagnitude ? Math.abs(num) : num;
  if (hasPercent) value *= 100;

  let numberText: string;
  let expText = "";
  if (sciTok) {
    const dec = countDecimalPlaces(numSpec);
    const [mantissa, exp] = value.toExponential(dec).split("e");
    numberText = mantissa;
    const e = parseInt(exp, 10);
    const sign = e < 0 ? "-" : sciTok.expSign ? "+" : "";
    expText = sign + String(Math.abs(e)).padStart(2, "0");
  } else {
    numberText = formatNumberSpec(value, numSpec);
  }

  let result = "";
  let numberEmitted = false;
  for (const t of tokens) {
    if (t.kind === "lit") result += t.text;
    else if (t.kind === "percent") result += "%";
    else if (t.kind === "num") {
      result += numberText;
      numberEmitted = true;
    } else if (t.kind === "sci") result += `E${expText}`;
  }
  if (!numberEmitted && (numSpec.length > 0 || sciTok)) result += numberText;
  return result;
}

/** Trim binary float noise for the General format without corrupting large ints. */
function formatGeneral(n: number): string {
  return Math.abs(n) >= 1e10 ? String(n) : String(Math.round(n * 1e10) / 1e10);
}

function formatNumberValue(raw: string, code: string, date1904: boolean): string {
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return raw;
  if (code === "General" || code === "@") return formatGeneral(n);
  if (isDateFormatCode(code)) return formatExcelDateCode(n, code, date1904);
  return applyFormatCode(n, code);
}

// ============================================================================
// Sheet rendering
// ============================================================================

function colIndexFromRef(ref: string): number {
  const match = ref.match(/^([A-Z]+)/);
  if (!match) return 0;
  let index = 0;
  for (const ch of match[1]) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

function colLetter(index: number): string {
  let s = "";
  let n = index + 1;
  while (n > 0) {
    s = String.fromCharCode(((n - 1) % 26) + 65) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

interface CellData {
  html: string;
  styleIdx: number;
  /** general-alignment hint: numbers right, text left, bool/error center */
  kind: "n" | "s" | "b";
  link?: string;
  /** raw values for conditional-formatting evaluation */
  num?: number;
  text?: string;
}

// ============================================================================
// Conditional formatting (ECMA-376 §18.3.1)
// ============================================================================

interface CfRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

interface Cfvo {
  kind: string;
  value: string | null;
}

type CfRule =
  | { type: "colorScale"; priority: number; stopVals: number[]; colors: string[] }
  | { type: "dataBar"; priority: number; color: string; min: number; max: number }
  | { type: "iconSet"; priority: number; set: string; reverse: boolean; thresholds: number[] }
  | { type: "cellIs"; priority: number; operator: string; args: CfArg[]; dxfId?: number; stop: boolean }
  | { type: "text"; priority: number; op: string; text: string; dxfId?: number; stop: boolean }
  | { type: "top10"; priority: number; threshold: number; isTop: boolean; dxfId?: number; stop: boolean }
  | { type: "aboveAverage"; priority: number; avg: number; isAbove: boolean; dxfId?: number; stop: boolean }
  | { type: "dupUnique"; priority: number; dupValues: Set<string>; wantDup: boolean; dxfId?: number; stop: boolean };

interface CfArg {
  num?: number;
  text?: string;
}

interface CompiledCf {
  ranges: CfRange[];
  rule: CfRule;
}

interface CfResult {
  bg?: string;
  fontColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  bar?: { color: string; ratio: number };
  icon?: string;
}

function parseCfRange(token: string): CfRange | null {
  const t = token.trim();
  if (!t) return null;
  const [a, b] = t.split(":");
  const r1 = parseInt(a.replace(/^[A-Za-z]+/, ""), 10) - 1;
  const c1 = colIndexFromRef(a.toUpperCase());
  if (Number.isNaN(r1)) return null;
  if (!b) return { top: r1, left: c1, bottom: r1, right: c1 };
  const r2 = parseInt(b.replace(/^[A-Za-z]+/, ""), 10) - 1;
  const c2 = colIndexFromRef(b.toUpperCase());
  return { top: Math.min(r1, r2), left: Math.min(c1, c2), bottom: Math.max(r1, r2), right: Math.max(c1, c2) };
}

function cfRangeHas(ranges: CfRange[], r: number, c: number): boolean {
  return ranges.some((rg) => r >= rg.top && r <= rg.bottom && c >= rg.left && c <= rg.right);
}

/** Resolve a <cfvo> against the range's numeric samples (ECMA-376 §18.3.1.11). */
function resolveCfvo(cfv: Cfvo, samples: number[]): number {
  const n = cfv.value != null ? parseFloat(cfv.value) : NaN;
  const minv = samples.length ? Math.min(...samples) : 0;
  const maxv = samples.length ? Math.max(...samples) : 0;
  switch (cfv.kind) {
    case "min":
      return minv;
    case "max":
      return maxv;
    case "percent":
      return minv + (maxv - minv) * ((Number.isNaN(n) ? 50 : n) / 100);
    case "percentile": {
      if (!samples.length) return 0;
      const s = [...samples].sort((a, b) => a - b);
      const p = (Number.isNaN(n) ? 50 : n) / 100;
      const idx = Math.max(0, Math.min(s.length - 1, Math.round(p * (s.length - 1))));
      return s[idx];
    }
    default: // num, formula (constants), and anything unrecognized
      return Number.isNaN(n) ? 0 : n;
  }
}

/** Parse a cellIs operand: quoted string → text, numeric literal → num, else
 *  a cell reference/formula we can't evaluate (left unset → never matches). */
function parseCfArg(f: string): CfArg {
  const t = f.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return { text: t.slice(1, -1).replace(/""/g, '"') };
  const n = parseFloat(t);
  if (!Number.isNaN(n) && /^[-+]?[\d.eE+]+$/.test(t)) return { num: n };
  return {};
}

function top10Threshold(samples: number[], rank: number, percent: boolean, isTop: boolean): number | null {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  if (!n) return null;
  if (percent) {
    const p = isTop ? 1 - rank / 100 : rank / 100;
    const idx = Math.max(0, Math.min(n - 1, Math.round(p * (n - 1))));
    return sorted[idx];
  }
  const r = Math.min(rank, n);
  return isTop ? sorted[Math.max(0, n - r)] : sorted[Math.min(n - 1, r - 1)];
}

function compileCf(
  doc: Document,
  ctx: XlsxCtx,
  numbersIn: (r: CfRange) => number[],
  textsIn: (r: CfRange) => string[],
): CompiledCf[] {
  const out: CompiledCf[] = [];
  const cfvos = (parent: Element | undefined): Cfvo[] =>
    els(parent, "cfvo").map((v) => ({ kind: v.getAttribute("type") || "num", value: v.getAttribute("val") }));

  for (const cf of els(doc, "conditionalFormatting")) {
    const ranges = (cf.getAttribute("sqref") || "")
      .split(/\s+/)
      .map(parseCfRange)
      .filter((r): r is CfRange => r !== null);
    if (!ranges.length) continue;
    const samples = ranges.flatMap(numbersIn);

    for (const el of els(cf, "cfRule")) {
      const type = el.getAttribute("type");
      const priority = parseInt(el.getAttribute("priority") || "0", 10);
      const dxfId = el.hasAttribute("dxfId") ? parseInt(el.getAttribute("dxfId") || "0", 10) : undefined;
      const stop = el.getAttribute("stopIfTrue") === "1";
      let rule: CfRule | null = null;

      if (type === "colorScale") {
        const cs = firstEl(el, "colorScale");
        rule = {
          type: "colorScale",
          priority,
          stopVals: cfvos(cs).map((v) => resolveCfvo(v, samples)),
          colors: els(cs, "color").map((c) => xlsxColor(c, ctx) ?? "#FFFFFF"),
        };
      } else if (type === "dataBar") {
        const db = firstEl(el, "dataBar");
        const vos = cfvos(db);
        rule = {
          type: "dataBar",
          priority,
          color: xlsxColor(firstEl(db, "color"), ctx) ?? "#638EC6",
          min: resolveCfvo(vos[0] ?? { kind: "min", value: null }, samples),
          max: resolveCfvo(vos[1] ?? { kind: "max", value: null }, samples),
        };
      } else if (type === "iconSet") {
        const is = firstEl(el, "iconSet");
        rule = {
          type: "iconSet",
          priority,
          set: is?.getAttribute("iconSet") || "3TrafficLights1",
          reverse: is?.getAttribute("reverse") === "1",
          thresholds: cfvos(is).map((v) => resolveCfvo(v, samples)),
        };
      } else if (type === "cellIs") {
        rule = {
          type: "cellIs",
          priority,
          operator: el.getAttribute("operator") || "equal",
          args: els(el, "formula").map((f) => parseCfArg(f.textContent || "")),
          dxfId,
          stop,
        };
      } else if (
        type === "containsText" ||
        type === "notContainsText" ||
        type === "beginsWith" ||
        type === "endsWith"
      ) {
        rule = { type: "text", priority, op: type, text: el.getAttribute("text") || "", dxfId, stop };
      } else if (type === "top10") {
        const t = top10Threshold(
          samples,
          parseInt(el.getAttribute("rank") || "10", 10),
          el.getAttribute("percent") === "1",
          el.getAttribute("bottom") !== "1",
        );
        if (t != null)
          rule = { type: "top10", priority, threshold: t, isTop: el.getAttribute("bottom") !== "1", dxfId, stop };
      } else if (type === "aboveAverage") {
        if (samples.length) {
          rule = {
            type: "aboveAverage",
            priority,
            avg: samples.reduce((a, b) => a + b, 0) / samples.length,
            isAbove: el.getAttribute("aboveAverage") !== "0",
            dxfId,
            stop,
          };
        }
      } else if (type === "duplicateValues" || type === "uniqueValues") {
        const freq = new Map<string, number>();
        for (const range of ranges) for (const t of textsIn(range)) freq.set(t, (freq.get(t) || 0) + 1);
        const dupValues = new Set<string>();
        for (const [k, n] of freq) if (n > 1) dupValues.add(k);
        rule = { type: "dupUnique", priority, dupValues, wantDup: type === "duplicateValues", dxfId, stop };
      }
      // type === "expression" is intentionally skipped (needs a formula engine).

      if (rule) out.push({ ranges, rule });
    }
  }

  // Excel evaluates rules by ascending priority (lowest number wins first);
  // per property the first match wins, and stopIfTrue halts later rules.
  out.sort((a, b) => a.rule.priority - b.rule.priority);
  return out;
}

function interpolateHex(a: string, b: string, t: number): string {
  const pa = a.replace("#", "");
  const pb = b.replace("#", "");
  const mix = (i: number) =>
    Math.round(
      parseInt(pa.slice(i, i + 2), 16) + (parseInt(pb.slice(i, i + 2), 16) - parseInt(pa.slice(i, i + 2), 16)) * t,
    )
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${mix(0)}${mix(2)}${mix(4)}`;
}

function colorScaleAt(num: number, vals: number[], colors: string[]): string {
  if (!colors.length) return "#FFFFFF";
  if (num <= vals[0]) return colors[0];
  if (num >= vals[vals.length - 1]) return colors[colors.length - 1];
  for (let i = 1; i < vals.length; i++) {
    if (num <= vals[i]) {
      const lo = vals[i - 1];
      const hi = vals[i];
      return interpolateHex(colors[i - 1], colors[i], hi === lo ? 0 : (num - lo) / (hi - lo));
    }
  }
  return colors[colors.length - 1];
}

/** Map common icon-set families to glyphs. `idx` is 0 (lowest) … count-1. */
function iconGlyph(set: string, idx: number, count: number): string {
  const s = set.toLowerCase();
  const pick = (arr: string[]) => arr[Math.max(0, Math.min(arr.length - 1, idx))];
  if (s.includes("trafficlights") || s.includes("signs"))
    return pick(count >= 4 ? ["⚫", "🔴", "🟡", "🟢"] : ["🔴", "🟡", "🟢"]);
  if (s.includes("symbols")) return pick(["❌", "❗", "✅"]);
  if (s.includes("flags")) return "🚩";
  if (s.includes("arrows")) {
    if (count >= 5) return pick(["⬇️", "↘️", "➡️", "↗️", "⬆️"]);
    if (count === 4) return pick(["⬇️", "↘️", "↗️", "⬆️"]);
    return pick(["🔻", "➡️", "🔺"]);
  }
  if (s.includes("rating") || s.includes("quarters") || s.includes("boxes"))
    return pick(["○", "◔", "◑", "◕", "●"].slice(0, Math.max(3, count)));
  // Fallback: green→yellow→red circles scaled to count.
  return pick(["🔴", "🟠", "🟡", "🟢", "🔵"].slice(0, Math.max(3, count)));
}

function applyCfDxf(result: CfResult, dxf: Dxf | undefined): void {
  if (!dxf) return;
  if (dxf.fill && result.bg == null) result.bg = dxf.fill;
  if (dxf.fontColor && result.fontColor == null) result.fontColor = dxf.fontColor;
  if (dxf.bold && result.bold == null) result.bold = true;
  if (dxf.italic && result.italic == null) result.italic = true;
  if (dxf.underline && result.underline == null) result.underline = true;
  if (dxf.strike && result.strike == null) result.strike = true;
}

function evaluateCf(
  compiled: CompiledCf[],
  ctx: XlsxCtx,
  r: number,
  c: number,
  num: number | null,
  text: string | null,
): CfResult {
  const result: CfResult = {};
  for (const { ranges, rule } of compiled) {
    if (!cfRangeHas(ranges, r, c)) continue;

    switch (rule.type) {
      case "colorScale":
        if (num != null && result.bg == null) result.bg = colorScaleAt(num, rule.stopVals, rule.colors);
        break;
      case "dataBar":
        if (num != null && !result.bar) {
          const range = rule.max - rule.min;
          const ratio = range === 0 ? 0 : Math.max(0, Math.min(1, (num - rule.min) / range));
          result.bar = { color: rule.color, ratio };
        }
        break;
      case "iconSet":
        if (num != null && !result.icon) {
          const t = rule.thresholds;
          let idx = 0;
          for (let i = 1; i < t.length; i++) if (num >= t[i]) idx = i;
          if (rule.reverse) idx = t.length - 1 - idx;
          result.icon = iconGlyph(rule.set, idx, t.length);
        }
        break;
      case "cellIs": {
        let matched = false;
        if (num != null && rule.args.every((a) => a.num != null)) {
          matched = cfNumMatch(
            num,
            rule.operator,
            rule.args.map((a) => a.num as number),
          );
        } else if (text != null && rule.args.every((a) => a.text != null)) {
          matched = cfTextMatch(
            text,
            rule.operator,
            rule.args.map((a) => a.text as string),
          );
        }
        if (matched) {
          applyCfDxf(result, rule.dxfId != null ? ctx.dxfs[rule.dxfId] : undefined);
          if (rule.stop) return result;
        }
        break;
      }
      case "text": {
        if (text == null) break;
        const hay = text.toLowerCase();
        const needle = rule.text.toLowerCase();
        const matched =
          rule.op === "containsText"
            ? hay.includes(needle)
            : rule.op === "notContainsText"
              ? !hay.includes(needle)
              : rule.op === "beginsWith"
                ? hay.startsWith(needle)
                : hay.endsWith(needle);
        if (matched) {
          applyCfDxf(result, rule.dxfId != null ? ctx.dxfs[rule.dxfId] : undefined);
          if (rule.stop) return result;
        }
        break;
      }
      case "top10":
        if (num != null && (rule.isTop ? num >= rule.threshold : num <= rule.threshold)) {
          applyCfDxf(result, rule.dxfId != null ? ctx.dxfs[rule.dxfId] : undefined);
          if (rule.stop) return result;
        }
        break;
      case "aboveAverage":
        if (num != null && (rule.isAbove ? num > rule.avg : num < rule.avg)) {
          applyCfDxf(result, rule.dxfId != null ? ctx.dxfs[rule.dxfId] : undefined);
          if (rule.stop) return result;
        }
        break;
      case "dupUnique": {
        const key = text ?? (num != null ? String(num) : null);
        if (key != null && rule.dupValues.has(key) === rule.wantDup) {
          applyCfDxf(result, rule.dxfId != null ? ctx.dxfs[rule.dxfId] : undefined);
          if (rule.stop) return result;
        }
        break;
      }
    }
  }
  return result;
}

function cfNumMatch(n: number, op: string, args: number[]): boolean {
  switch (op) {
    case "greaterThan":
      return n > args[0];
    case "greaterThanOrEqual":
      return n >= args[0];
    case "lessThan":
      return n < args[0];
    case "lessThanOrEqual":
      return n <= args[0];
    case "equal":
      return n === args[0];
    case "notEqual":
      return n !== args[0];
    case "between":
      return n >= args[0] && n <= args[1];
    case "notBetween":
      return n < args[0] || n > args[1];
    default:
      return false;
  }
}

function cfTextMatch(text: string, op: string, args: string[]): boolean {
  const a = (text ?? "").toLowerCase();
  const b = (args[0] ?? "").toLowerCase();
  switch (op) {
    case "equal":
      return a === b;
    case "notEqual":
      return a !== b;
    case "containsText":
      return a.includes(b);
    case "beginsWith":
      return a.startsWith(b);
    case "endsWith":
      return a.endsWith(b);
    default:
      return false;
  }
}

/** "#RRGGBB" → "rgba(r,g,b,a)" for translucent data-bar fills. */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

async function renderSheet(
  ctx: XlsxCtx,
  xml: string,
  extRels: Map<string, string>,
  drawing: SheetDrawing | null,
): Promise<string> {
  const doc = parseXml(xml);

  const sheetView = firstEl(doc, "sheetView");
  const showGridLines = sheetView?.getAttribute("showGridLines") !== "0";

  // Frozen panes (Freeze Panes): xSplit/ySplit = count of frozen cols/rows.
  const pane = firstEl(sheetView, "pane");
  const paneState = pane?.getAttribute("state");
  const frozen = paneState === "frozen" || paneState === "frozenSplit";
  const frozenRows = frozen ? parseInt(pane?.getAttribute("ySplit") || "0", 10) || 0 : 0;
  const frozenCols = frozen ? parseInt(pane?.getAttribute("xSplit") || "0", 10) || 0 : 0;

  // Column widths (Excel width unit ≈ characters of Calibri 11 ≈ 7px)
  const colWidthPx = new Map<number, number>();
  const hiddenCols = new Set<number>();
  for (const col of els(firstEl(doc, "cols"), "col")) {
    const min = parseInt(col.getAttribute("min") || "1", 10) - 1;
    const max = parseInt(col.getAttribute("max") || "1", 10) - 1;
    const width = parseFloat(col.getAttribute("width") || "0");
    const hidden = col.getAttribute("hidden") === "1";
    for (let c = min; c <= Math.min(max, MAX_COLS - 1); c++) {
      if (width) colWidthPx.set(c, Math.round(width * 7 + 5));
      if (hidden) hiddenCols.add(c);
    }
  }

  // Merged ranges
  const mergeStart = new Map<string, { cols: number; rows: number }>();
  const mergedAway = new Set<string>();
  for (const merge of els(firstEl(doc, "mergeCells"), "mergeCell")) {
    const ref = merge.getAttribute("ref") || "";
    const [a, b] = ref.split(":");
    if (!a || !b) continue;
    const c1 = colIndexFromRef(a);
    const r1 = parseInt(a.replace(/^[A-Z]+/, ""), 10) - 1;
    const c2 = colIndexFromRef(b);
    const r2 = parseInt(b.replace(/^[A-Z]+/, ""), 10) - 1;
    mergeStart.set(`${r1}:${c1}`, { cols: c2 - c1 + 1, rows: r2 - r1 + 1 });
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        if (r !== r1 || c !== c1) mergedAway.add(`${r}:${c}`);
      }
    }
  }

  // Hyperlinks
  const links = new Map<string, string>();
  for (const link of els(firstEl(doc, "hyperlinks"), "hyperlink")) {
    const ref = link.getAttribute("ref");
    const rId =
      link.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ||
      link.getAttribute("r:id");
    const target = rId ? extRels.get(rId) : undefined;
    if (!ref || !target) continue;
    const [a, b] = ref.split(":");
    if (!b) {
      links.set(a, target);
      continue;
    }
    // Ranged hyperlink (e.g. "A1:C3") covers every cell in the range
    const c1 = colIndexFromRef(a);
    const r1 = parseInt(a.replace(/^[A-Z]+/, ""), 10);
    const c2 = colIndexFromRef(b);
    const r2 = parseInt(b.replace(/^[A-Z]+/, ""), 10);
    if ((r2 - r1 + 1) * (c2 - c1 + 1) > 10000) {
      links.set(a, target);
      continue;
    }
    for (let rr = r1; rr <= r2; rr++) {
      for (let cc = c1; cc <= c2; cc++) links.set(`${colLetter(cc)}${rr}`, target);
    }
  }

  // Cells
  const rowData = new Map<number, Map<number, CellData>>();
  const rowHeightPx = new Map<number, number>();
  const hiddenRows = new Set<number>();
  let maxRow = -1;
  let maxCol = -1;
  let truncated = false;

  for (const row of els(firstEl(doc, "sheetData"), "row")) {
    const r = parseInt(row.getAttribute("r") || "0", 10) - 1;
    if (r < 0) continue;
    if (r >= MAX_ROWS) {
      truncated = true;
      break;
    }
    const ht = row.getAttribute("ht");
    if (ht) rowHeightPx.set(r, ptToPx(parseFloat(ht)));
    if (row.getAttribute("hidden") === "1") hiddenRows.add(r);

    let positional = 0;
    const cells = new Map<number, CellData>();
    for (const cell of els(row, "c")) {
      const ref = cell.getAttribute("r");
      const c = ref ? colIndexFromRef(ref) : positional;
      positional = c + 1;
      if (c >= MAX_COLS) {
        truncated = true;
        continue;
      }

      const type = cell.getAttribute("t") || "n";
      const styleIdx = parseInt(cell.getAttribute("s") || "0", 10);
      const vEl = firstEl(cell, "v");
      const v = vEl?.textContent ?? "";

      let html = "";
      let kind: CellData["kind"] = "n";
      let rawNum: number | undefined;
      let rawText: string | undefined;
      if (type === "s") {
        const ss = ctx.sharedStrings[parseInt(v, 10)];
        html = ss?.html ?? "";
        rawText = ss?.text ?? "";
        kind = "s";
      } else if (type === "str") {
        rawText = v;
        html = escapeHtml(v);
        kind = "s";
      } else if (type === "inlineStr" || (!vEl && firstEl(cell, "is"))) {
        const isEl = firstEl(cell, "is");
        const rich = isEl ? parseRichString(isEl, ctx) : { html: "", text: "" };
        html = rich.html;
        rawText = rich.text;
        kind = "s";
      } else if (type === "b") {
        html = v === "1" ? "TRUE" : "FALSE";
        kind = "b";
      } else if (type === "e") {
        html = escapeHtml(v);
        kind = "b";
      } else if (v !== "") {
        const xf = ctx.cellXfs[styleIdx];
        const n = parseFloat(v);
        if (!Number.isNaN(n)) rawNum = n;
        html = escapeHtml(formatNumberValue(v, formatCode(ctx, xf?.numFmtId ?? 0), ctx.date1904));
        kind = "n";
      }

      if (html === "" && styleIdx === 0) continue;
      const link = ref ? links.get(ref) : undefined;
      cells.set(c, { html, styleIdx, kind, link, num: rawNum, text: rawText });
      maxCol = Math.max(maxCol, c);
    }
    if (cells.size > 0 || rowHeightPx.has(r)) {
      rowData.set(r, cells);
      maxRow = Math.max(maxRow, r);
    }
  }

  // Also extend bounds to cover merges and styled columns
  for (const key of mergeStart.keys()) {
    const [r, c] = key.split(":").map(Number);
    maxRow = Math.max(maxRow, r);
    maxCol = Math.max(maxCol, c);
  }
  maxRow = Math.min(maxRow, MAX_ROWS - 1);
  maxCol = Math.min(maxCol, MAX_COLS - 1);

  const gridBorder = showGridLines ? "1px solid #E3E6EA" : "1px solid transparent";

  // Build table
  const colgroup: string[] = ['<col style="width:46px"/>'];
  for (let c = 0; c <= maxCol; c++) {
    if (hiddenCols.has(c)) continue;
    colgroup.push(`<col style="width:${px(colWidthPx.get(c) ?? 64)}"/>`);
  }

  const headerCells: string[] = ['<th class="rn"></th>'];
  for (let c = 0; c <= maxCol; c++) {
    if (hiddenCols.has(c)) continue;
    headerCells.push(`<th>${colLetter(c)}</th>`);
  }

  const sideCss = (side: BorderSide | undefined): string | undefined => {
    if (!side) return undefined;
    const w = side.style.includes("thick") ? 2.5 : side.style.includes("medium") ? 2 : 1;
    const styleCss = side.style.includes("dash")
      ? "dashed"
      : side.style.includes("dot")
        ? "dotted"
        : side.style === "double"
          ? "double"
          : "solid";
    return `${w}px ${styleCss} ${side.color}`;
  };

  // Base cell style declarations depend only on (styleIdx, kind) — sheets have
  // at most dozens of distinct xfs, so memoize instead of rebuilding per cell.
  // Returns the inner CSS (no `style="…"` wrapper) so per-cell conditional
  // formatting can be appended after it (later declarations win → CF overrides).
  const styleCache = new Map<string, string>();
  const cellStyleCss = (styleIdx: number, kind: CellData["kind"]): string => {
    const cacheKey = `${styleIdx}|${kind}`;
    const cached = styleCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const xf = ctx.cellXfs[styleIdx];
    const styles: string[] = [];

    const font = xf ? ctx.fonts[xf.fontId] : undefined;
    if (font) {
      if (font.bold) styles.push("font-weight:bold");
      if (font.italic) styles.push("font-style:italic");
      const deco: string[] = [];
      if (font.underline) deco.push("underline");
      if (font.strike) deco.push("line-through");
      if (deco.length) styles.push(`text-decoration:${deco.join(" ")}`);
      if (font.sizePt && font.sizePt !== 11) styles.push(`font-size:${px(ptToPx(font.sizePt))}`);
      if (font.color) styles.push(`color:${font.color}`);
      if (font.name) styles.push(`font-family:${cssFontStack(font.name)}`);
    }

    const fill = xf ? ctx.fills[xf.fillId] : undefined;
    if (fill) styles.push(`background:${fill}`);

    const border = xf ? ctx.borders[xf.borderId] : undefined;
    for (const [name, sideVal] of [
      ["left", border?.left],
      ["right", border?.right],
      ["top", border?.top],
      ["bottom", border?.bottom],
    ] as const) {
      const css = sideCss(sideVal);
      if (css) styles.push(`border-${name}:${css}`);
    }

    // Alignment: explicit, else Excel "general" (numbers right, bool center)
    const hAlign = xf?.hAlign ?? (kind === "n" ? "right" : kind === "b" ? "center" : undefined);
    if (hAlign && hAlign !== "general") styles.push(`text-align:${hAlign === "centerContinuous" ? "center" : hAlign}`);
    if (xf?.vAlign === "center") styles.push("vertical-align:middle");
    else if (xf?.vAlign === "top") styles.push("vertical-align:top");
    if (xf?.wrapText) styles.push("white-space:pre-wrap", "word-wrap:break-word");

    // Indent (~8px per level), applied on the alignment side.
    if (xf?.indent) {
      const pad = 4 + xf.indent * 8;
      styles.push(hAlign === "right" ? `padding-right:${pad}px` : `padding-left:${pad}px`);
    }

    const result = styles.join(";");
    styleCache.set(cacheKey, result);
    return result;
  };

  // Conditional formatting: compile once per sheet against the data bounds.
  // Sample only populated cells so whole-column sqrefs (e.g. "A1:A1048576")
  // stay cheap.
  const numbersIn = (range: CfRange): number[] => {
    const out: number[] = [];
    for (const [r, cellsRow] of rowData) {
      if (r < range.top || r > range.bottom) continue;
      for (const [c, d] of cellsRow) {
        if (c >= range.left && c <= range.right && d.num != null) out.push(d.num);
      }
    }
    return out;
  };
  const textsIn = (range: CfRange): string[] => {
    const out: string[] = [];
    for (const [r, cellsRow] of rowData) {
      if (r < range.top || r > range.bottom) continue;
      for (const [c, d] of cellsRow) {
        if (c < range.left || c > range.right) continue;
        const key = d.text ?? (d.num != null ? String(d.num) : undefined);
        if (key != null) out.push(key);
      }
    }
    return out;
  };
  const cfRules = compileCf(doc, ctx, numbersIn, textsIn);

  // Pixel geometry of the grid (shared by frozen panes and the drawing overlay).
  // colX/rowY give a cell's offset from the table's top-left, accounting for the
  // leading row-number column and header row, skipping hidden tracks.
  const ROWNUM_W = 46;
  const HEADER_H = 20;
  const colW = (c: number) => (hiddenCols.has(c) ? 0 : (colWidthPx.get(c) ?? 64));
  const rowH = (r: number) => (hiddenRows.has(r) ? 0 : (rowHeightPx.get(r) ?? 20));
  const colX = (c: number) => {
    let x = ROWNUM_W;
    for (let i = 0; i < c; i++) x += colW(i);
    return x;
  };
  const rowY = (r: number) => {
    let y = HEADER_H;
    for (let i = 0; i < r; i++) y += rowH(i);
    return y;
  };

  const bodyRows: string[] = [];
  for (let r = 0; r <= maxRow; r++) {
    if (hiddenRows.has(r)) continue;
    const cells = rowData.get(r) ?? new Map<number, CellData>();
    const frozenR = r < frozenRows;
    // Row-number cell: sticky-left always; also sticky-top when in a frozen row.
    const rnSticky = frozenR ? ` style="top:${px(rowY(r))};z-index:6;"` : "";
    const tds: string[] = [`<td class="rn"${rnSticky}>${r + 1}</td>`];

    for (let c = 0; c <= maxCol; c++) {
      if (hiddenCols.has(c)) continue;
      if (mergedAway.has(`${r}:${c}`)) continue;

      const data = cells.get(c);
      const merge = mergeStart.get(`${r}:${c}`);
      const frozenC = c < frozenCols;

      const decls: string[] = [];
      // Frozen cells need an opaque background so scrolled content doesn't show
      // through; placed first so the cell's own fill/CF background wins.
      if (frozenR || frozenC) decls.push("background:#fff");
      const base = data ? cellStyleCss(data.styleIdx, data.kind) : "";
      if (base) decls.push(base);

      let iconHtml = "";
      if (data && cfRules.length) {
        const cf = evaluateCf(cfRules, ctx, r, c, data.num ?? null, data.text ?? null);
        // Data bar paints behind the value; its translucent gradient overlays
        // the (already-emitted) base background-color.
        if (cf.bar) {
          const pct = Math.round(cf.bar.ratio * 100);
          decls.push(
            `background-image:linear-gradient(90deg,${hexToRgba(cf.bar.color, 0.85)} ${pct}%,transparent ${pct}%)`,
            "background-repeat:no-repeat",
          );
        }
        if (cf.bg) decls.push(`background-color:${cf.bg}`);
        if (cf.fontColor) decls.push(`color:${cf.fontColor}`);
        if (cf.bold) decls.push("font-weight:bold");
        if (cf.italic) decls.push("font-style:italic");
        const deco: string[] = [];
        if (cf.underline) deco.push("underline");
        if (cf.strike) deco.push("line-through");
        if (deco.length) decls.push(`text-decoration:${deco.join(" ")}`);
        if (cf.icon) iconHtml = `<span class="cf-ico">${cf.icon}</span>`;
      }

      // Text spill: an unwrapped text cell overflows into adjacent empty cells
      // (Excel's default for long labels). Left/general spills right, right-align
      // spills left, center spills if both sides are free.
      const xf = data ? ctx.cellXfs[data.styleIdx] : undefined;
      if (data && data.kind === "s" && data.html && !xf?.wrapText) {
        const hA = xf?.hAlign;
        const emptyAt = (cc: number) =>
          cc < 0 || cc > maxCol || (!cells.get(cc) && !mergedAway.has(`${r}:${cc}`) && !mergeStart.has(`${r}:${cc}`));
        const isLeft = !hA || hA === "left" || hA === "general";
        const spill =
          (isLeft && emptyAt(c + 1)) ||
          (hA === "right" && emptyAt(c - 1)) ||
          (hA === "center" && emptyAt(c + 1) && emptyAt(c - 1));
        if (spill) decls.push("overflow:visible");
      }

      // Frozen panes: stick the cell within the scroll viewport.
      if (frozenR || frozenC) {
        decls.push("position:sticky");
        if (frozenR) decls.push(`top:${px(rowY(r))}`);
        if (frozenC) decls.push(`left:${px(colX(c))}`);
        decls.push(`z-index:${frozenR && frozenC ? 6 : 5}`);
      }

      const styleAttr = decls.length ? ` style="${decls.join(";")};"` : "";

      // Span only visible tracks — a merge crossing a hidden row/col must not
      // count it, or the colspan/rowspan overshoots and misaligns the row.
      let spanAttrs = "";
      if (merge) {
        let cols = merge.cols;
        let rows = merge.rows;
        for (let cc = c; cc < c + merge.cols; cc++) if (hiddenCols.has(cc)) cols--;
        for (let rr = r; rr < r + merge.rows; rr++) if (hiddenRows.has(rr)) rows--;
        spanAttrs = `${cols > 1 ? ` colspan="${cols}"` : ""}${rows > 1 ? ` rowspan="${rows}"` : ""}`;
      }
      let inner = data?.link
        ? `<a href="${escapeHtml(data.link)}" target="_blank" rel="noreferrer">${data.html}</a>`
        : (data?.html ?? "");
      // Text rotation: 1–90 = counter-clockwise, 91–180 = clockwise (val−90),
      // 255 = vertically stacked. Wrap content so the cell box stays put.
      const rot = data ? ctx.cellXfs[data.styleIdx]?.rotation : undefined;
      if (rot && inner) {
        const transform = rot === 255 ? "" : `transform:rotate(${rot <= 90 ? -rot : rot - 90}deg);`;
        const css =
          rot === 255
            ? "writing-mode:vertical-rl;text-orientation:upright;"
            : `display:inline-block;${transform}transform-origin:center;white-space:nowrap;`;
        inner = `<span style="${css}">${inner}</span>`;
      }
      tds.push(`<td${spanAttrs}${styleAttr}>${iconHtml}${inner}</td>`);
    }

    const ht = rowHeightPx.get(r);
    bodyRows.push(`<tr${ht ? ` style="height:${px(ht)};"` : ""}>${tds.join("")}</tr>`);
  }

  const truncationNote = truncated
    ? `<div class="trunc">Preview truncated to ${MAX_ROWS} rows × ${MAX_COLS} columns — download the file for the full sheet.</div>`
    : "";

  // Drawing overlay (images & charts), positioned with the shared grid geometry.
  let overlay = "";
  if (drawing) {
    overlay = await renderDrawings(ctx, drawing, colX, rowY);
  }

  const tableHtml =
    `<table><colgroup>${colgroup.join("")}</colgroup><thead><tr>${headerCells.join("")}</tr></thead><tbody>` +
    `${bodyRows.join("")}</tbody></table>`;
  const grid = overlay
    ? `<div style="position:relative;display:inline-block;">${tableHtml}${overlay}</div>`
    : tableHtml;

  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8"><style>',
    "*{margin:0;padding:0;box-sizing:border-box;}",
    "html,body{background:#fff;}",
    "body{font-family:Calibri, 'Segoe UI', system-ui, sans-serif;font-size:14.67px;color:#111;}",
    "table{border-collapse:collapse;table-layout:fixed;}",
    `td{border:${gridBorder};padding:1px 4px;height:20px;overflow:hidden;white-space:nowrap;text-overflow:clip;vertical-align:bottom;}`,
    "th{background:#F6F7F9;border:1px solid #DEE1E6;color:#5F6368;font-weight:normal;font-size:11.5px;height:20px;position:sticky;top:0;z-index:2;}",
    "td.rn{background:#F6F7F9;border:1px solid #DEE1E6;color:#5F6368;text-align:center;font-size:11.5px;position:sticky;left:0;z-index:1;}",
    "th.rn{left:0;z-index:3;position:sticky;}",
    "a{color:#0563C1;}",
    ".cf-ico{display:inline-block;width:1.1em;margin-right:3px;text-align:center;font-size:0.85em;line-height:1;}",
    ".trunc{padding:6px 10px;background:#FFF7E0;color:#8A6D1A;font-size:12px;border-bottom:1px solid #EFE3B5;position:sticky;top:0;z-index:4;}",
    "</style></head><body>",
    truncationNote,
    grid,
    "</body></html>",
  ].join("");
}
