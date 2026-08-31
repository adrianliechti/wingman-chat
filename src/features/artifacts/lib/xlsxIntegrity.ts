import {
  contentTypeForPart,
  ooxmlAttribute,
  ooxmlChildren,
  ooxmlDescendants,
  ooxmlText,
  R_NAMESPACES,
  SPREADSHEETML_NAMESPACES,
  type OoxmlRelationship,
  type OoxmlXmlElement,
} from "@/shared/lib/ooxml";
import { OoxmlIssueCollector, relationshipTypes, type OoxmlIssue, type OoxmlPackageValidation } from "./ooxmlPackage";

interface CellRange {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface WorksheetContext {
  path: string;
  root: OoxmlXmlElement;
  relationships: OoxmlRelationship[];
  cells: Map<string, OoxmlXmlElement>;
  merges: Array<{ reference: string; range: CellRange }>;
}

interface StyleCounts {
  cellXfs: number;
  dxfs: number;
}

const TABLES = "xlsx.tables";
const MERGES = "xlsx.merges";
const CONDITIONAL_FORMATTING = "xlsx.conditional-formatting";
const STYLES = "xlsx.styles";
const SHARED_STRINGS = "xlsx.shared-strings";

const TABLE_RELATIONSHIP_TYPES = new Set(relationshipTypes("table"));
const TABLE_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml";
const MERGE_COMPARISON_LIMIT = 2_000_000;
const TABLE_COMPARISON_LIMIT = 2_000_000;

function isSpreadsheetNamespace(namespaceUri: string | undefined): boolean {
  return (SPREADSHEETML_NAMESPACES as readonly string[]).includes(namespaceUri ?? "");
}

function columnNumber(label: string): number {
  let value = 0;
  for (const char of label.toUpperCase()) value = value * 26 + char.charCodeAt(0) - 64;
  return value;
}

function columnLabel(column: number): string {
  let value = column;
  let label = "";
  while (value > 0) {
    value--;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function parseRange(reference: string | undefined): CellRange | null {
  if (!reference) return null;
  const match = reference.match(/^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/i);
  if (!match) return null;
  const left = columnNumber(match[1]);
  const top = Number(match[2]);
  const right = columnNumber(match[3] ?? match[1]);
  const bottom = Number(match[4] ?? match[2]);
  if (left < 1 || right > 16_384 || top < 1 || bottom > 1_048_576 || left > right || top > bottom) return null;
  return { top, bottom, left, right };
}

function rangesOverlap(a: CellRange, b: CellRange): boolean {
  return a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;
}

function firstChild(element: OoxmlXmlElement | undefined, localName: string): OoxmlXmlElement | undefined {
  return ooxmlChildren(element, localName, SPREADSHEETML_NAMESPACES)[0];
}

function decodeEscapedName(value: string): string {
  return value.replace(/_x([\da-f]{4})_/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function looksLikeCellReference(name: string): boolean {
  const a1 = name.match(/^([A-Za-z]{1,3})([1-9]\d*)$/);
  if (a1 && columnNumber(a1[1]) <= 16_384 && Number(a1[2]) <= 1_048_576) return true;
  return /^[Rr]\d+[Cc]\d+$/.test(name) || /^[RrCc]$/.test(name);
}

function tableNameIssue(name: string | undefined): string | null {
  if (!name) return "is missing a displayName";
  if (name.length > 255 || !/^[\p{L}_\\][\p{L}\p{M}\p{N}_.\\]*$/u.test(name)) {
    return `has invalid displayName "${name}"`;
  }
  return looksLikeCellReference(name) ? `has displayName "${name}" that looks like a cell reference` : null;
}

function parseCount(value: string | undefined): number | undefined {
  if (value === undefined || value.length > 10 || !/^\d+$/.test(value)) return undefined;
  const count = Number(value);
  return Number.isSafeInteger(count) && count <= 4_294_967_295 ? count : undefined;
}

function collectMerges(
  sheetPath: string,
  root: OoxmlXmlElement,
  collector: OoxmlIssueCollector,
): Array<{ reference: string; range: CellRange }> {
  const merges: Array<{ reference: string; range: CellRange }> = [];
  const mergeElements = [...ooxmlDescendants(root, "mergeCell", SPREADSHEETML_NAMESPACES)];
  const mergeContainer = [...ooxmlDescendants(root, "mergeCells", SPREADSHEETML_NAMESPACES)][0];
  const rawDeclaredCount = ooxmlAttribute(mergeContainer, "count", null);
  const declaredCount = parseCount(rawDeclaredCount);
  if (rawDeclaredCount !== undefined && declaredCount === undefined) {
    collector.fail(MERGES, `${sheetPath} has invalid mergeCells count "${rawDeclaredCount}"`);
  }
  if (declaredCount !== undefined && declaredCount !== mergeElements.length) {
    collector.warn(MERGES, `${sheetPath} declares ${declaredCount} merged ranges but contains ${mergeElements.length}`);
  }
  for (const element of mergeElements) {
    const reference = ooxmlAttribute(element, "ref", null);
    const range = parseRange(reference);
    if (!range) collector.fail(MERGES, `${sheetPath} has invalid merged range "${reference ?? ""}"`);
    else merges.push({ reference: reference!, range });
  }

  const sorted = [...merges].sort(
    (a, b) => a.range.top - b.range.top || a.range.left - b.range.left || a.range.bottom - b.range.bottom,
  );
  let active: typeof sorted = [];
  let comparisons = 0;
  for (const current of sorted) {
    active = active.filter((previous) => previous.range.bottom >= current.range.top);
    for (const previous of active) {
      comparisons++;
      if (comparisons > MERGE_COMPARISON_LIMIT) {
        collector.fail(
          "xlsx.resource-limit",
          `${sheetPath} has too many intersecting merge candidates to validate safely`,
        );
        return merges;
      }
      if (rangesOverlap(current.range, previous.range)) {
        collector.fail(MERGES, `${sheetPath} merged range ${current.reference} overlaps ${previous.reference}`);
        if (collector.full) return merges;
      }
    }
    active.push(current);
  }
  return merges;
}

async function sharedStringValues(
  packageInfo: OoxmlPackageValidation,
  collector: OoxmlIssueCollector,
): Promise<string[]> {
  if (!packageInfo.sharedStringsPart) return [];
  try {
    const root = await packageInfo.reader.xml(packageInfo.sharedStringsPart);
    if (!root || root.localName !== "sst" || !isSpreadsheetNamespace(root.namespaceUri)) {
      collector.fail(SHARED_STRINGS, `${packageInfo.sharedStringsPart} has no SpreadsheetML shared-string root`);
      return [];
    }
    const values = ooxmlChildren(root, "si", SPREADSHEETML_NAMESPACES).map((item) =>
      [...ooxmlDescendants(item, "t", SPREADSHEETML_NAMESPACES)].map((text) => ooxmlText(text)).join(""),
    );
    const rawUniqueCount = ooxmlAttribute(root, "uniqueCount", null);
    const uniqueCount = parseCount(rawUniqueCount);
    if (rawUniqueCount !== undefined && uniqueCount === undefined) {
      collector.fail(SHARED_STRINGS, `${packageInfo.sharedStringsPart} has invalid uniqueCount "${rawUniqueCount}"`);
    }
    if (uniqueCount !== undefined && uniqueCount !== values.length) {
      collector.warn(
        SHARED_STRINGS,
        `${packageInfo.sharedStringsPart} declares ${uniqueCount} unique strings but contains ${values.length}`,
      );
    }
    return values;
  } catch (error) {
    collector.fail(SHARED_STRINGS, error instanceof Error ? error.message : String(error));
    return [];
  }
}

async function styleCounts(
  packageInfo: OoxmlPackageValidation,
  collector: OoxmlIssueCollector,
): Promise<StyleCounts | undefined> {
  if (!packageInfo.stylesPart) return undefined;
  try {
    const root = await packageInfo.reader.xml(packageInfo.stylesPart);
    if (!root || root.localName !== "styleSheet" || !isSpreadsheetNamespace(root.namespaceUri)) {
      collector.fail(STYLES, `${packageInfo.stylesPart} has no SpreadsheetML style root`);
      return undefined;
    }
    const cellXfs = firstChild(root, "cellXfs");
    const dxfs = firstChild(root, "dxfs");
    const xfCount = ooxmlChildren(cellXfs, "xf", SPREADSHEETML_NAMESPACES).length;
    const dxfCount = ooxmlChildren(dxfs, "dxf", SPREADSHEETML_NAMESPACES).length;
    const rawDeclaredXfs = ooxmlAttribute(cellXfs, "count", null);
    const rawDeclaredDxfs = ooxmlAttribute(dxfs, "count", null);
    const declaredXfs = parseCount(rawDeclaredXfs);
    const declaredDxfs = parseCount(rawDeclaredDxfs);
    if (rawDeclaredXfs !== undefined && declaredXfs === undefined) {
      collector.fail(STYLES, `${packageInfo.stylesPart} has invalid cellXfs count "${rawDeclaredXfs}"`);
    }
    if (rawDeclaredDxfs !== undefined && declaredDxfs === undefined) {
      collector.fail(STYLES, `${packageInfo.stylesPart} has invalid dxfs count "${rawDeclaredDxfs}"`);
    }
    if (declaredXfs !== undefined && declaredXfs !== xfCount) {
      collector.warn(STYLES, `${packageInfo.stylesPart} declares ${declaredXfs} cell formats but contains ${xfCount}`);
    }
    if (declaredDxfs !== undefined && declaredDxfs !== dxfCount) {
      collector.warn(
        STYLES,
        `${packageInfo.stylesPart} declares ${declaredDxfs} differential formats but contains ${dxfCount}`,
      );
    }
    return { cellXfs: xfCount, dxfs: dxfCount };
  } catch (error) {
    collector.fail(STYLES, error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

function validateCells(
  sheet: WorksheetContext,
  sharedStrings: readonly string[],
  sharedStringsPart: string | undefined,
  styles: StyleCounts | undefined,
  stylesPart: string | undefined,
  collector: OoxmlIssueCollector,
): void {
  for (const [reference, cell] of sheet.cells) {
    const type = ooxmlAttribute(cell, "t", null);
    if (type === "s") {
      const index = parseCount(ooxmlText(firstChild(cell, "v")).trim());
      if (index === undefined || !sharedStringsPart || index >= sharedStrings.length) {
        collector.fail(
          SHARED_STRINGS,
          `${sheet.path} cell ${reference} references invalid shared-string index ${index ?? '""'}`,
        );
      }
    }
    const rawStyleIndex = ooxmlAttribute(cell, "s", null);
    const styleIndex = parseCount(rawStyleIndex);
    if (rawStyleIndex !== undefined && styleIndex === undefined) {
      collector.fail(STYLES, `${sheet.path} cell ${reference} has invalid style index "${rawStyleIndex}"`);
    }
    if (styleIndex !== undefined && (!stylesPart || !styles || styleIndex >= styles.cellXfs)) {
      collector.fail(STYLES, `${sheet.path} cell ${reference} references invalid style index ${styleIndex}`);
    }
    if (collector.full) return;
  }
}

function validateConditionalFormatting(
  sheet: WorksheetContext,
  styles: StyleCounts | undefined,
  collector: OoxmlIssueCollector,
): void {
  for (const block of ooxmlDescendants(sheet.root, "conditionalFormatting", SPREADSHEETML_NAMESPACES)) {
    const sqref = ooxmlAttribute(block, "sqref", null) ?? "";
    for (const rule of ooxmlChildren(block, "cfRule", SPREADSHEETML_NAMESPACES)) {
      const rawDxfId = ooxmlAttribute(rule, "dxfId", null);
      const dxfId = parseCount(rawDxfId);
      if (rawDxfId !== undefined && dxfId === undefined) {
        collector.fail(
          CONDITIONAL_FORMATTING,
          `${sheet.path} conditional formatting rule for ${sqref} has invalid dxfId "${rawDxfId}"`,
        );
      }
      if (dxfId !== undefined && (!styles || dxfId >= styles.dxfs)) {
        collector.fail(
          CONDITIONAL_FORMATTING,
          `${sheet.path} conditional formatting rule for ${sqref} references invalid dxfId ${dxfId}`,
        );
      }
      for (const formula of ooxmlChildren(rule, "formula", SPREADSHEETML_NAMESPACES)) {
        const value = ooxmlText(formula);
        if (value.startsWith("=")) {
          collector.fail(
            CONDITIONAL_FORMATTING,
            `${sheet.path} conditional formatting rule for ${sqref} has formula "${value}"; Excel rejects the leading "="`,
          );
        }
      }
      if (collector.full) return;
    }
  }
}

function cellText(cell: OoxmlXmlElement | undefined, sharedStrings: readonly string[]): string | null {
  if (!cell || firstChild(cell, "f")) return null;
  const type = ooxmlAttribute(cell, "t", null);
  if (type === "inlineStr") {
    const inline = firstChild(cell, "is");
    return [...ooxmlDescendants(inline, "t", SPREADSHEETML_NAMESPACES)].map((text) => ooxmlText(text)).join("");
  }
  const value = ooxmlText(firstChild(cell, "v"));
  if (type === "s") {
    const index = Number(value);
    return Number.isSafeInteger(index) ? (sharedStrings[index] ?? null) : null;
  }
  return type === "str" ? value : null;
}

function tableContentType(packageInfo: OoxmlPackageValidation, path: string): boolean {
  const contentType = packageInfo.contentTypes ? contentTypeForPart(packageInfo.contentTypes, path) : undefined;
  return contentType === TABLE_CONTENT_TYPE;
}

async function validateTables(
  packageInfo: OoxmlPackageValidation,
  sheets: readonly WorksheetContext[],
  sharedStrings: readonly string[],
  collector: OoxmlIssueCollector,
): Promise<void> {
  const owners = new Map<string, WorksheetContext>();
  const tablePaths = new Set<string>();
  for (const sheet of sheets) {
    const tableRelationships = new Map(
      sheet.relationships
        .filter((relationship) => TABLE_RELATIONSHIP_TYPES.has(relationship.type) && !relationship.external)
        .map((relationship) => [relationship.id, relationship]),
    );
    const parts = [...ooxmlDescendants(sheet.root, "tablePart", SPREADSHEETML_NAMESPACES)];
    const container = [...ooxmlDescendants(sheet.root, "tableParts", SPREADSHEETML_NAMESPACES)][0];
    const rawDeclaredCount = ooxmlAttribute(container, "count", null);
    const declaredCount = parseCount(rawDeclaredCount);
    if (rawDeclaredCount !== undefined && declaredCount === undefined) {
      collector.fail(TABLES, `${sheet.path} has invalid tableParts count "${rawDeclaredCount}"`);
    }
    if (declaredCount !== undefined && declaredCount !== parts.length) {
      collector.warn(TABLES, `${sheet.path} declares ${declaredCount} table parts but contains ${parts.length}`);
    }
    const referencedIds = new Set<string>();
    for (const part of parts) {
      const id = ooxmlAttribute(part, "id", R_NAMESPACES);
      if (!id) {
        collector.fail(TABLES, `${sheet.path} contains a tablePart without a relationships-namespace id`);
        continue;
      }
      referencedIds.add(id);
      const relationship = tableRelationships.get(id);
      if (!relationship?.path) {
        collector.fail(TABLES, `${sheet.path} tablePart ${id} has no valid table relationship`);
        continue;
      }
      tablePaths.add(relationship.path);
      if (!packageInfo.reader.has(relationship.path)) {
        collector.fail(TABLES, `${sheet.path} tablePart ${id} targets missing ${relationship.path}`);
      } else if (owners.has(relationship.path)) {
        collector.fail(TABLES, `${relationship.path} is referenced by more than one worksheet`);
      } else {
        owners.set(relationship.path, sheet);
      }
    }
    for (const [id, relationship] of tableRelationships) {
      if (!referencedIds.has(id)) {
        collector.warn(
          TABLES,
          `${sheet.path} has unreferenced table relationship ${id} → ${relationship.path ?? relationship.target}`,
        );
      }
    }
  }
  if (packageInfo.contentTypes) {
    for (const path of packageInfo.reader.paths) {
      if (tableContentType(packageInfo, path)) tablePaths.add(path);
    }
  }
  if (tablePaths.size === 0 || collector.full) return;

  const tableIds = new Set<number>();
  const tableNames = new Set<string>();
  const rangesBySheet = new Map<string, Array<{ path: string; range: CellRange }>>();
  let comparisons = 0;
  for (const tablePath of tablePaths) {
    let root: OoxmlXmlElement | undefined;
    try {
      root = await packageInfo.reader.xml(tablePath);
    } catch (error) {
      collector.fail(
        TABLES,
        `${tablePath} could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    if (!root || root.localName !== "table" || !isSpreadsheetNamespace(root.namespaceUri)) {
      collector.fail(TABLES, `${tablePath} has no SpreadsheetML table root element`);
      continue;
    }
    if (!tableContentType(packageInfo, tablePath))
      collector.fail(TABLES, `${tablePath} does not declare a table content type`);
    const id = ooxmlAttribute(root, "id", null);
    const numericId = parseCount(id);
    if (numericId === undefined || numericId === 0)
      collector.fail(TABLES, `${tablePath} has invalid table id "${id ?? ""}"`);
    else if (tableIds.has(numericId)) collector.fail(TABLES, `${tablePath} duplicates table id ${id}`);
    else tableIds.add(numericId);

    const displayName = ooxmlAttribute(root, "displayName", null);
    const nameIssue = tableNameIssue(displayName);
    if (nameIssue) collector.fail(TABLES, `${tablePath} ${nameIssue}`);
    else {
      const folded = displayName!.toLowerCase();
      if (tableNames.has(folded)) collector.fail(TABLES, `${tablePath} duplicates table name "${displayName}"`);
      else tableNames.add(folded);
    }

    const reference = ooxmlAttribute(root, "ref", null);
    const range = parseRange(reference);
    if (!range) {
      collector.fail(TABLES, `${tablePath} has invalid table range "${reference ?? ""}"`);
      continue;
    }
    const width = range.right - range.left + 1;
    const height = range.bottom - range.top + 1;
    const headerRowCount = parseCount(ooxmlAttribute(root, "headerRowCount", null) ?? "1");
    const totalsRowCount = parseCount(ooxmlAttribute(root, "totalsRowCount", null) ?? "0");
    if (headerRowCount === undefined || headerRowCount > 1)
      collector.fail(TABLES, `${tablePath} has invalid headerRowCount`);
    if (totalsRowCount === undefined || totalsRowCount > 1)
      collector.fail(TABLES, `${tablePath} has invalid totalsRowCount`);
    if (headerRowCount === 1 && height <= 1 + (totalsRowCount ?? 0)) {
      collector.fail(TABLES, `${tablePath} has a header but no data row`);
    }

    const columnsContainer = firstChild(root, "tableColumns");
    const columns = ooxmlChildren(columnsContainer, "tableColumn", SPREADSHEETML_NAMESPACES);
    const declaredColumns = parseCount(ooxmlAttribute(columnsContainer, "count", null));
    if (!columnsContainer || declaredColumns !== columns.length || columns.length !== width) {
      collector.fail(
        TABLES,
        `${tablePath} range is ${width} columns wide but tableColumns declares ${declaredColumns ?? "no count"} and contains ${columns.length}`,
      );
    }
    const columnIds = new Set<number>();
    const columnNames = columns.map((column) => {
      const columnId = ooxmlAttribute(column, "id", null);
      const numericColumnId = parseCount(columnId);
      if (numericColumnId === undefined || numericColumnId === 0 || columnIds.has(numericColumnId)) {
        collector.fail(TABLES, `${tablePath} has invalid or duplicate tableColumn id "${columnId ?? ""}"`);
      } else columnIds.add(numericColumnId);
      return decodeEscapedName(ooxmlAttribute(column, "name", null) ?? "");
    });
    if (columnNames.some((name) => !name.trim())) collector.fail(TABLES, `${tablePath} has a blank table column name`);
    if (new Set(columnNames.map((name) => name.toLowerCase())).size !== columnNames.length) {
      collector.fail(TABLES, `${tablePath} has duplicate table column names`);
    }

    const autoFilter = firstChild(root, "autoFilter");
    if (autoFilter) {
      const filterReference = ooxmlAttribute(autoFilter, "ref", null);
      const filterRange = parseRange(filterReference);
      const withoutTotals = totalsRowCount === 1 ? range.bottom - 1 : range.bottom;
      const matches =
        filterRange &&
        filterRange.left === range.left &&
        filterRange.right === range.right &&
        filterRange.top === range.top &&
        (filterRange.bottom === range.bottom || filterRange.bottom === withoutTotals);
      if (!matches) {
        collector.warn(
          TABLES,
          `${tablePath} autoFilter range "${filterReference ?? ""}" does not match table range "${reference}"`,
        );
      }
    }

    const owner = owners.get(tablePath);
    if (!owner) {
      collector.fail(TABLES, `${tablePath} is not referenced by a worksheet tablePart`);
      continue;
    }
    const ownedRanges = rangesBySheet.get(owner.path) ?? [];
    for (const previous of ownedRanges) {
      comparisons++;
      if (comparisons > TABLE_COMPARISON_LIMIT) {
        collector.fail("xlsx.resource-limit", "Workbook has too many table-range comparisons to validate safely");
        return;
      }
      if (rangesOverlap(range, previous.range))
        collector.fail(TABLES, `${tablePath} overlaps ${previous.path} on ${owner.path}`);
    }
    ownedRanges.push({ path: tablePath, range });
    rangesBySheet.set(owner.path, ownedRanges);
    for (const merge of owner.merges) {
      comparisons++;
      if (comparisons > TABLE_COMPARISON_LIMIT) {
        collector.fail("xlsx.resource-limit", "Workbook has too many table-range comparisons to validate safely");
        return;
      }
      if (rangesOverlap(range, merge.range)) {
        collector.fail(TABLES, `${tablePath} overlaps merged cells ${merge.reference} on ${owner.path}`);
      }
    }

    if (headerRowCount === 1) {
      const actualHeaders: string[] = [];
      for (let column = range.left; column <= range.right; column++) {
        actualHeaders.push(cellText(owner.cells.get(`${columnLabel(column)}${range.top}`), sharedStrings) ?? "");
      }
      if (actualHeaders.some((header) => !header.trim())) {
        collector.fail(TABLES, `${tablePath} header row contains a blank, non-text, or formula header cell`);
      }
      if (new Set(actualHeaders.map((header) => header.toLowerCase())).size !== actualHeaders.length) {
        collector.fail(TABLES, `${tablePath} worksheet header cells are not unique`);
      }
      if (
        actualHeaders.length === columnNames.length &&
        actualHeaders.some((header, index) => header !== columnNames[index])
      ) {
        collector.warn(TABLES, `${tablePath} table column names do not match worksheet header cells`);
      }
    }
    if (collector.full) return;
  }

  for (const sheet of sheets) {
    const filter = parseRange(ooxmlAttribute(firstChild(sheet.root, "autoFilter"), "ref", null));
    if (!filter) continue;
    for (const table of rangesBySheet.get(sheet.path) ?? []) {
      if (rangesOverlap(filter, table.range)) {
        collector.fail(
          TABLES,
          `${sheet.path} has a worksheet AutoFilter over ${table.path}; the table owns its own AutoFilter`,
        );
      }
    }
  }
}

/** Validate SpreadsheetML invariants that Excel otherwise repairs or silently discards. */
export async function validateXlsxIntegrity(packageInfo: OoxmlPackageValidation): Promise<OoxmlIssue[]> {
  const collector = new OoxmlIssueCollector();
  const sharedStrings = await sharedStringValues(packageInfo, collector);
  const styles = await styleCounts(packageInfo, collector);
  const sheets: WorksheetContext[] = [];
  for (const path of packageInfo.worksheetParts) {
    try {
      const root = await packageInfo.reader.xml(path);
      if (!root || root.localName !== "worksheet" || !isSpreadsheetNamespace(root.namespaceUri)) {
        collector.fail("xlsx.worksheets", `${path} has no SpreadsheetML worksheet root element`);
        continue;
      }
      const cells = new Map<string, OoxmlXmlElement>();
      for (const cell of ooxmlDescendants(root, "c", SPREADSHEETML_NAMESPACES)) {
        const authoredReference = ooxmlAttribute(cell, "r", null);
        if (!authoredReference) continue;
        const reference = authoredReference.replace(/\$/g, "").toUpperCase();
        const range = parseRange(reference);
        if (!range || range.left !== range.right || range.top !== range.bottom) {
          collector.fail("xlsx.cells", `${path} has invalid cell reference "${authoredReference}"`);
        } else if (cells.has(reference)) {
          collector.fail("xlsx.cells", `${path} duplicates cell reference ${reference}`);
        } else {
          cells.set(reference, cell);
        }
      }
      const sheet: WorksheetContext = {
        path,
        root,
        relationships: packageInfo.relationshipsBySource.get(path) ?? [],
        cells,
        merges: collectMerges(path, root, collector),
      };
      sheets.push(sheet);
      validateCells(sheet, sharedStrings, packageInfo.sharedStringsPart, styles, packageInfo.stylesPart, collector);
      validateConditionalFormatting(sheet, styles, collector);
    } catch (error) {
      collector.fail("xlsx.worksheets", error instanceof Error ? error.message : String(error));
    }
    if (collector.full) return collector.issues;
  }
  await validateTables(packageInfo, sheets, sharedStrings, collector);
  return collector.issues;
}
