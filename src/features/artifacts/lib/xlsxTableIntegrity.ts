import type JSZip from "jszip";

interface CellRange {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface TableOwner {
  sheetPath: string;
  sheetXml: string;
}

const XML_ENTITY = /&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi;

function decodeXml(value: string): string {
  return value.replace(XML_ENTITY, (entity) => {
    if (entity === "&amp;") return "&";
    if (entity === "&lt;") return "<";
    if (entity === "&gt;") return ">";
    if (entity === "&quot;") return '"';
    if (entity === "&apos;") return "'";
    const hex = entity.match(/^&#x([\da-f]+);$/i)?.[1];
    const decimal = entity.match(/^&#(\d+);$/)?.[1];
    const codePoint = Number.parseInt(hex ?? decimal ?? "", hex ? 16 : 10);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
  });
}

function attributes(tag: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of tag.matchAll(/([\w.-]+(?::[\w.-]+)?)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    result.set(match[1], decodeXml(match[2] ?? match[3] ?? ""));
  }
  return result;
}

function localAttribute(attrs: Map<string, string>, name: string): string | undefined {
  for (const [key, value] of attrs) {
    if (key === name || key.endsWith(`:${name}`)) return value;
  }
  return undefined;
}

function openingTags(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>`, "gi"))].map((match) => match[0]);
}

function elementBlocks(xml: string, name: string): string[] {
  return [
    ...xml.matchAll(
      new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>[\\s\\S]*?<\\/(?:(?:[\\w.-]+):)?${name}\\s*>`, "gi"),
    ),
  ].map((match) => match[0]);
}

function firstTagText(xml: string, name: string): string | undefined {
  const match = xml.match(
    new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}\\s*>`, "i"),
  );
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, "")) : undefined;
}

function columnNumber(label: string): number {
  let value = 0;
  for (const char of label.toUpperCase()) value = value * 26 + char.charCodeAt(0) - 64;
  return value;
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

function resolvePackagePath(sourcePart: string, target: string): string {
  const base = sourcePart.slice(0, sourcePart.lastIndexOf("/") + 1);
  const segments = (target.startsWith("/") ? target.slice(1) : `${base}${target}`).split("/");
  const resolved: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") resolved.pop();
    else resolved.push(segment);
  }
  return resolved.join("/");
}

function relationshipPath(sheetPath: string): string {
  const slash = sheetPath.lastIndexOf("/");
  return `${sheetPath.slice(0, slash)}/_rels/${sheetPath.slice(slash + 1)}.rels`;
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

/**
 * Validate the SpreadsheetML invariants Excel relies on for structured tables.
 * A tolerant OOXML reader may render a workbook even when desktop Excel later
 * removes these parts during recovery, so this deliberately checks cross-part
 * relationships and worksheet header cells as well as table XML.
 */
export async function validateXlsxTableIntegrity(zip: JSZip, sheetPaths: string[]): Promise<string[]> {
  const issues: string[] = [];
  const tablePaths = Object.keys(zip.files).filter((name) => /^xl\/tables\/[^/]+\.xml$/i.test(name));
  if (tablePaths.length === 0) return issues;

  const sharedStrings = sharedStringValues(await zip.file("xl/sharedStrings.xml")?.async("string"));
  const owners = new Map<string, TableOwner>();

  for (const sheetPath of sheetPaths) {
    const sheetXml = await zip.file(sheetPath)?.async("string");
    if (!sheetXml) continue;
    const parts = openingTags(sheetXml, "tablePart");
    const declaredCount = Number(attributes(openingTags(sheetXml, "tableParts")[0] ?? "").get("count"));
    if (Number.isFinite(declaredCount) && declaredCount !== parts.length) {
      issues.push(`${sheetPath} declares ${declaredCount} table parts but contains ${parts.length}`);
    }

    const relsXml = await zip.file(relationshipPath(sheetPath))?.async("string");
    const tableRelationships = new Map<string, string>();
    for (const tag of openingTags(relsXml ?? "", "Relationship")) {
      const attrs = attributes(tag);
      if (!attrs.get("Type")?.endsWith("/table")) continue;
      const id = attrs.get("Id");
      const target = attrs.get("Target");
      if (id && target) tableRelationships.set(id, resolvePackagePath(sheetPath, target));
    }

    const referencedIds = new Set<string>();
    for (const tag of parts) {
      const id = localAttribute(attributes(tag), "id");
      if (!id) {
        issues.push(`${sheetPath} contains a tablePart without r:id`);
        continue;
      }
      referencedIds.add(id);
      const target = tableRelationships.get(id);
      if (!target) {
        issues.push(`${sheetPath} tablePart ${id} has no table relationship`);
        continue;
      }
      if (!zip.file(target)) issues.push(`${sheetPath} tablePart ${id} targets missing ${target}`);
      else if (owners.has(target)) issues.push(`${target} is referenced by more than one worksheet`);
      else owners.set(target, { sheetPath, sheetXml });
    }
    for (const [id, target] of tableRelationships) {
      if (!referencedIds.has(id)) issues.push(`${sheetPath} has unreferenced table relationship ${id} → ${target}`);
    }
  }

  const tableIds = new Set<string>();
  const tableNames = new Set<string>();
  const rangesBySheet = new Map<string, Array<{ path: string; range: CellRange }>>();

  for (const tablePath of tablePaths) {
    const xml = await zip.file(tablePath)?.async("string");
    const root = openingTags(xml ?? "", "table")[0];
    if (!root) {
      issues.push(`${tablePath} has no table root element`);
      continue;
    }
    const attrs = attributes(root);
    const id = attrs.get("id");
    if (!id || !/^\d+$/.test(id) || id === "0") issues.push(`${tablePath} has invalid table id "${id ?? ""}"`);
    else if (tableIds.has(id)) issues.push(`${tablePath} duplicates table id ${id}`);
    else tableIds.add(id);

    const displayName = attrs.get("displayName");
    const nameIssue = tableNameIssue(displayName);
    if (nameIssue) issues.push(`${tablePath} ${nameIssue}`);
    else {
      const foldedName = displayName!.toLowerCase();
      if (tableNames.has(foldedName)) issues.push(`${tablePath} duplicates table name "${displayName}"`);
      else tableNames.add(foldedName);
    }

    const reference = attrs.get("ref");
    const range = parseRange(reference);
    if (!range) {
      issues.push(`${tablePath} has invalid table range "${reference ?? ""}"`);
      continue;
    }
    const width = range.right - range.left + 1;
    const headerRowCount = Number(attrs.get("headerRowCount") ?? "1");
    if (headerRowCount !== 0 && range.top === range.bottom) issues.push(`${tablePath} has a header but no data row`);

    const columnsContainer = openingTags(xml ?? "", "tableColumns")[0];
    const columns = openingTags(xml ?? "", "tableColumn");
    const declaredColumns = Number(attributes(columnsContainer ?? "").get("count"));
    if (!columnsContainer || declaredColumns !== columns.length || columns.length !== width) {
      issues.push(
        `${tablePath} range is ${width} columns wide but tableColumns declares ${Number.isFinite(declaredColumns) ? declaredColumns : "no count"} and contains ${columns.length}`,
      );
    }
    const columnNames = columns.map((tag) => attributes(tag).get("name") ?? "");
    if (columnNames.some((name) => !name.trim())) issues.push(`${tablePath} has a blank table column name`);
    if (new Set(columnNames.map((name) => name.trim().toLowerCase())).size !== columnNames.length) {
      issues.push(`${tablePath} has duplicate table column names`);
    }

    const autoFilter = openingTags(xml ?? "", "autoFilter")[0];
    if (autoFilter) {
      const filterRef = attributes(autoFilter).get("ref");
      const totalsRows = Number(attrs.get("totalsRowCount") ?? "0");
      const corners = reference!.split(":");
      const withoutTotals =
        totalsRows > 0 && range.bottom > range.top && corners.length === 2
          ? `${corners[0]}:${corners[1].replace(/\d+$/, String(range.bottom - totalsRows))}`
          : reference;
      if (filterRef !== reference && filterRef !== withoutTotals) {
        issues.push(`${tablePath} autoFilter range "${filterRef ?? ""}" does not match table range "${reference}"`);
      }
    }

    const owner = owners.get(tablePath);
    if (!owner) {
      issues.push(`${tablePath} is not referenced by a worksheet tablePart`);
      continue;
    }
    const ownedRanges = rangesBySheet.get(owner.sheetPath) ?? [];
    for (const previous of ownedRanges) {
      if (rangesOverlap(range, previous.range))
        issues.push(`${tablePath} overlaps ${previous.path} on ${owner.sheetPath}`);
    }
    ownedRanges.push({ path: tablePath, range });
    rangesBySheet.set(owner.sheetPath, ownedRanges);

    for (const mergeTag of openingTags(owner.sheetXml, "mergeCell")) {
      const merged = parseRange(attributes(mergeTag).get("ref"));
      if (merged && rangesOverlap(range, merged)) {
        issues.push(`${tablePath} overlaps merged cells ${attributes(mergeTag).get("ref")} on ${owner.sheetPath}`);
      }
    }

    if (headerRowCount !== 0) {
      const cells = new Map<string, string>();
      for (const cell of elementBlocks(owner.sheetXml, "c")) {
        const cellRef = attributes(openingTags(cell, "c")[0] ?? "").get("r");
        if (cellRef) cells.set(cellRef.replace(/\$/g, "").toUpperCase(), cell);
      }
      const actualHeaders: string[] = [];
      for (let column = range.left; column <= range.right; column++) {
        const label = (() => {
          let value = column;
          let result = "";
          while (value > 0) {
            value--;
            result = String.fromCharCode(65 + (value % 26)) + result;
            value = Math.floor(value / 26);
          }
          return result;
        })();
        const value = cellText(cells.get(`${label}${range.top}`) ?? "", sharedStrings);
        actualHeaders.push(value ?? "");
      }
      if (actualHeaders.some((header) => !header.trim())) {
        issues.push(`${tablePath} header row contains a blank, non-text, or formula header cell`);
      }
      if (new Set(actualHeaders.map((header) => header.trim().toLowerCase())).size !== actualHeaders.length) {
        issues.push(`${tablePath} worksheet header cells are not unique`);
      }
      if (
        actualHeaders.length === columnNames.length &&
        actualHeaders.some((header, index) => header !== columnNames[index])
      ) {
        issues.push(`${tablePath} table column names do not match worksheet header cells`);
      }
    }
  }

  return issues;
}
