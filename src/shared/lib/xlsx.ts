import JSZip from "jszip";
import { downloadBlob } from "./utils";

interface ConversionResult {
  sheetName: string;
  csv: string;
  rowCount: number;
}

interface SharedStrings {
  strings: string[];
}

/**
 * Converts an XLSX file (File, Blob, or ArrayBuffer) to multiple CSV strings (one per sheet)
 */
export async function xlsxToCsv(file: Blob | ArrayBuffer | Uint8Array): Promise<ConversionResult[]> {
  const zip = await JSZip.loadAsync(file);

  // Parse shared strings (XLSX stores repeated strings in a lookup table)
  const sharedStrings = await parseSharedStrings(zip);

  // Get sheet names and their relationship IDs from workbook.xml
  const sheetEntries = await parseWorkbook(zip);

  // Parse relationships to map rId -> worksheet file path
  const sheetPathMap = await parseWorkbookRels(zip);

  // Parse each sheet
  const results: ConversionResult[] = [];

  for (let i = 0; i < sheetEntries.length; i++) {
    const entry = sheetEntries[i];
    // Resolve path: use relationship map first, fall back to sequential naming.
    // Some tools write absolute (`/xl/...`) or already-prefixed targets, so
    // normalise before concatenating.
    const relPath = sheetPathMap.get(entry.rId);
    const sheetPath = relPath ? resolveSheetPath(relPath) : `xl/worksheets/sheet${i + 1}.xml`;

    const sheetXml = await zip.file(sheetPath)?.async("string");
    if (!sheetXml) continue;

    const csv = parseSheet(sheetXml, sharedStrings);
    const rowCount = csv.split(/\r?\n/).filter((row) => row.trim()).length;

    results.push({
      sheetName: entry.name,
      csv,
      rowCount,
    });
  }

  // Fallback: workbook.xml / rels parsing missed everything but the zip may
  // still contain readable sheet XMLs. Scan for them directly so unusual but
  // valid xlsx files still render. Sheet names are taken from the workbook
  // entries when possible, otherwise derived from the filename.
  if (results.length === 0) {
    const worksheetPaths = Object.keys(zip.files)
      .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(p))
      .sort();
    for (let i = 0; i < worksheetPaths.length; i++) {
      const xml = await zip.file(worksheetPaths[i])?.async("string");
      if (!xml) continue;
      const csv = parseSheet(xml, sharedStrings);
      results.push({
        sheetName: sheetEntries[i]?.name ?? `Sheet${i + 1}`,
        csv,
        rowCount: csv.split(/\r?\n/).filter((row) => row.trim()).length,
      });
    }
  }

  return results;
}

/**
 * Normalise a workbook-rels Target into a zip-internal path.
 * Targets are relative to `xl/_rels/workbook.xml.rels`, so they're normally
 * "worksheets/sheet1.xml". Some writers emit absolute ("/xl/...") or
 * already-prefixed ("xl/...") forms — handle both.
 */
function resolveSheetPath(relPath: string): string {
  let p = relPath.replace(/^\.\//, "");
  if (p.startsWith("/")) p = p.slice(1);
  if (p.startsWith("xl/")) return p;
  return `xl/${p}`;
}

/**
 * Parses the shared strings XML file
 */
async function parseSharedStrings(zip: JSZip): Promise<SharedStrings> {
  const content = await zip.file("xl/sharedStrings.xml")?.async("string");
  if (!content) return { strings: [] };

  const doc = new DOMParser().parseFromString(content, "application/xml");
  // Each <si> may contain a single <t> or rich text (<r><t>…</t></r>).
  const strings = Array.from(doc.getElementsByTagNameNS("*", "si")).map(joinTextNodes);
  return { strings };
}

/** Concatenate every `<t>` element's text content within an OOXML container. */
function joinTextNodes(container: Element): string {
  let text = "";
  for (const t of container.getElementsByTagNameNS("*", "t")) {
    text += t.textContent ?? "";
  }
  return text;
}

interface SheetEntry {
  name: string;
  rId: string;
}

/**
 * Parses workbook.xml to get sheet names and relationship IDs
 */
async function parseWorkbook(zip: JSZip): Promise<SheetEntry[]> {
  const content = await zip.file("xl/workbook.xml")?.async("string");

  if (!content) {
    return [{ name: "Sheet1", rId: "" }];
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(content, "application/xml");
  const sheets = doc.getElementsByTagNameNS("*", "sheet");

  const entries: SheetEntry[] = [];
  for (const sheet of sheets) {
    const name = sheet.getAttribute("name") ?? "Sheet";
    // The r:id attribute uses the relationships namespace - try multiple lookup strategies
    const rId =
      sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ||
      sheet.getAttribute("r:id") ||
      "";
    entries.push({ name, rId });
  }

  return entries.length > 0 ? entries : [{ name: "Sheet1", rId: "" }];
}

/**
 * Parses xl/_rels/workbook.xml.rels to get the mapping from rId to worksheet file paths
 */
async function parseWorkbookRels(zip: JSZip): Promise<Map<string, string>> {
  const content = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  const map = new Map<string, string>();

  if (!content) {
    return map;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(content, "application/xml");
  const rels = doc.getElementsByTagNameNS("*", "Relationship");

  for (const rel of rels) {
    const id = rel.getAttribute("Id") ?? "";
    const target = rel.getAttribute("Target") ?? "";
    const type = rel.getAttribute("Type") ?? "";

    // Only map worksheet relationships
    if (type.includes("/worksheet")) {
      map.set(id, target);
    }
  }

  return map;
}

/**
 * Parses a sheet XML and converts it to CSV.
 *
 * Always uses namespace-aware queries (`getElementsByTagNameNS("*", local)`).
 * The plain `getElementsByTagName(local)` path was buggy in XML mode for
 * some browsers/documents — it would occasionally match only the first cell
 * of a row in default-namespace worksheets.
 */
function parseSheet(xml: string, sharedStrings: SharedStrings): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const rows = doc.getElementsByTagNameNS("*", "row");

  // First pass: parse each row into a sparse map and track the global max
  // column index. We need a second pass to pad every row to the same width
  // because merged cells (e.g. a centered title in A1:C1) only emit a single
  // <c> for the top-left, which would otherwise leave the row shorter than
  // the rest of the sheet and break consumers that expect rectangular data.
  const parsedRows: Array<Map<number, string>> = [];
  let globalMaxCol = -1;

  for (const row of rows) {
    const cells = row.getElementsByTagNameNS("*", "c");
    const rowData: Map<number, string> = new Map();
    let positionalCol = 0; // fallback for cells without an "r" attribute

    for (const cell of cells) {
      const ref = cell.getAttribute("r");
      const colIndex = ref ? cellRefToColIndex(ref) : positionalCol;
      positionalCol = colIndex + 1;
      globalMaxCol = Math.max(globalMaxCol, colIndex);

      const value = getCellValue(cell, sharedStrings);
      rowData.set(colIndex, value);
    }

    parsedRows.push(rowData);
  }

  // Second pass: emit rectangular CSV padded to the global max column count.
  const csvRows: string[] = parsedRows.map((rowData) => {
    const csvCells: string[] = [];
    for (let i = 0; i <= globalMaxCol; i++) {
      csvCells.push(rowData.get(i) ?? "");
    }
    return csvCells.map(escapeCsvValue).join(",");
  });

  // CRLF per RFC 4180 for best compatibility with CSV readers
  return csvRows.join("\r\n");
}

/**
 * Converts cell reference (e.g., "A1", "AA1") to zero-based column index
 */
function cellRefToColIndex(ref: string): number {
  const match = ref.match(/^([A-Z]+)/);
  if (!match) return 0;

  const letters = match[1];
  let index = 0;

  for (let i = 0; i < letters.length; i++) {
    index = index * 26 + (letters.charCodeAt(i) - 64);
  }

  return index - 1; // Zero-based
}

/**
 * Extracts the value from a cell element. Cell-type quick reference:
 *   t="s"          — shared string; <v> holds an index into sharedStrings
 *   t="b"          — boolean; <v> holds "0" or "1"
 *   t="e"          — error code (returned as-is from <v>)
 *   t="str"        — formula string result; <v> holds the string
 *   t="inlineStr"  — inline string; an <is><t>…</t></is> sibling holds the text
 *   (no t / "n")   — number; <v> holds the digits
 * For untyped cells that lack a <v> we still probe for an inline `<is>` as a
 * last resort, since some writers emit inline strings without setting `t`.
 */
function getCellValue(cell: Element, sharedStrings: SharedStrings): string {
  const type = cell.getAttribute("t");
  const valueEl = cell.getElementsByTagNameNS("*", "v")[0];
  const value = valueEl?.textContent ?? "";

  if (type === "s") return sharedStrings.strings[parseInt(value, 10)] ?? "";
  if (type === "b") return value === "1" ? "TRUE" : "FALSE";
  if (type === "e" || type === "str") return value;

  if (type === "inlineStr" || !valueEl) {
    const isEl = cell.getElementsByTagNameNS("*", "is")[0];
    if (isEl) {
      const text = joinTextNodes(isEl);
      if (text) return text;
    }
  }

  return value;
}

/**
 * Escapes a value for CSV output
 */
function escapeCsvValue(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Parse a CSV string into a 2D array. Handles quoted fields, escaped quotes,
 * and embedded newlines (an embedded newline is allowed inside a quoted field).
 */
function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];

    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\r") continue;
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }

  // Trailing field / row
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Convert a CSV string to a GitHub-flavored markdown table. Pads ragged rows
 * to the widest row so cells line up. Applies a small heuristic: if the first
 * non-empty row has content only in column 0 and at least one later row has
 * multiple populated columns, treat the first row as a merged-cell title and
 * emit it as an `## H2` heading above the table.
 */
export function csvToMarkdownTable(csv: string): string {
  if (!csv.trim()) return "";

  const isBlank = (r: string[]) => r.every((c) => !c.trim());
  const stripLeadingBlanks = (rs: string[][]) => {
    let i = 0;
    while (i < rs.length && isBlank(rs[i])) i++;
    return rs.slice(i);
  };

  let rows = stripLeadingBlanks(parseCsvRows(csv));
  if (rows.length === 0) return "";

  // Title heuristic: a merged-cell title (e.g. centered across A1:C1) appears
  // in the XML as a single populated cell in column 0 with subsequent rows
  // using multiple columns. Pull it out as an H2 above the table.
  let title: string | null = null;
  if (rows.length > 1) {
    const first = rows[0];
    const isMergedTitle =
      first[0]?.trim() &&
      first.slice(1).every((c) => !c.trim()) &&
      rows.slice(1).some((r) => r.filter((c) => c.trim()).length > 1);
    if (isMergedTitle) {
      title = first[0].trim();
      rows = stripLeadingBlanks(rows.slice(1));
    }
  }

  if (rows.length === 0) return title ? `## ${title}` : "";

  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const escapeCell = (s: string | undefined) =>
    (s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
  const formatRow = (r: string[]) =>
    `| ${Array.from({ length: maxCols }, (_, i) => escapeCell(r[i])).join(" | ")} |`;

  const separator = `| ${Array.from({ length: maxCols }, () => "---").join(" | ")} |`;
  const table = [formatRow(rows[0]), separator, ...rows.slice(1).map(formatRow)].join("\n");

  return title ? `## ${title}\n\n${table}` : table;
}

/**
 * Triggers download of a CSV file
 */
export function downloadCsv(csv: string, filename: string): void {
  // Prepend UTF-8 BOM so Excel detects encoding correctly
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, filename.endsWith(".csv") ? filename : `${filename}.csv`);
}
