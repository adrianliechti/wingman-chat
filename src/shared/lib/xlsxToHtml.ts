import JSZip from "jszip";
import {
  assertOoxmlInputSize,
  child,
  cssFontStack,
  emuToPx,
  escapeHtml,
  loadMediaDataUrl,
  mixHex,
  normalizeHexColor,
  OoxmlPackageReader,
  OoxmlResourceLimitError,
  parseThemeDoc,
  parseXml,
  ptToPx,
  px,
  resolveTarget,
  sanitizeHyperlinkUrl,
} from "./ooxml";
import { type FillResolver, parseChart, renderChartSvg } from "./ooxmlChart";

/**
 * Converts an XLSX file to one self-contained HTML document per sheet with
 * spreadsheet-grade fidelity: cell styles (fonts, fills, borders, number
 * formats), theme & indexed colors, merged cells, column widths and row
 * heights, hyperlinks, and Excel-style row/column headers.
 */

export interface XlsxCellView {
  /** Zero-based indexes in the visible (hidden tracks removed) grid. */
  row: number;
  column: number;
  sourceRow: number;
  sourceColumn: number;
  html: string;
  text: string;
  css: string;
  rowSpan: number;
  columnSpan: number;
  spill: boolean;
}

export interface XlsxSheetView {
  name: string;
  rowCount: number;
  columnCount: number;
  /** Display labels retain authored row/column coordinates across hidden tracks. */
  rowNumbers: readonly number[];
  columnLabels: readonly string[];
  rowHeights: readonly number[];
  columnWidths: readonly number[];
  frozenRows: number;
  frozenColumns: number;
  showGridLines: boolean;
  overlayHtml: string;
  truncated: boolean;
  cellAt(row: number, column: number): XlsxCellView | null;
}

export interface XlsxSheetHandle {
  name: string;
  /** Parse/materialize this sheet on demand. Recently viewed sheets are cached. */
  load(): Promise<XlsxSheetView>;
}

export interface XlsxHtmlResult {
  sheets: XlsxSheetHandle[];
}

/** Hard materialization limits; viewport rendering itself is virtualized. */
export const MAX_XLSX_ROWS = 100_000;
export const MAX_XLSX_COLS = 16_384;
export const MAX_XLSX_CELLS = 250_000;
const MAX_XLSX_MERGED_CELLS = 250_000;
const MAX_XLSX_DRAWING_OBJECTS = 2_000;
const MAX_CACHED_XLSX_SHEETS = 4;
const MAX_XLSX_SHARED_STRINGS = 250_000;
const MAX_XLSX_STYLE_RECORDS = 100_000;
const MAX_XLSX_COLUMN_ASSIGNMENTS = 250_000;
const MAX_XLSX_HYPERLINK_CELLS = 100_000;
const MAX_XLSX_CF_RULES = 2_000;
const MAX_XLSX_CF_RANGES = 4_096;
const MAX_XLSX_SHEETS = 1_024;

export async function xlsxToHtml(file: File | Blob | ArrayBuffer): Promise<XlsxHtmlResult> {
  assertOoxmlInputSize(file);
  const zip = await JSZip.loadAsync(file as Blob);
  const reader = new OoxmlPackageReader(zip);

  const workbookXml = await reader.text("xl/workbook.xml");
  const ctx: XlsxCtx = {
    reader,
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
  if (sheets.length > MAX_XLSX_SHEETS) {
    throw new OoxmlResourceLimitError(
      `Workbook contains ${sheets.length} sheets, over the ${MAX_XLSX_SHEETS}-sheet limit`,
    );
  }

  const availableSheets = sheets.filter((entry) => reader.has(entry.path));
  if (availableSheets.length === 0) {
    throw new Error("Invalid XLSX: no readable sheets");
  }

  const cache = new Map<number, Promise<XlsxSheetView>>();
  const loadSheet = (entry: SheetEntry, index: number): Promise<XlsxSheetView> => {
    const cached = cache.get(index);
    if (cached) {
      cache.delete(index);
      cache.set(index, cached);
      return cached;
    }
    const pending = (async () => {
      const xml = await reader.text(entry.path);
      if (!xml) throw new Error(`Invalid XLSX: missing ${entry.path}`);
      const [rels, drawing] = await Promise.all([loadSheetRels(ctx, entry.path), loadSheetDrawing(ctx, entry.path)]);
      return renderSheet(ctx, entry.name, xml, rels, drawing);
    })();
    cache.set(index, pending);
    while (cache.size > MAX_CACHED_XLSX_SHEETS) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
    pending.catch(() => {
      if (cache.get(index) === pending) cache.delete(index);
    });
    return pending;
  };

  return {
    sheets: availableSheets.map((entry, index) => ({
      name: entry.name,
      load: () => loadSheet(entry, index),
    })),
  };
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
  reader: OoxmlPackageReader;
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
  const xml = await ctx.reader.text("xl/sharedStrings.xml");
  if (!xml) return;
  const doc = parseXml(xml);
  const strings = els(doc, "si");
  if (strings.length > MAX_XLSX_SHARED_STRINGS) {
    throw new OoxmlResourceLimitError(
      `Workbook contains ${strings.length} shared strings, over the ${MAX_XLSX_SHARED_STRINGS}-string limit`,
    );
  }
  ctx.sharedStrings = strings.map((si) => parseRichString(si, ctx));
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
  const xml = await ctx.reader.text("xl/theme/theme1.xml");
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
  if (rgb) {
    const hex = normalizeHexColor(rgb.length === 8 ? rgb.slice(2) : rgb);
    if (hex) return `#${hex}`;
  }

  const themeIdx = el.getAttribute("theme");
  if (themeIdx != null) {
    let hex = ctx.themeColors[parseInt(themeIdx, 10)] ?? "000000";
    const parsedTint = parseFloat(el.getAttribute("tint") || "0");
    const tint = Number.isFinite(parsedTint) ? Math.max(-1, Math.min(1, parsedTint)) : 0;
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
  const xml = await ctx.reader.text("xl/styles.xml");
  if (!xml) return;
  const doc = parseXml(xml);

  const numFormats = els(firstEl(doc, "numFmts"), "numFmt");
  const fontElements = els(firstEl(doc, "fonts"), "font");
  const fillElements = els(firstEl(doc, "fills"), "fill");
  const borderElements = els(firstEl(doc, "borders"), "border");
  const xfElements = els(firstEl(doc, "cellXfs"), "xf");
  const dxfElements = els(firstEl(doc, "dxfs"), "dxf");
  const styleRecordCount =
    numFormats.length +
    fontElements.length +
    fillElements.length +
    borderElements.length +
    xfElements.length +
    dxfElements.length;
  if (styleRecordCount > MAX_XLSX_STYLE_RECORDS) {
    throw new OoxmlResourceLimitError(
      `Workbook contains ${styleRecordCount} style records, over the ${MAX_XLSX_STYLE_RECORDS}-record limit`,
    );
  }

  for (const nf of numFormats) {
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

  for (const font of fontElements) {
    const szAttr = firstEl(font, "sz")?.getAttribute("val");
    const parsedSize = szAttr ? parseFloat(szAttr) : undefined;
    ctx.fonts.push({
      bold: flagOn(firstEl(font, "b")),
      italic: flagOn(firstEl(font, "i")),
      underline: flagOn(firstEl(font, "u")),
      strike: flagOn(firstEl(font, "strike")),
      sizePt: parsedSize && Number.isFinite(parsedSize) ? Math.max(1, Math.min(400, parsedSize)) : undefined,
      color: xlsxColor(firstEl(font, "color"), ctx),
      name: firstEl(font, "name")?.getAttribute("val") ?? undefined,
    });
  }

  for (const fill of fillElements) {
    const pattern = firstEl(fill, "patternFill");
    const type = pattern?.getAttribute("patternType");
    if (!pattern || type === "none" || !type) {
      ctx.fills.push(undefined);
      continue;
    }
    // Solid fills use fgColor; approximate other patterns the same way
    ctx.fills.push(xlsxColor(firstEl(pattern, "fgColor"), ctx) ?? xlsxColor(firstEl(pattern, "bgColor"), ctx));
  }

  for (const border of borderElements) {
    const side = (name: string): BorderSide | undefined => {
      const el = firstEl(border, name);
      const style = el?.getAttribute("style");
      if (!el || !style || style === "none") return undefined;
      return { style, color: xlsxColor(firstEl(el, "color"), ctx) ?? "#9CA3AF" };
    };
    ctx.borders.push({ left: side("left"), right: side("right"), top: side("top"), bottom: side("bottom") });
  }

  for (const xf of xfElements) {
    const alignment = firstEl(xf, "alignment");
    ctx.cellXfs.push({
      numFmtId: parseInt(xf.getAttribute("numFmtId") || "0", 10),
      fontId: parseInt(xf.getAttribute("fontId") || "0", 10),
      fillId: parseInt(xf.getAttribute("fillId") || "0", 10),
      borderId: parseInt(xf.getAttribute("borderId") || "0", 10),
      hAlign: alignment?.getAttribute("horizontal") ?? undefined,
      vAlign: alignment?.getAttribute("vertical") ?? undefined,
      wrapText: alignment?.getAttribute("wrapText") === "1" || alignment?.getAttribute("wrapText") === "true",
      indent: Math.max(0, Math.min(250, parseInt(alignment?.getAttribute("indent") || "0", 10) || 0)) || undefined,
      rotation:
        Math.max(0, Math.min(255, parseInt(alignment?.getAttribute("textRotation") || "0", 10) || 0)) || undefined,
    });
  }

  // Differential formats for conditional formatting. In a CF <dxf> the visible
  // highlight is stored in the patternFill's bgColor (not fgColor like a normal
  // cell fill) — a well-known Excel quirk — so prefer bgColor here.
  for (const dxf of dxfElements) {
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
  const relsXml = await ctx.reader.text("xl/_rels/workbook.xml.rels");

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
    const paths = ctx.reader.paths.filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(p)).sort();
    for (let i = 0; i < paths.length; i++) entries.push({ name: `Sheet${i + 1}`, path: paths[i] });
  }
  return entries;
}

async function loadSheetRels(ctx: XlsxCtx, sheetPath: string): Promise<Map<string, string>> {
  const dir = sheetPath.substring(0, sheetPath.lastIndexOf("/"));
  const name = sheetPath.substring(sheetPath.lastIndexOf("/") + 1);
  const xml = await ctx.reader.text(`${dir}/_rels/${name}.rels`);
  const map = new Map<string, string>();
  if (!xml) return map;
  for (const rel of els(parseXml(xml), "Relationship")) {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    const safeTarget = target ? sanitizeHyperlinkUrl(target) : undefined;
    if (id && safeTarget && rel.getAttribute("TargetMode") === "External") map.set(id, safeTarget);
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
  const relsXml = await ctx.reader.text(`${dir}/_rels/${name}.rels`);
  if (!relsXml) return null;

  let target: string | undefined;
  for (const rel of els(parseXml(relsXml), "Relationship")) {
    if ((rel.getAttribute("Type") || "").endsWith("/drawing")) target = rel.getAttribute("Target") || undefined;
  }
  if (!target) return null;

  const drawingPath = resolveTarget(sheetPath, target);
  const dxml = await ctx.reader.text(drawingPath);
  if (!dxml) return null;

  const ddir = drawingPath.substring(0, drawingPath.lastIndexOf("/"));
  const dname = drawingPath.substring(drawingPath.lastIndexOf("/") + 1);
  const drelsXml = await ctx.reader.text(`${ddir}/_rels/${dname}.rels`);
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
    const srgbHex = normalizeHexColor(srgb?.getAttribute("val"));
    if (srgbHex) return `#${srgbHex}`;
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
  if (anchors.length > MAX_XLSX_DRAWING_OBJECTS) {
    throw new OoxmlResourceLimitError(
      `Worksheet drawing contains ${anchors.length} objects, over the ${MAX_XLSX_DRAWING_OBJECTS}-object limit`,
    );
  }

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
        const url = await loadMediaDataUrl(ctx.reader, ctx.mediaCache, resolveTarget(drawing.path, target));
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
        const cxml = await ctx.reader.text(resolveTarget(drawing.path, target));
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
  if (!match) return -1;
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
  displayText: string;
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
  if (Number.isNaN(r1) || r1 < 0 || c1 < 0) return null;
  if (!b) return { top: r1, left: c1, bottom: r1, right: c1 };
  const r2 = parseInt(b.replace(/^[A-Za-z]+/, ""), 10) - 1;
  const c2 = colIndexFromRef(b.toUpperCase());
  if (Number.isNaN(r2) || r2 < 0 || c2 < 0) return null;
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
  let rangeCount = 0;
  const cfvos = (parent: Element | undefined): Cfvo[] =>
    els(parent, "cfvo").map((v) => ({ kind: v.getAttribute("type") || "num", value: v.getAttribute("val") }));

  for (const cf of els(doc, "conditionalFormatting")) {
    const ranges = (cf.getAttribute("sqref") || "")
      .split(/\s+/)
      .map(parseCfRange)
      .filter((r): r is CfRange => r !== null);
    if (!ranges.length) continue;
    rangeCount += ranges.length;
    if (rangeCount > MAX_XLSX_CF_RANGES) {
      throw new OoxmlResourceLimitError(
        `Worksheet conditional formatting exceeds the ${MAX_XLSX_CF_RANGES}-range limit`,
      );
    }
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

      if (rule) {
        out.push({ ranges, rule });
        if (out.length > MAX_XLSX_CF_RULES) {
          throw new OoxmlResourceLimitError(
            `Worksheet conditional formatting exceeds the ${MAX_XLSX_CF_RULES}-rule limit`,
          );
        }
      }
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
  name: string,
  xml: string,
  extRels: Map<string, string>,
  drawing: SheetDrawing | null,
): Promise<XlsxSheetView> {
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
  let authoredMaxColumn = -1;
  let truncated = false;
  let columnAssignments = 0;
  for (const col of els(firstEl(doc, "cols"), "col")) {
    const min = parseInt(col.getAttribute("min") || "1", 10) - 1;
    const max = parseInt(col.getAttribute("max") || "1", 10) - 1;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) continue;
    const parsedWidth = parseFloat(col.getAttribute("width") || "0");
    const width =
      Number.isFinite(parsedWidth) && parsedWidth > 0 ? Math.max(2, Math.min(2_048, parsedWidth * 7 + 5)) : 0;
    const hidden = col.getAttribute("hidden") === "1";
    if (max >= MAX_XLSX_COLS) truncated = true;
    const first = Math.max(0, min);
    const last = Math.min(max, MAX_XLSX_COLS - 1);
    if (first > last) continue;
    columnAssignments += last - first + 1;
    if (columnAssignments > MAX_XLSX_COLUMN_ASSIGNMENTS) {
      throw new OoxmlResourceLimitError(
        `Worksheet column definitions cover more than the ${MAX_XLSX_COLUMN_ASSIGNMENTS}-assignment limit`,
      );
    }
    authoredMaxColumn = Math.max(authoredMaxColumn, last);
    for (let c = first; c <= last; c++) {
      if (width) colWidthPx.set(c, Math.round(width));
      if (hidden) hiddenCols.add(c);
    }
  }

  // Merged ranges are admitted by covered-cell count before any expansion.
  const mergeRanges: { top: number; left: number; bottom: number; right: number }[] = [];
  let mergedCellCount = 0;
  for (const merge of els(firstEl(doc, "mergeCells"), "mergeCell")) {
    const ref = (merge.getAttribute("ref") || "").toUpperCase();
    const [a, b] = ref.split(":");
    if (!a || !b) continue;
    const c1 = colIndexFromRef(a);
    const r1 = parseInt(a.replace(/^[A-Z]+/, ""), 10) - 1;
    const c2 = colIndexFromRef(b);
    const r2 = parseInt(b.replace(/^[A-Z]+/, ""), 10) - 1;
    if ([r1, c1, r2, c2].some((value) => !Number.isInteger(value) || value < 0)) continue;
    const top = Math.min(r1, r2);
    const left = Math.min(c1, c2);
    const bottom = Math.min(Math.max(r1, r2), MAX_XLSX_ROWS - 1);
    const right = Math.min(Math.max(c1, c2), MAX_XLSX_COLS - 1);
    if (Math.max(r1, r2) >= MAX_XLSX_ROWS || Math.max(c1, c2) >= MAX_XLSX_COLS) truncated = true;
    if (top > bottom || left > right) continue;
    mergedCellCount += (bottom - top + 1) * (right - left + 1);
    if (mergedCellCount > MAX_XLSX_MERGED_CELLS) {
      throw new OoxmlResourceLimitError(
        `Worksheet merged ranges cover more than the ${MAX_XLSX_MERGED_CELLS}-cell limit`,
      );
    }
    mergeRanges.push({ top, left, bottom, right });
  }

  // Hyperlinks
  const links = new Map<string, string>();
  let hyperlinkCells = 0;
  for (const link of els(firstEl(doc, "hyperlinks"), "hyperlink")) {
    const ref = link.getAttribute("ref")?.toUpperCase();
    const rId =
      link.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ||
      link.getAttribute("r:id");
    const target = rId ? extRels.get(rId) : undefined;
    if (!ref || !target) continue;
    const [a, b] = ref.split(":");
    if (!b) {
      if (++hyperlinkCells > MAX_XLSX_HYPERLINK_CELLS) {
        throw new OoxmlResourceLimitError(`Worksheet hyperlinks exceed the ${MAX_XLSX_HYPERLINK_CELLS}-cell limit`);
      }
      links.set(a, target);
      continue;
    }
    // Ranged hyperlink (e.g. "A1:C3") covers every cell in the range
    const c1 = colIndexFromRef(a);
    const r1 = parseInt(a.replace(/^[A-Z]+/, ""), 10);
    const c2 = colIndexFromRef(b);
    const r2 = parseInt(b.replace(/^[A-Z]+/, ""), 10);
    if ([r1, c1, r2, c2].some((value) => !Number.isInteger(value) || value < 0) || r2 < r1 || c2 < c1) continue;
    const coveredCells = (r2 - r1 + 1) * (c2 - c1 + 1);
    if (coveredCells > 10_000) {
      if (++hyperlinkCells > MAX_XLSX_HYPERLINK_CELLS) {
        throw new OoxmlResourceLimitError(`Worksheet hyperlinks exceed the ${MAX_XLSX_HYPERLINK_CELLS}-cell limit`);
      }
      links.set(a, target);
      continue;
    }
    hyperlinkCells += coveredCells;
    if (hyperlinkCells > MAX_XLSX_HYPERLINK_CELLS) {
      throw new OoxmlResourceLimitError(`Worksheet hyperlinks exceed the ${MAX_XLSX_HYPERLINK_CELLS}-cell limit`);
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
  let materializedCellCount = 0;
  let materializedRowCount = 0;

  for (const row of els(firstEl(doc, "sheetData"), "row")) {
    materializedRowCount++;
    if (materializedRowCount > MAX_XLSX_ROWS) {
      throw new OoxmlResourceLimitError(`Worksheet contains more than the ${MAX_XLSX_ROWS}-row limit`);
    }
    const r = parseInt(row.getAttribute("r") || "0", 10) - 1;
    if (!Number.isInteger(r) || r < 0) continue;
    if (r >= MAX_XLSX_ROWS) {
      truncated = true;
      continue;
    }
    const ht = row.getAttribute("ht");
    if (ht) {
      const height = ptToPx(parseFloat(ht));
      if (Number.isFinite(height) && height > 0) rowHeightPx.set(r, Math.min(2_048, height));
    }
    if (row.getAttribute("hidden") === "1") hiddenRows.add(r);

    let positional = 0;
    const cells = new Map<number, CellData>();
    for (const cell of els(row, "c")) {
      materializedCellCount++;
      if (materializedCellCount > MAX_XLSX_CELLS) {
        throw new OoxmlResourceLimitError(`Worksheet contains more than the ${MAX_XLSX_CELLS}-cell limit`);
      }
      const ref = cell.getAttribute("r")?.toUpperCase();
      const c = ref ? colIndexFromRef(ref) : positional;
      positional = c + 1;
      if (c < 0) continue;
      if (c >= MAX_XLSX_COLS) {
        truncated = true;
        continue;
      }

      const type = cell.getAttribute("t") || "n";
      const parsedStyleIndex = parseInt(cell.getAttribute("s") || "0", 10);
      const styleIdx = Number.isInteger(parsedStyleIndex) && parsedStyleIndex >= 0 ? parsedStyleIndex : 0;
      const vEl = firstEl(cell, "v");
      const v = vEl?.textContent ?? "";

      let html = "";
      let displayText = "";
      let kind: CellData["kind"] = "n";
      let rawNum: number | undefined;
      let rawText: string | undefined;
      if (type === "s") {
        const ss = ctx.sharedStrings[parseInt(v, 10)];
        html = ss?.html ?? "";
        displayText = ss?.text ?? "";
        rawText = displayText;
        kind = "s";
      } else if (type === "str") {
        rawText = v;
        displayText = v;
        html = escapeHtml(v);
        kind = "s";
      } else if (type === "inlineStr" || (!vEl && firstEl(cell, "is"))) {
        const isEl = firstEl(cell, "is");
        const rich = isEl ? parseRichString(isEl, ctx) : { html: "", text: "" };
        html = rich.html;
        displayText = rich.text;
        rawText = displayText;
        kind = "s";
      } else if (type === "b") {
        displayText = v === "1" ? "TRUE" : "FALSE";
        html = displayText;
        kind = "b";
      } else if (type === "e") {
        displayText = v;
        html = escapeHtml(v);
        kind = "b";
      } else if (v !== "") {
        const xf = ctx.cellXfs[styleIdx];
        const n = parseFloat(v);
        if (!Number.isNaN(n)) rawNum = n;
        displayText = formatNumberValue(v, formatCode(ctx, xf?.numFmtId ?? 0), ctx.date1904);
        html = escapeHtml(displayText);
        kind = "n";
      }

      if (html === "" && styleIdx === 0) continue;
      const link = ref ? links.get(ref) : undefined;
      cells.set(c, { html, displayText, styleIdx, kind, link, num: rawNum, text: rawText });
      maxCol = Math.max(maxCol, c);
    }
    if (cells.size > 0 || rowHeightPx.has(r)) {
      rowData.set(r, cells);
      maxRow = Math.max(maxRow, r);
    }
  }

  // Also extend bounds to cover merges and explicitly described columns.
  for (const merge of mergeRanges) {
    maxRow = Math.max(maxRow, merge.bottom);
    maxCol = Math.max(maxCol, merge.right);
  }
  maxCol = Math.max(maxCol, authoredMaxColumn);
  maxRow = Math.max(0, Math.min(maxRow, MAX_XLSX_ROWS - 1));
  maxCol = Math.max(0, Math.min(maxCol, MAX_XLSX_COLS - 1));

  const gridBorder = showGridLines ? "1px solid #E3E6EA" : "1px solid transparent";

  const visibleRows = Array.from({ length: maxRow + 1 }, (_, index) => index).filter((row) => !hiddenRows.has(row));
  const visibleColumns = Array.from({ length: maxCol + 1 }, (_, index) => index).filter(
    (column) => !hiddenCols.has(column),
  );
  // Keep an addressable grid even when every authored track is hidden.
  if (visibleRows.length === 0) visibleRows.push(0);
  if (visibleColumns.length === 0) visibleColumns.push(0);

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
    const cssAlignment =
      hAlign === "centerContinuous"
        ? "center"
        : hAlign && ["left", "right", "center", "justify", "fill", "distributed"].includes(hAlign)
          ? hAlign
          : undefined;
    if (cssAlignment) styles.push(`text-align:${cssAlignment}`);
    if (xf?.vAlign === "center") styles.push("align-items:center");
    else if (xf?.vAlign === "top") styles.push("align-items:flex-start");
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

  // Pixel geometry of the data grid. Hidden tracks have zero extent and are
  // removed from the virtualizer's visible index space below.
  const colW = (c: number) => (hiddenCols.has(c) ? 0 : (colWidthPx.get(c) ?? 64));
  const rowH = (r: number) => (hiddenRows.has(r) ? 0 : (rowHeightPx.get(r) ?? 20));
  const columnOffsets = [0];
  for (let column = 0; column <= maxCol; column++) {
    columnOffsets.push(columnOffsets[column] + colW(column));
  }
  const rowOffsets = [0];
  for (let row = 0; row <= maxRow; row++) rowOffsets.push(rowOffsets[row] + rowH(row));
  const colX = (column: number) => columnOffsets[Math.max(0, Math.min(column, maxCol + 1))];
  const rowY = (row: number) => rowOffsets[Math.max(0, Math.min(row, maxRow + 1))];

  const actualToVisibleRow = new Map(visibleRows.map((row, index) => [row, index]));
  const actualToVisibleColumn = new Map(visibleColumns.map((column, index) => [column, index]));
  const mergeStarts = new Map<
    string,
    { sourceRow: number; sourceColumn: number; rowSpan: number; columnSpan: number }
  >();
  const mergedAway = new Set<string>();
  for (const merge of mergeRanges) {
    const rows: number[] = [];
    const columns: number[] = [];
    for (let row = merge.top; row <= merge.bottom; row++) {
      const visible = actualToVisibleRow.get(row);
      if (visible !== undefined) rows.push(visible);
    }
    for (let column = merge.left; column <= merge.right; column++) {
      const visible = actualToVisibleColumn.get(column);
      if (visible !== undefined) columns.push(visible);
    }
    const firstRow = rows[0];
    const firstColumn = columns[0];
    if (firstRow === undefined || firstColumn === undefined) continue;
    mergeStarts.set(`${firstRow}:${firstColumn}`, {
      sourceRow: merge.top,
      sourceColumn: merge.left,
      rowSpan: rows.length,
      columnSpan: columns.length,
    });
    for (const row of rows) {
      for (const column of columns) {
        if (row !== firstRow || column !== firstColumn) mergedAway.add(`${row}:${column}`);
      }
    }
  }

  // Cache authored and merged cells only. Virtual scrolling can visit millions
  // of blank coordinates over time, so retaining generated blank grid cells
  // would defeat the bounded sparse model.
  const renderedCells = new Map<string, XlsxCellView>();
  const cellAt = (viewRow: number, viewColumn: number): XlsxCellView | null => {
    if (viewRow < 0 || viewRow >= visibleRows.length || viewColumn < 0 || viewColumn >= visibleColumns.length) {
      return null;
    }
    const cacheKey = `${viewRow}:${viewColumn}`;
    const cached = renderedCells.get(cacheKey);
    if (cached) return cached;
    if (mergedAway.has(cacheKey)) return null;

    const merge = mergeStarts.get(cacheKey);
    const sourceRow = merge?.sourceRow ?? visibleRows[viewRow];
    const sourceColumn = merge?.sourceColumn ?? visibleColumns[viewColumn];
    const data = rowData.get(sourceRow)?.get(sourceColumn);
    const declarations = [`border:${gridBorder}`];
    const base = data ? cellStyleCss(data.styleIdx, data.kind) : "";
    if (base) declarations.push(base);

    let iconHtml = "";
    if (data && cfRules.length) {
      const cf = evaluateCf(cfRules, ctx, sourceRow, sourceColumn, data.num ?? null, data.text ?? null);
      if (cf.bar) {
        const percent = Math.round(cf.bar.ratio * 100);
        declarations.push(
          `background-image:linear-gradient(90deg,${hexToRgba(cf.bar.color, 0.85)} ${percent}%,transparent ${percent}%)`,
          "background-repeat:no-repeat",
        );
      }
      if (cf.bg) declarations.push(`background-color:${cf.bg}`);
      if (cf.fontColor) declarations.push(`color:${cf.fontColor}`);
      if (cf.bold) declarations.push("font-weight:bold");
      if (cf.italic) declarations.push("font-style:italic");
      const decorations: string[] = [];
      if (cf.underline) decorations.push("underline");
      if (cf.strike) decorations.push("line-through");
      if (decorations.length) declarations.push(`text-decoration:${decorations.join(" ")}`);
      if (cf.icon) iconHtml = `<span class="cf-ico">${cf.icon}</span>`;
    }

    const xf = data ? ctx.cellXfs[data.styleIdx] : undefined;
    let spill = false;
    if (data && !merge && data.kind === "s" && data.html && !xf?.wrapText) {
      const emptyAt = (column: number) => {
        if (column < 0 || column >= visibleColumns.length) return true;
        const key = `${viewRow}:${column}`;
        return !rowData.get(sourceRow)?.has(visibleColumns[column]) && !mergedAway.has(key) && !mergeStarts.has(key);
      };
      const alignment = xf?.hAlign;
      const leftAligned = !alignment || alignment === "left" || alignment === "general";
      if (
        (leftAligned && emptyAt(viewColumn + 1)) ||
        (alignment === "right" && emptyAt(viewColumn - 1)) ||
        (alignment === "center" && emptyAt(viewColumn - 1) && emptyAt(viewColumn + 1))
      ) {
        declarations.push("overflow:visible");
        spill = true;
      }
    }

    let inner = data?.link
      ? `<a href="${escapeHtml(data.link)}" target="_blank" rel="noopener noreferrer">${data.html}</a>`
      : (data?.html ?? "");
    const rotation = data ? ctx.cellXfs[data.styleIdx]?.rotation : undefined;
    if (rotation && inner) {
      const transform = rotation === 255 ? "" : `transform:rotate(${rotation <= 90 ? -rotation : rotation - 90}deg);`;
      const css =
        rotation === 255
          ? "writing-mode:vertical-rl;text-orientation:upright;"
          : `display:inline-block;${transform}transform-origin:center;white-space:nowrap;`;
      inner = `<span style="${css}">${inner}</span>`;
    }

    const result: XlsxCellView = {
      row: viewRow,
      column: viewColumn,
      sourceRow,
      sourceColumn,
      html: iconHtml + inner,
      text: data?.displayText ?? "",
      css: declarations.join(";"),
      rowSpan: merge?.rowSpan ?? 1,
      columnSpan: merge?.columnSpan ?? 1,
      spill,
    };
    if (data || merge) renderedCells.set(cacheKey, result);
    return result;
  };

  const overlayHtml = drawing ? await renderDrawings(ctx, drawing, colX, rowY) : "";
  return {
    name,
    rowCount: visibleRows.length,
    columnCount: visibleColumns.length,
    rowNumbers: visibleRows.map((row) => row + 1),
    columnLabels: visibleColumns.map(colLetter),
    rowHeights: visibleRows.map(rowH),
    columnWidths: visibleColumns.map(colW),
    frozenRows: visibleRows.filter((row) => row < frozenRows).length,
    frozenColumns: visibleColumns.filter((column) => column < frozenCols).length,
    showGridLines,
    overlayHtml,
    truncated,
    cellAt,
  };
}
