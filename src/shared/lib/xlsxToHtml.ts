import JSZip from "jszip";
import { escapeHtml, parseXml, ptToPx, px } from "./ooxml";

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

  const ctx: XlsxCtx = {
    zip,
    sharedStrings: [],
    themeColors: [],
    numFmts: new Map(),
    fonts: [],
    fills: [],
    borders: [],
    cellXfs: [],
    date1904: false,
  };

  await loadWorkbookProps(ctx);
  await loadSharedStrings(ctx);
  await loadThemeColors(ctx);
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
    out.sheets.push({ name: entry.name, html: renderSheet(ctx, xml, rels) });
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
}

interface XlsxCtx {
  zip: JSZip;
  sharedStrings: string[];
  themeColors: string[];
  numFmts: Map<number, string>;
  fonts: FontStyle[];
  fills: (string | undefined)[];
  borders: BorderStyle[];
  cellXfs: CellXf[];
  date1904: boolean;
}

function els(parent: Document | Element | undefined | null, name: string): Element[] {
  if (!parent) return [];
  return Array.from(parent.getElementsByTagNameNS("*", name));
}

function firstEl(parent: Document | Element | undefined | null, name: string): Element | undefined {
  return els(parent, name)[0];
}

async function loadWorkbookProps(ctx: XlsxCtx): Promise<void> {
  const xml = await ctx.zip.file("xl/workbook.xml")?.async("string");
  if (!xml) return;
  const pr = firstEl(parseXml(xml), "workbookPr");
  ctx.date1904 = pr?.getAttribute("date1904") === "1" || pr?.getAttribute("date1904") === "true";
}

async function loadSharedStrings(ctx: XlsxCtx): Promise<void> {
  const xml = await ctx.zip.file("xl/sharedStrings.xml")?.async("string");
  if (!xml) return;
  const doc = parseXml(xml);
  ctx.sharedStrings = els(doc, "si").map((si) =>
    els(si, "t")
      .map((t) => t.textContent ?? "")
      .join(""),
  );
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
  const doc = parseXml(xml);
  const scheme = firstEl(doc, "clrScheme");
  const byName: Record<string, string> = {};
  if (scheme) {
    for (const slot of scheme.children) {
      const name = slot.tagName.replace("a:", "");
      const hex =
        firstEl(slot, "srgbClr")?.getAttribute("val") || firstEl(slot, "sysClr")?.getAttribute("lastClr") || "";
      byName[name] = hex;
    }
  }
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
  const c = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  const out = c.map((v) => {
    const n = tint > 0 ? v + (255 - v) * tint : v * (1 + tint);
    return Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  });
  return out.join("").toUpperCase();
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

  for (const font of els(firstEl(doc, "fonts"), "font")) {
    const szAttr = firstEl(font, "sz")?.getAttribute("val");
    ctx.fonts.push({
      bold: !!firstEl(font, "b"),
      italic: !!firstEl(font, "i"),
      underline: !!firstEl(font, "u"),
      strike: !!firstEl(font, "strike"),
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
    });
  }
}

interface SheetEntry {
  name: string;
  path: string;
}

async function getSheetEntries(ctx: XlsxCtx): Promise<SheetEntry[]> {
  const workbookXml = await ctx.zip.file("xl/workbook.xml")?.async("string");
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
  if (workbookXml) {
    let i = 0;
    for (const sheet of els(parseXml(workbookXml), "sheet")) {
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
    paths.forEach((p, i) => entries.push({ name: `Sheet${i + 1}`, path: p }));
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
// Number formatting
// ============================================================================

const BUILTIN_FORMATS: Record<number, string> = {
  0: "General",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  14: "m/d/yyyy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "m/d/yyyy h:mm",
  37: "#,##0",
  38: "#,##0",
  39: "#,##0.00",
  40: "#,##0.00",
  44: "#,##0.00",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mm:ss.0",
  49: "@",
};

function formatCode(ctx: XlsxCtx, numFmtId: number): string {
  return ctx.numFmts.get(numFmtId) ?? BUILTIN_FORMATS[numFmtId] ?? "General";
}

function isDateFormat(code: string): boolean {
  // Strip quoted literals, bracketed sections and color codes before probing
  const bare = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
  return /[ymdhs]/i.test(bare) && !/[#0]/.test(bare);
}

function excelSerialToDate(serial: number, date1904: boolean): Date {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(epoch + serial * 86400000);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatNumberValue(raw: string, code: string, date1904: boolean): string {
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return raw;

  if (code === "General") {
    // Trim float noise, keep up to 10 significant digits
    const s = String(Math.round(n * 1e10) / 1e10);
    return s;
  }

  if (isDateFormat(code)) {
    const d = excelSerialToDate(n, date1904);
    const bare = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
    const hasDate = /[ymd]/i.test(bare);
    const hasTime = /[hs]|AM\/PM/i.test(bare);
    const datePart = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    const timePart = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
    if (hasDate && hasTime) return `${datePart} ${timePart}`;
    if (hasTime) return timePart;
    return datePart;
  }

  // Use only the positive section of multi-part formats
  const section = code.split(";")[0];
  const percent = section.includes("%");
  const value = percent ? n * 100 : n;

  // Decimal places from the format's ".00" run
  const decMatch = section.match(/\.([0#]+)/);
  const decimals = decMatch ? decMatch[1].length : 0;
  const grouped = section.includes(",");

  let s = grouped
    ? value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : value.toFixed(decimals);

  if (percent) s += "%";

  // Carry simple currency prefixes through ("$"#,##0.00 / [$CHF] etc.)
  const currency = section.match(/\[\$([^\]-]+)[^\]]*\]/)?.[1] ?? section.match(/^"([^"]+)"/)?.[1];
  if (currency) s = `${currency} ${s}`;
  else if (section.trimStart().startsWith("$")) s = `$${s}`;

  return s;
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
}

function renderSheet(ctx: XlsxCtx, xml: string, extRels: Map<string, string>): string {
  const doc = parseXml(xml);

  const showGridLines = firstEl(doc, "sheetView")?.getAttribute("showGridLines") !== "0";

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
    if (ref && target) links.set(ref.split(":")[0], target);
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
      if (type === "s") {
        html = escapeHtml(ctx.sharedStrings[parseInt(v, 10)] ?? "");
        kind = "s";
      } else if (type === "str") {
        html = escapeHtml(v);
        kind = "s";
      } else if (type === "inlineStr" || (!vEl && firstEl(cell, "is"))) {
        html = escapeHtml(
          els(firstEl(cell, "is"), "t")
            .map((t) => t.textContent ?? "")
            .join(""),
        );
        kind = "s";
      } else if (type === "b") {
        html = v === "1" ? "TRUE" : "FALSE";
        kind = "b";
      } else if (type === "e") {
        html = escapeHtml(v);
        kind = "b";
      } else if (v !== "") {
        const xf = ctx.cellXfs[styleIdx];
        html = escapeHtml(formatNumberValue(v, formatCode(ctx, xf?.numFmtId ?? 0), ctx.date1904));
        kind = "n";
      }

      if (html === "" && styleIdx === 0) continue;
      const link = ref ? links.get(ref) : undefined;
      cells.set(c, { html, styleIdx, kind, link });
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

  const bodyRows: string[] = [];
  for (let r = 0; r <= maxRow; r++) {
    if (hiddenRows.has(r)) continue;
    const cells = rowData.get(r) ?? new Map<number, CellData>();
    const tds: string[] = [`<td class="rn">${r + 1}</td>`];

    for (let c = 0; c <= maxCol; c++) {
      if (hiddenCols.has(c)) continue;
      if (mergedAway.has(`${r}:${c}`)) continue;

      const data = cells.get(c);
      const merge = mergeStart.get(`${r}:${c}`);
      const xf = data ? ctx.cellXfs[data.styleIdx] : undefined;

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
        if (font.name) styles.push(`font-family:'${font.name}', Calibri, sans-serif`);
      }

      const fill = xf ? ctx.fills[xf.fillId] : undefined;
      if (fill) styles.push(`background:${fill}`);

      const border = xf ? ctx.borders[xf.borderId] : undefined;
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
      const hAlign = xf?.hAlign ?? (data?.kind === "n" ? "right" : data?.kind === "b" ? "center" : undefined);
      if (hAlign && hAlign !== "general")
        styles.push(`text-align:${hAlign === "centerContinuous" ? "center" : hAlign}`);
      if (xf?.vAlign === "center") styles.push("vertical-align:middle");
      else if (xf?.vAlign === "top") styles.push("vertical-align:top");
      if (xf?.wrapText) styles.push("white-space:pre-wrap", "word-wrap:break-word");

      const spanAttrs = merge
        ? `${merge.cols > 1 ? ` colspan="${merge.cols}"` : ""}${merge.rows > 1 ? ` rowspan="${merge.rows}"` : ""}`
        : "";
      const content = data?.link
        ? `<a href="${escapeHtml(data.link)}" target="_blank" rel="noreferrer">${data.html}</a>`
        : (data?.html ?? "");
      tds.push(`<td${spanAttrs}${styles.length ? ` style="${styles.join(";")};"` : ""}>${content}</td>`);
    }

    const ht = rowHeightPx.get(r);
    bodyRows.push(`<tr${ht ? ` style="height:${px(ht)};"` : ""}>${tds.join("")}</tr>`);
  }

  const truncationNote = truncated
    ? `<div class="trunc">Preview truncated to ${MAX_ROWS} rows × ${MAX_COLS} columns — download the file for the full sheet.</div>`
    : "";

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
    ".trunc{padding:6px 10px;background:#FFF7E0;color:#8A6D1A;font-size:12px;border-bottom:1px solid #EFE3B5;position:sticky;top:0;z-index:4;}",
    "</style></head><body>",
    truncationNote,
    `<table><colgroup>${colgroup.join("")}</colgroup><thead><tr>${headerCells.join("")}</tr></thead><tbody>`,
    ...bodyRows,
    "</tbody></table>",
    "</body></html>",
  ].join("");
}
