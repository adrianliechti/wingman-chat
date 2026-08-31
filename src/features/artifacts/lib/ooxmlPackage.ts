import type JSZip from "jszip";
import {
  contentTypeForPart,
  MAX_OOXML_METADATA_ENTRIES,
  OoxmlPackageReader,
  ooxmlAttribute,
  ooxmlChildren,
  ooxmlDescendants,
  parseOoxmlContentTypes,
  parseOoxmlRelationships,
  PRESENTATIONML_NAMESPACES,
  R_NAMESPACES,
  relsPathFor,
  SPREADSHEETML_NAMESPACES,
  WORDPROCESSINGML_NAMESPACES,
  type OoxmlContentTypes,
  type OoxmlRelationship,
  type OoxmlXmlElement,
} from "@/shared/lib/ooxml";

export interface OoxmlIssue {
  id: string;
  severity: "fail" | "warn";
  message: string;
}

export const fail = (id: string, message: string): OoxmlIssue => ({ id, severity: "fail", message });
export const warn = (id: string, message: string): OoxmlIssue => ({ id, severity: "warn", message });

export const MAX_OOXML_ISSUES = 12;

export class OoxmlIssueCollector {
  readonly issues: OoxmlIssue[] = [];
  private stopped = false;

  get full(): boolean {
    return this.stopped;
  }

  add(issue: OoxmlIssue): void {
    if (this.stopped) return;
    if (this.issues.length < MAX_OOXML_ISSUES - 1) {
      this.issues.push(issue);
      return;
    }
    this.issues.push(
      warn("ooxml.issue-limit", `Further OOXML validation stopped after ${this.issues.length} findings.`),
    );
    this.stopped = true;
  }

  fail(id: string, message: string): void {
    this.add(fail(id, message));
  }

  warn(id: string, message: string): void {
    this.add(warn(id, message));
  }
}

export type OoxmlFormat = "docx" | "pptx" | "xlsx";

export interface OoxmlLogicalUnit {
  ordinal: number;
  name?: string;
  path?: string;
  present: boolean;
}

export interface OoxmlPackageValidation {
  reader: OoxmlPackageReader;
  issues: OoxmlIssue[];
  contentTypes?: OoxmlContentTypes;
  mainPart?: string;
  logicalUnits: OoxmlLogicalUnit[];
  worksheetParts: string[];
  relationshipsBySource: Map<string, OoxmlRelationship[]>;
  sharedStringsPart?: string;
  stylesPart?: string;
}

const REL_TRANSITIONAL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL_STRICT = "http://purl.oclc.org/ooxml/officeDocument/relationships";
const RELS_CONTENT_TYPE = "application/vnd.openxmlformats-package.relationships+xml";

export function relationshipTypes(suffix: string): readonly string[] {
  return [`${REL_TRANSITIONAL}/${suffix}`, `${REL_STRICT}/${suffix}`];
}

const OFFICE_DOCUMENT_TYPES = new Set(relationshipTypes("officeDocument"));
const SLIDE_TYPES = new Set(relationshipTypes("slide"));
const WORKSHEET_TYPES = new Set(relationshipTypes("worksheet"));
const WORKBOOK_SHEET_TYPES = new Set(
  ["worksheet", "chartsheet", "dialogsheet", "macrosheet"].flatMap((suffix) => relationshipTypes(suffix)),
);
const SHARED_STRINGS_TYPES = new Set(relationshipTypes("sharedStrings"));
const STYLES_TYPES = new Set(relationshipTypes("styles"));
const INVALID_SHEET_NAME_CHARACTERS = ["\\", "/", "*", "?", ":", "[", "]"] as const;

const ROOT_BY_FORMAT: Record<
  OoxmlFormat,
  { localName: string; namespaces: readonly string[]; conventionalPath: string }
> = {
  docx: { localName: "document", namespaces: WORDPROCESSINGML_NAMESPACES, conventionalPath: "word/document.xml" },
  pptx: {
    localName: "presentation",
    namespaces: PRESENTATIONML_NAMESPACES,
    conventionalPath: "ppt/presentation.xml",
  },
  xlsx: { localName: "workbook", namespaces: SPREADSHEETML_NAMESPACES, conventionalPath: "xl/workbook.xml" },
};

function isXmlPart(path: string, contentType: string | undefined): boolean {
  return (
    /\.(?:xml|vml)$/i.test(path) ||
    contentType === "application/xml" ||
    contentType === "text/xml" ||
    contentType?.endsWith("+xml") === true
  );
}

function relationById(relationships: readonly OoxmlRelationship[]): Map<string, OoxmlRelationship> {
  return new Map(relationships.map((relationship) => [relationship.id, relationship]));
}

function singletonRelatedPart(
  relationships: readonly OoxmlRelationship[],
  types: ReadonlySet<string>,
  label: string,
  collector: OoxmlIssueCollector,
): string | undefined {
  const matches = relationships.filter((relationship) => types.has(relationship.type));
  if (matches.length > 1) collector.fail("xlsx.relationships", `Workbook declares multiple ${label} relationships`);
  const relationship = matches[0];
  if (relationship && (relationship.external || !relationship.path)) {
    collector.fail("xlsx.relationships", `Workbook ${label} relationship must target an internal package part`);
  }
  return relationship?.path;
}

function isBoundedUnsignedInteger(value: string | undefined, minimum: number, maximum: number): value is string {
  if (!value || value.length > String(maximum).length || !/^\d+$/.test(value)) return false;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum;
}

function relationshipReferences(root: OoxmlXmlElement): string[] {
  const references = new Set<string>();
  const elements = [root, ...ooxmlDescendants(root)];
  for (const element of elements) {
    for (const attribute of element.attributes) {
      if (R_NAMESPACES.includes(attribute.namespaceUri as (typeof R_NAMESPACES)[number]) && attribute.value) {
        references.add(attribute.value);
      }
    }
  }
  return [...references];
}

function sourcePartForRelationshipsPart(path: string): string | undefined {
  if (path === "_rels/.rels") return "";
  const match = path.match(/^(?:(.+)\/)?_rels\/([^/]+)\.rels$/);
  if (!match) return undefined;
  return match[1] ? `${match[1]}/${match[2]}` : match[2];
}

async function readXml(
  reader: OoxmlPackageReader,
  path: string,
  collector: OoxmlIssueCollector,
): Promise<OoxmlXmlElement | undefined> {
  try {
    const xml = await reader.xml(path);
    if (!xml) collector.fail("ooxml.part", `Referenced XML part ${path} is missing`);
    return xml;
  } catch (error) {
    collector.fail("ooxml.xml", error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

function validateLogicalRoot(
  format: OoxmlFormat,
  path: string,
  root: OoxmlXmlElement | undefined,
  collector: OoxmlIssueCollector,
): void {
  if (!root) return;
  const expected = ROOT_BY_FORMAT[format];
  if (root.localName !== expected.localName || !expected.namespaces.includes(root.namespaceUri ?? "")) {
    collector.fail(
      "ooxml.main-part",
      `${path} is not a ${format.toUpperCase()} ${expected.localName} root in a Transitional or Strict namespace`,
    );
  }
}

function discoverPptxUnits(
  reader: OoxmlPackageReader,
  root: OoxmlXmlElement | undefined,
  relationships: readonly OoxmlRelationship[],
  collector: OoxmlIssueCollector,
): OoxmlLogicalUnit[] {
  if (!root) return [];
  const byId = relationById(relationships);
  const units: OoxmlLogicalUnit[] = [];
  const slideIds = new Set<string>();
  const slideParts = new Set<string>();
  const slideList = ooxmlChildren(root, "sldIdLst", PRESENTATIONML_NAMESPACES)[0];
  const slides = ooxmlChildren(slideList, "sldId", PRESENTATIONML_NAMESPACES);
  if (slides.length > MAX_OOXML_METADATA_ENTRIES) {
    collector.fail(
      "ooxml.resource-limit",
      `Presentation exceeds the ${MAX_OOXML_METADATA_ENTRIES}-slide metadata limit`,
    );
  }
  for (const slide of slides.slice(0, MAX_OOXML_METADATA_ENTRIES)) {
    const ordinal = units.length + 1;
    const numericId = ooxmlAttribute(slide, "id", null);
    const relationshipId = ooxmlAttribute(slide, "id", R_NAMESPACES);
    if (!isBoundedUnsignedInteger(numericId, 256, 2_147_483_647)) {
      collector.fail("pptx.slides", `Presentation slide ${ordinal} has invalid slide id "${numericId ?? ""}"`);
    }
    if (!relationshipId) {
      collector.fail("pptx.slides", `Presentation slide ${ordinal} has no relationship id`);
      units.push({ ordinal, present: false });
      continue;
    }
    if (numericId && slideIds.has(numericId))
      collector.fail("pptx.slides", `Presentation duplicates slide id ${numericId}`);
    if (numericId) slideIds.add(numericId);
    const relationship = byId.get(relationshipId);
    if (!relationship || !SLIDE_TYPES.has(relationship.type) || relationship.external) {
      collector.fail(
        "pptx.slides",
        `Presentation slide ${ordinal} references invalid slide relationship ${relationshipId}`,
      );
      units.push({ ordinal, present: false });
      continue;
    }
    if (relationship.path && slideParts.has(relationship.path)) {
      collector.fail("pptx.slides", `Presentation references slide part ${relationship.path} more than once`);
    }
    if (relationship.path) slideParts.add(relationship.path);
    units.push({
      ordinal,
      ...(relationship.path ? { path: relationship.path } : {}),
      present: relationship.path !== undefined && reader.has(relationship.path),
    });
  }
  if (units.length === 0) collector.fail("pptx.slides", "Presentation contains no logical slides");
  return units;
}

function invalidSheetName(name: string): boolean {
  return (
    !name ||
    name.length > 31 ||
    INVALID_SHEET_NAME_CHARACTERS.some((character) => name.includes(character)) ||
    name.startsWith("'") ||
    name.endsWith("'")
  );
}

function discoverXlsxUnits(
  reader: OoxmlPackageReader,
  root: OoxmlXmlElement | undefined,
  relationships: readonly OoxmlRelationship[],
  collector: OoxmlIssueCollector,
): { units: OoxmlLogicalUnit[]; worksheetParts: string[] } {
  if (!root) return { units: [], worksheetParts: [] };
  const byId = relationById(relationships);
  const units: OoxmlLogicalUnit[] = [];
  const worksheetParts: string[] = [];
  const sheetParts = new Set<string>();
  const names = new Set<string>();
  const sheetIds = new Set<string>();
  const sheetsContainer = ooxmlChildren(root, "sheets", SPREADSHEETML_NAMESPACES)[0];
  const sheets = ooxmlChildren(sheetsContainer, "sheet", SPREADSHEETML_NAMESPACES);
  if (sheets.length > MAX_OOXML_METADATA_ENTRIES) {
    collector.fail("ooxml.resource-limit", `Workbook exceeds the ${MAX_OOXML_METADATA_ENTRIES}-sheet metadata limit`);
  }
  for (const sheet of sheets.slice(0, MAX_OOXML_METADATA_ENTRIES)) {
    const ordinal = units.length + 1;
    const name = ooxmlAttribute(sheet, "name", null) ?? "";
    const sheetId = ooxmlAttribute(sheet, "sheetId", null);
    const relationshipId = ooxmlAttribute(sheet, "id", R_NAMESPACES);
    if (invalidSheetName(name)) collector.fail("xlsx.sheets", `Workbook sheet ${ordinal} has invalid name "${name}"`);
    const foldedName = name.toLowerCase();
    if (names.has(foldedName)) collector.fail("xlsx.sheets", `Workbook duplicates sheet name "${name}"`);
    names.add(foldedName);
    if (!isBoundedUnsignedInteger(sheetId, 1, 4_294_967_295)) {
      collector.fail("xlsx.sheets", `Workbook sheet "${name || ordinal}" has invalid sheetId "${sheetId ?? ""}"`);
    } else if (sheetIds.has(sheetId)) {
      collector.fail("xlsx.sheets", `Workbook duplicates sheetId ${sheetId}`);
    } else {
      sheetIds.add(sheetId);
    }
    const relationship = relationshipId ? byId.get(relationshipId) : undefined;
    if (!relationshipId || !relationship || !WORKBOOK_SHEET_TYPES.has(relationship.type) || relationship.external) {
      collector.fail("xlsx.sheets", `Workbook sheet "${name || ordinal}" has no valid sheet relationship`);
      units.push({ ordinal, ...(name ? { name } : {}), present: false });
      continue;
    }
    if (relationship.path && sheetParts.has(relationship.path)) {
      collector.fail("xlsx.sheets", `Workbook references sheet part ${relationship.path} more than once`);
    }
    if (relationship.path) sheetParts.add(relationship.path);
    if (relationship.path && WORKSHEET_TYPES.has(relationship.type)) worksheetParts.push(relationship.path);
    units.push({
      ordinal,
      ...(name ? { name } : {}),
      ...(relationship.path ? { path: relationship.path } : {}),
      present: relationship.path !== undefined && reader.has(relationship.path),
    });
  }
  if (units.length === 0) collector.fail("xlsx.sheets", "Workbook contains no logical sheets");
  return { units, worksheetParts };
}

/** Validate OPC structure and discover format units through the authored relationship graph. */
export async function validateOoxmlPackage(zip: JSZip, format: OoxmlFormat): Promise<OoxmlPackageValidation> {
  const reader = new OoxmlPackageReader(zip);
  const collector = new OoxmlIssueCollector();
  for (const problem of reader.pathProblems) collector.fail("ooxml.parts", problem);

  let contentTypes: OoxmlContentTypes | undefined;
  const contentTypesXml = await reader.text("[Content_Types].xml").catch((error: unknown) => {
    collector.fail("ooxml.content-types", error instanceof Error ? error.message : String(error));
    return undefined;
  });
  if (!contentTypesXml) {
    collector.fail("ooxml.content-types", "OOXML package is missing [Content_Types].xml");
  } else {
    try {
      const parsed = parseOoxmlContentTypes(contentTypesXml);
      contentTypes = parsed.contentTypes;
      for (const problem of parsed.problems) collector.fail("ooxml.content-types", problem);
    } catch (error) {
      collector.fail("ooxml.content-types", error instanceof Error ? error.message : String(error));
    }
  }

  const relationshipsBySource = new Map<string, OoxmlRelationship[]>();
  const loadRelationships = async (sourcePart: string, required = false): Promise<OoxmlRelationship[]> => {
    const cached = relationshipsBySource.get(sourcePart);
    if (cached) return cached;
    const relationshipPath = relsPathFor(sourcePart);
    if (!reader.has(relationshipPath)) {
      if (required) collector.fail("ooxml.relationships", `OOXML package is missing ${relationshipPath}`);
      relationshipsBySource.set(sourcePart, []);
      return [];
    }
    try {
      const xml = await reader.text(relationshipPath);
      const parsed = parseOoxmlRelationships(xml ?? "", sourcePart);
      for (const problem of parsed.problems) collector.fail("ooxml.relationships", problem.message);
      for (const relationship of parsed.relationships) {
        if (!/^[A-Za-z][A-Za-z\d+.-]*:/.test(relationship.type)) {
          collector.fail(
            "ooxml.relationships",
            `${relationshipPath} relationship ${relationship.id} has invalid Type "${relationship.type}"`,
          );
        }
        if (!relationship.external && relationship.path && !reader.has(relationship.path)) {
          collector.fail(
            "ooxml.relationships",
            `${sourcePart || "package root"} relationship ${relationship.id} targets missing part ${relationship.path}`,
          );
        }
      }
      relationshipsBySource.set(sourcePart, parsed.relationships);
      return parsed.relationships;
    } catch (error) {
      collector.fail("ooxml.relationships", error instanceof Error ? error.message : String(error));
      relationshipsBySource.set(sourcePart, []);
      return [];
    }
  };

  const rootRelationships = await loadRelationships("", true);
  const officeRelationships = rootRelationships.filter((relationship) => OFFICE_DOCUMENT_TYPES.has(relationship.type));
  if (officeRelationships.length !== 1) {
    collector.fail(
      "ooxml.main-part",
      `Package root must declare exactly one officeDocument relationship; found ${officeRelationships.length}`,
    );
  }
  const authoredMain = officeRelationships[0];
  if (authoredMain?.external)
    collector.fail("ooxml.main-part", "Package officeDocument relationship cannot be external");
  const conventionalMain = ROOT_BY_FORMAT[format].conventionalPath;
  const mainPart = authoredMain?.path ?? (reader.has(conventionalMain) ? conventionalMain : undefined);
  const mainRoot = mainPart ? await readXml(reader, mainPart, collector) : undefined;
  if (!mainPart) collector.fail("ooxml.main-part", `Package contains no ${format.toUpperCase()} main document part`);
  else validateLogicalRoot(format, mainPart, mainRoot, collector);

  const mainRelationships = mainPart ? await loadRelationships(mainPart) : [];
  let logicalUnits: OoxmlLogicalUnit[] = [];
  let worksheetParts: string[] = [];
  let sharedStringsPart: string | undefined;
  let stylesPart: string | undefined;
  if (format === "pptx") logicalUnits = discoverPptxUnits(reader, mainRoot, mainRelationships, collector);
  if (format === "xlsx") {
    const discovered = discoverXlsxUnits(reader, mainRoot, mainRelationships, collector);
    logicalUnits = discovered.units;
    worksheetParts = discovered.worksheetParts;
    sharedStringsPart = singletonRelatedPart(mainRelationships, SHARED_STRINGS_TYPES, "shared-string", collector);
    stylesPart = singletonRelatedPart(mainRelationships, STYLES_TYPES, "styles", collector);
  }

  if (format === "pptx") {
    for (const unit of logicalUnits) {
      if (!unit.path || !unit.present) continue;
      const root = await readXml(reader, unit.path, collector);
      if (
        root &&
        (root.localName !== "sld" ||
          !(PRESENTATIONML_NAMESPACES as readonly string[]).includes(root.namespaceUri ?? ""))
      ) {
        collector.fail("pptx.slides", `${unit.path} has no PresentationML slide root element`);
      }
      if (collector.full) break;
    }
  }
  if (format === "xlsx" && !collector.full) {
    for (const path of worksheetParts) {
      if (!reader.has(path)) continue;
      const root = await readXml(reader, path, collector);
      if (
        root &&
        (root.localName !== "worksheet" ||
          !(SPREADSHEETML_NAMESPACES as readonly string[]).includes(root.namespaceUri ?? ""))
      ) {
        collector.fail("xlsx.worksheets", `${path} has no SpreadsheetML worksheet root element`);
      }
      if (collector.full) break;
    }
  }

  const queue = [
    ...new Set(
      rootRelationships.flatMap((relationship) =>
        !relationship.external && relationship.path && reader.has(relationship.path) ? [relationship.path] : [],
      ),
    ),
  ];
  const queued = new Set(queue);
  const visited = new Set<string>();
  for (let queueIndex = 0; queueIndex < queue.length && !collector.full; queueIndex++) {
    const sourcePart = queue[queueIndex];
    if (visited.has(sourcePart)) continue;
    visited.add(sourcePart);
    const contentType = contentTypes ? contentTypeForPart(contentTypes, sourcePart) : undefined;
    const root = isXmlPart(sourcePart, contentType) ? await readXml(reader, sourcePart, collector) : undefined;
    const relationships = await loadRelationships(sourcePart);
    if (root) {
      const declared = new Set(relationships.map((relationship) => relationship.id));
      for (const reference of relationshipReferences(root)) {
        if (!declared.has(reference)) {
          collector.fail(
            "ooxml.relationships",
            `${sourcePart} references ${reference}, which is not declared in ${relsPathFor(sourcePart)}`,
          );
        }
      }
    }
    for (const relationship of relationships) {
      if (
        !relationship.external &&
        relationship.path &&
        reader.has(relationship.path) &&
        !queued.has(relationship.path)
      ) {
        queued.add(relationship.path);
        queue.push(relationship.path);
      }
    }
  }

  if (!collector.full) {
    for (const relationshipPath of reader.paths.filter((path) => path.endsWith(".rels"))) {
      const sourcePart = sourcePartForRelationshipsPart(relationshipPath);
      if (sourcePart === undefined) {
        collector.fail("ooxml.relationships", `${relationshipPath} is not in a valid OPC relationship-part location`);
      } else {
        if (sourcePart && !reader.has(sourcePart)) {
          collector.fail("ooxml.relationships", `${relationshipPath} belongs to missing source part ${sourcePart}`);
        }
        await loadRelationships(sourcePart);
      }
      if (collector.full) break;
    }
  }

  if (contentTypes && !collector.full) {
    for (const path of reader.paths) {
      if (path === "[Content_Types].xml") continue;
      const contentType = contentTypeForPart(contentTypes, path);
      if (!contentType) collector.fail("ooxml.content-types", `No content type is declared for package part ${path}`);
      if (/\.rels$/i.test(path) && contentType && contentType !== RELS_CONTENT_TYPE) {
        collector.fail("ooxml.content-types", `${path} has invalid relationship content type ${contentType}`);
      }
      if (collector.full) break;
    }
    if (!collector.full) {
      for (const path of contentTypes.overrides.keys()) {
        if (!reader.has(path))
          collector.warn("ooxml.content-types", `[Content_Types].xml has an orphan Override for ${path}`);
        if (collector.full) break;
      }
    }
  }

  return {
    reader,
    issues: collector.issues,
    ...(contentTypes ? { contentTypes } : {}),
    ...(mainPart ? { mainPart } : {}),
    logicalUnits,
    worksheetParts,
    relationshipsBySource,
    ...(sharedStringsPart ? { sharedStringsPart } : {}),
    ...(stylesPart ? { stylesPart } : {}),
  };
}
