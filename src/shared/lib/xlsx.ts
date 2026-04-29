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
 * Converts an XLSX file to multiple CSV strings (one per sheet)
 */
export async function xlsxToCsv(file: File): Promise<ConversionResult[]> {
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
    // Resolve path: use relationship map first, fall back to sequential naming
    const relPath = sheetPathMap.get(entry.rId);
    const sheetPath = relPath ? `xl/${relPath}` : `xl/worksheets/sheet${i + 1}.xml`;

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

  return results;
}

/**
 * Parses the shared strings XML file
 */
async function parseSharedStrings(zip: JSZip): Promise<SharedStrings> {
  const content = await zip.file("xl/sharedStrings.xml")?.async("string");

  if (!content) {
    return { strings: [] };
  }

  const strings: string[] = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, "application/xml");

  // Shared strings are stored in <si> elements - try namespace-aware query with wildcard
  let siElements: HTMLCollectionOf<Element> = doc.getElementsByTagName("si");
  if (siElements.length === 0) {
    siElements = doc.getElementsByTagNameNS("*", "si");
  }

  for (const si of siElements) {
    // Text can be in <t> directly or in <r><t> (rich text)
    let tElements: HTMLCollectionOf<Element> = si.getElementsByTagName("t");
    if (tElements.length === 0) {
      tElements = si.getElementsByTagNameNS("*", "t");
    }
    let text = "";
    for (const t of tElements) {
      text += t.textContent ?? "";
    }
    strings.push(text);
  }

  return { strings };
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
  let sheets: HTMLCollectionOf<Element> = doc.getElementsByTagName("sheet");
  if (sheets.length === 0) {
    sheets = doc.getElementsByTagNameNS("*", "sheet");
  }

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
  const rels = doc.getElementsByTagName("Relationship");

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
 * Parses a sheet XML and converts it to CSV
 */
function parseSheet(xml: string, sharedStrings: SharedStrings): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");

  // Try standard getElementsByTagName first, fall back to namespace-aware query
  let rows: HTMLCollectionOf<Element> = doc.getElementsByTagName("row");
  if (rows.length === 0) {
    rows = doc.getElementsByTagNameNS("*", "row");
  }

  const csvRows: string[] = [];

  for (const row of rows) {
    let cells: HTMLCollectionOf<Element> = row.getElementsByTagName("c");
    if (cells.length === 0) {
      cells = row.getElementsByTagNameNS("*", "c");
    }

    const rowData: Map<number, string> = new Map();
    let maxCol = 0;
    let positionalCol = 0; // fallback for cells without an "r" attribute

    for (const cell of cells) {
      const ref = cell.getAttribute("r");
      const colIndex = ref ? cellRefToColIndex(ref) : positionalCol;
      positionalCol = colIndex + 1;
      maxCol = Math.max(maxCol, colIndex);

      const value = getCellValue(cell, sharedStrings);
      rowData.set(colIndex, value);
    }

    // Build CSV row with proper column positioning
    const csvCells: string[] = [];
    for (let i = 0; i <= maxCol; i++) {
      csvCells.push(rowData.get(i) ?? "");
    }

    csvRows.push(csvCells.map(escapeCsvValue).join(","));
  }

  // Use CRLF per RFC 4180 for best compatibility with CSV readers
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
 * Gets child elements by local name, trying both namespaced and non-namespaced lookups.
 */
function getElementsByLocalName(parent: Element, localName: string): HTMLCollectionOf<Element> | Element[] {
  let elements: HTMLCollectionOf<Element> | Element[] = parent.getElementsByTagName(localName);
  if (elements.length === 0) {
    elements = parent.getElementsByTagNameNS("*", localName);
  }
  return elements;
}

/**
 * Extracts the value from a cell element
 */
function getCellValue(cell: Element, sharedStrings: SharedStrings): string {
  const type = cell.getAttribute("t");
  const valueEl = getElementsByLocalName(cell, "v")[0];
  const value = valueEl?.textContent ?? "";

  // Type 's' means shared string
  if (type === "s") {
    const index = parseInt(value, 10);
    return sharedStrings.strings[index] ?? "";
  }

  // Type 'inlineStr' means inline string (can also appear without an explicit type)
  if (type === "inlineStr" || type === "str") {
    // First check for <is> inline string element
    const isEl = getElementsByLocalName(cell, "is")[0];
    if (isEl) {
      const tElements = getElementsByLocalName(isEl, "t");
      let text = "";
      for (const t of tElements) {
        text += t.textContent ?? "";
      }
      if (text) return text;
    }
    // Fall back to <v> value (used for formula string results)
    return value;
  }

  // Type 'b' means boolean
  if (type === "b") {
    return value === "1" ? "TRUE" : "FALSE";
  }

  // Type 'e' means error
  if (type === "e") {
    return value; // Return error code as-is
  }

  // Cell may have an inline string without explicit type attribute
  if (!valueEl) {
    const isEl = getElementsByLocalName(cell, "is")[0];
    if (isEl) {
      const tElements = getElementsByLocalName(isEl, "t");
      let text = "";
      for (const t of tElements) {
        text += t.textContent ?? "";
      }
      if (text) return text;
    }
  }

  // Default: number or formula result
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
 * Triggers download of a CSV file
 */
export function downloadCsv(csv: string, filename: string): void {
  // Prepend UTF-8 BOM so Excel detects encoding correctly
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, filename.endsWith(".csv") ? filename : `${filename}.csv`);
}
