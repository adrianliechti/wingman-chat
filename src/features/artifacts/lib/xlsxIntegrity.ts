import type JSZip from "jszip";
import {
  attributes,
  decodeEscapedName,
  elementBlocks,
  fail,
  firstTagText,
  localAttribute,
  openingTags,
  readRelationships,
  warn,
  type OoxmlIssue,
} from "./ooxml";

interface CellRange {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const TABLES = "xlsx.tables";
const MERGES = "xlsx.merges";
const CONDITIONAL_FORMATTING = "xlsx.conditional-formatting";

const MERGE_PAIRWISE_LIMIT = 2_000;

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

function cellText(cell: string, sharedStrings: string[]): string | null {
  const opening = openingTags(cell, "c")[0];
  const attrs = opening ? attributes(opening) : new Map<string, string>();
  const type = attrs.get("t");
  if (openingTags(cell, "f").length > 0) return null;
  if (type === "inlineStr")
    return elementBlocks(cell, "t")
      .map((tag) => firstTagText(tag, "t") ?? "")
      .join("");
  const value = firstTagText(cell, "v");
  if (type === "s") return value === undefined ? null : (sharedStrings[Number(value)] ?? null);
  if (type === "str") return value ?? null;
  return null;
}

function sharedStringValues(xml: string | undefined): string[] {
  if (!xml) return [];
  return elementBlocks(xml, "si").map((item) =>
    elementBlocks(item, "t")
      .map((text) => firstTagText(text, "t") ?? "")
      .join(""),
  );
}

function tableNameIssue(name: string | undefined): string | null {
  if (!name) return "is missing a displayName";
  if (name.length > 255 || !/^[\p{L}_\\][\p{L}\p{M}\p{N}_.\\]*$/u.test(name)) {
    return `has invalid displayName "${name}"`;
  }
  if (/^[A-Za-z][A-Za-z]?[A-Da-d]?\d+$/.test(name) || /^[Rr]\d+[Cc]\d+$/.test(name) || /^[RrCc]$/.test(name)) {
    return `has displayName "${name}" that looks like a cell reference`;
  }
  return null;
}

function mergeIssues(sheetPath: string, sheetXml: string): OoxmlIssue[] {
  const issues: OoxmlIssue[] = [];
  const merges: Array<{ reference: string; range: CellRange }> = [];
  for (const tag of openingTags(sheetXml, "mergeCell")) {
    const reference = attributes(tag).get("ref");
    const range = parseRange(reference);
    if (!range) {
      if (reference) issues.push(fail(MERGES, `${sheetPath} has invalid merged range "${reference}"`));
      continue;
    }
    if (merges.length < MERGE_PAIRWISE_LIMIT) {
      for (const previous of merges) {
        if (rangesOverlap(range, previous.range)) {
          issues.push(fail(MERGES, `${sheetPath} merged range ${reference} overlaps ${previous.reference}`));
        }
      }
    }
    merges.push({ reference: reference!, range });
  }
  return issues;
}

function conditionalFormattingIssues(sheetPath: string, sheetXml: string): OoxmlIssue[] {
  const issues: OoxmlIssue[] = [];
  for (const block of elementBlocks(sheetXml, "conditionalFormatting")) {
    const sqref = attributes(openingTags(block, "conditionalFormatting")[0] ?? "").get("sqref") ?? "";
    for (const element of elementBlocks(block, "formula")) {
      const formula = firstTagText(element, "formula") ?? "";
      if (formula.startsWith("=")) {
        issues.push(
          fail(
            CONDITIONAL_FORMATTING,
            `${sheetPath} conditional formatting rule for ${sqref} has formula "${formula}"; Excel rejects the leading "="`,
          ),
        );
      }
    }
  }
  return issues;
}

/**
 * Validate the SpreadsheetML invariants Excel relies on. A tolerant OOXML reader may render a
 * workbook even when desktop Excel later strips these parts during recovery, so this deliberately
 * checks cross-part relationships and worksheet cells as well as table XML.
 */
export async function validateXlsxIntegrity(zip: JSZip, sheetPaths: string[]): Promise<OoxmlIssue[]> {
  const issues: OoxmlIssue[] = [];
  const sheetXmlByPath = new Map<string, string>();
  for (const sheetPath of sheetPaths) {
    const xml = await zip.file(sheetPath)?.async("string");
    if (xml) sheetXmlByPath.set(sheetPath, xml);
  }

  for (const [sheetPath, sheetXml] of sheetXmlByPath) {
    issues.push(...mergeIssues(sheetPath, sheetXml));
    issues.push(...conditionalFormattingIssues(sheetPath, sheetXml));
  }

  const tablePaths = Object.keys(zip.files).filter((name) => /^xl\/tables\/[^/]+\.xml$/i.test(name));
  if (tablePaths.length === 0) return issues;

  const sharedStrings = sharedStringValues(await zip.file("xl/sharedStrings.xml")?.async("string"));
  const owners = new Map<string, string>();

  for (const [sheetPath, sheetXml] of sheetXmlByPath) {
    const parts = openingTags(sheetXml, "tablePart");
    const declaredCount = Number(attributes(openingTags(sheetXml, "tableParts")[0] ?? "").get("count"));
    if (Number.isFinite(declaredCount) && declaredCount !== parts.length) {
      issues.push(warn(TABLES, `${sheetPath} declares ${declaredCount} table parts but contains ${parts.length}`));
    }

    const tableRelationships = new Map<string, string>();
    for (const relationship of await readRelationships(zip, sheetPath)) {
      if (relationship.type.endsWith("/table") && !relationship.external) {
        tableRelationships.set(relationship.id, relationship.path);
      }
    }

    const referencedIds = new Set<string>();
    for (const tag of parts) {
      const id = localAttribute(attributes(tag), "id");
      if (!id) {
        issues.push(fail(TABLES, `${sheetPath} contains a tablePart without r:id`));
        continue;
      }
      referencedIds.add(id);
      const target = tableRelationships.get(id);
      if (!target) {
        issues.push(fail(TABLES, `${sheetPath} tablePart ${id} has no table relationship`));
        continue;
      }
      if (!zip.file(target)) issues.push(fail(TABLES, `${sheetPath} tablePart ${id} targets missing ${target}`));
      else if (owners.has(target)) issues.push(fail(TABLES, `${target} is referenced by more than one worksheet`));
      else owners.set(target, sheetPath);
    }
    for (const [id, target] of tableRelationships) {
      if (!referencedIds.has(id)) {
        issues.push(warn(TABLES, `${sheetPath} has unreferenced table relationship ${id} → ${target}`));
      }
    }
  }

  const tableIds = new Set<string>();
  const tableNames = new Set<string>();
  const rangesBySheet = new Map<string, Array<{ path: string; range: CellRange }>>();
  const cellsBySheet = new Map<string, Map<string, string>>();

  for (const tablePath of tablePaths) {
    const xml = (await zip.file(tablePath)?.async("string")) ?? "";
    const root = openingTags(xml, "table")[0];
    if (!root) {
      issues.push(fail(TABLES, `${tablePath} has no table root element`));
      continue;
    }
    const attrs = attributes(root);
    const id = attrs.get("id");
    if (!id || !/^\d+$/.test(id) || id === "0") {
      issues.push(fail(TABLES, `${tablePath} has invalid table id "${id ?? ""}"`));
    } else if (tableIds.has(id)) issues.push(fail(TABLES, `${tablePath} duplicates table id ${id}`));
    else tableIds.add(id);

    const displayName = attrs.get("displayName");
    const nameIssue = tableNameIssue(displayName);
    if (nameIssue) issues.push(fail(TABLES, `${tablePath} ${nameIssue}`));
    else {
      const foldedName = displayName!.toLowerCase();
      if (tableNames.has(foldedName)) issues.push(fail(TABLES, `${tablePath} duplicates table name "${displayName}"`));
      else tableNames.add(foldedName);
    }

    const reference = attrs.get("ref");
    const range = parseRange(reference);
    if (!range) {
      issues.push(fail(TABLES, `${tablePath} has invalid table range "${reference ?? ""}"`));
      continue;
    }
    const width = range.right - range.left + 1;
    const headerRowCount = Number(attrs.get("headerRowCount") ?? "1");
    if (headerRowCount !== 0 && range.top === range.bottom) {
      issues.push(fail(TABLES, `${tablePath} has a header but no data row`));
    }

    const columnsContainer = openingTags(xml, "tableColumns")[0];
    const columns = openingTags(xml, "tableColumn");
    const declaredColumns = Number(attributes(columnsContainer ?? "").get("count"));
    if (!columnsContainer || declaredColumns !== columns.length || columns.length !== width) {
      issues.push(
        fail(
          TABLES,
          `${tablePath} range is ${width} columns wide but tableColumns declares ${Number.isFinite(declaredColumns) ? declaredColumns : "no count"} and contains ${columns.length}`,
        ),
      );
    }
    const columnNames = columns.map((tag) => decodeEscapedName(attributes(tag).get("name") ?? ""));
    if (columnNames.some((name) => !name.trim())) {
      issues.push(fail(TABLES, `${tablePath} has a blank table column name`));
    }
    if (new Set(columnNames.map((name) => name.toLowerCase())).size !== columnNames.length) {
      issues.push(fail(TABLES, `${tablePath} has duplicate table column names`));
    }

    const autoFilter = openingTags(xml, "autoFilter")[0];
    if (autoFilter) {
      const filterReference = attributes(autoFilter).get("ref");
      const filterRange = parseRange(filterReference);
      const totalsRows = Number(attrs.get("totalsRowCount") ?? "0");
      const withoutTotals = Number.isFinite(totalsRows) && totalsRows > 0 ? range.bottom - totalsRows : range.bottom;
      const matches =
        filterRange &&
        filterRange.left === range.left &&
        filterRange.right === range.right &&
        filterRange.top === range.top &&
        (filterRange.bottom === range.bottom || filterRange.bottom === withoutTotals);
      if (!matches) {
        issues.push(
          warn(
            TABLES,
            `${tablePath} autoFilter range "${filterReference ?? ""}" does not match table range "${reference}"`,
          ),
        );
      }
    }

    const ownerPath = owners.get(tablePath);
    const ownerXml = ownerPath ? sheetXmlByPath.get(ownerPath) : undefined;
    if (!ownerPath || !ownerXml) {
      issues.push(fail(TABLES, `${tablePath} is not referenced by a worksheet tablePart`));
      continue;
    }
    const ownedRanges = rangesBySheet.get(ownerPath) ?? [];
    for (const previous of ownedRanges) {
      if (rangesOverlap(range, previous.range)) {
        issues.push(fail(TABLES, `${tablePath} overlaps ${previous.path} on ${ownerPath}`));
      }
    }
    ownedRanges.push({ path: tablePath, range });
    rangesBySheet.set(ownerPath, ownedRanges);

    for (const mergeTag of openingTags(ownerXml, "mergeCell")) {
      const mergeReference = attributes(mergeTag).get("ref");
      const merged = parseRange(mergeReference);
      if (merged && rangesOverlap(range, merged)) {
        issues.push(fail(TABLES, `${tablePath} overlaps merged cells ${mergeReference} on ${ownerPath}`));
      }
    }

    if (headerRowCount !== 0) {
      let cells = cellsBySheet.get(ownerPath);
      if (!cells) {
        cells = new Map<string, string>();
        for (const cell of elementBlocks(ownerXml, "c")) {
          const cellRef = attributes(openingTags(cell, "c")[0] ?? "").get("r");
          if (cellRef) cells.set(cellRef.replace(/\$/g, "").toUpperCase(), cell);
        }
        cellsBySheet.set(ownerPath, cells);
      }
      const actualHeaders: string[] = [];
      for (let column = range.left; column <= range.right; column++) {
        const value = cellText(cells.get(`${columnLabel(column)}${range.top}`) ?? "", sharedStrings);
        actualHeaders.push(value ?? "");
      }
      if (actualHeaders.some((header) => !header.trim())) {
        issues.push(fail(TABLES, `${tablePath} header row contains a blank, non-text, or formula header cell`));
      }
      if (new Set(actualHeaders.map((header) => header.toLowerCase())).size !== actualHeaders.length) {
        issues.push(fail(TABLES, `${tablePath} worksheet header cells are not unique`));
      }
      if (
        actualHeaders.length === columnNames.length &&
        actualHeaders.some((header, index) => header !== columnNames[index])
      ) {
        issues.push(warn(TABLES, `${tablePath} table column names do not match worksheet header cells`));
      }
    }
  }

  for (const [sheetPath, ranges] of rangesBySheet) {
    const sheetXml = sheetXmlByPath.get(sheetPath);
    if (!sheetXml) continue;
    const filter = parseRange(attributes(openingTags(sheetXml, "autoFilter")[0] ?? "").get("ref"));
    if (!filter) continue;
    for (const entry of ranges) {
      if (rangesOverlap(filter, entry.range)) {
        issues.push(
          fail(TABLES, `${sheetPath} has a worksheet AutoFilter over ${entry.path}; the table owns its own AutoFilter`),
        );
      }
    }
  }

  return issues;
}
