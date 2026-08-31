import type JSZip from "jszip";
import { parser as createSaxParser, type QualifiedAttribute, type QualifiedTag } from "sax";

/**
 * Shared helpers for parsing Office Open XML (pptx/docx) parts:
 * XML traversal, unit conversion, escaping and relationship targets.
 */

export const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const R_NS_STRICT = "http://purl.oclc.org/ooxml/officeDocument/relationships";
export const R_NAMESPACES = [R_NS, R_NS_STRICT] as const;
export const PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
export const CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
export const WORDPROCESSINGML_NAMESPACES = [
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  "http://purl.oclc.org/ooxml/wordprocessingml/main",
] as const;
export const PRESENTATIONML_NAMESPACES = [
  "http://schemas.openxmlformats.org/presentationml/2006/main",
  "http://purl.oclc.org/ooxml/presentationml/main",
] as const;
export const SPREADSHEETML_NAMESPACES = [
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  "http://purl.oclc.org/ooxml/spreadsheetml/main",
] as const;

export const DEFAULT_OOXML_READER_LIMITS = Object.freeze({
  maxArchiveEntries: 20_000,
  maxXmlPartBytes: 32 * 1024 * 1024,
  maxTotalXmlBytes: 128 * 1024 * 1024,
  maxXmlNodes: 500_000,
  maxXmlDepth: 256,
});
export const MAX_OOXML_METADATA_ENTRIES = 20_000;

const MAX_OOXML_PARSE_PROBLEMS = 64;

export interface OoxmlReaderLimits {
  maxArchiveEntries: number;
  maxXmlPartBytes: number;
  maxTotalXmlBytes: number;
  maxXmlNodes: number;
  maxXmlDepth: number;
}

export class OoxmlResourceLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OoxmlResourceLimitError";
  }
}

export class OoxmlXmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OoxmlXmlError";
  }
}

export interface OoxmlXmlAttribute {
  name: string;
  localName: string;
  namespaceUri?: string;
  value: string;
}

export interface OoxmlXmlElement {
  name: string;
  localName: string;
  namespaceUri?: string;
  attributes: OoxmlXmlAttribute[];
  children: OoxmlXmlElement[];
  content: Array<string | OoxmlXmlElement>;
}

type NamespaceFilter = string | readonly string[] | null;

function namespaceMatches(actual: string | undefined, expected: NamespaceFilter | undefined): boolean {
  if (expected === undefined) return true;
  if (expected === null) return actual === undefined;
  return typeof expected === "string" ? actual === expected : expected.includes(actual ?? "");
}

/** Parse untrusted OOXML XML into a small namespace-resolved tree. */
export function parseOoxmlXml(
  xml: string,
  label = "XML part",
  limits: Pick<OoxmlReaderLimits, "maxXmlNodes" | "maxXmlDepth"> = DEFAULT_OOXML_READER_LIMITS,
): OoxmlXmlElement {
  let nodeCount = 0;
  let root: OoxmlXmlElement | undefined;
  let pendingAttributes: OoxmlXmlAttribute[] = [];
  let pendingAttributeNames = new Set<string>();
  const stack: OoxmlXmlElement[] = [];
  const parser = createSaxParser(true, { strictEntities: true, xmlns: true });

  const malformed = (message: string): never => {
    throw new OoxmlXmlError(`${label} is malformed: ${message}`);
  };

  parser.onerror = (error) => {
    malformed(error.message);
  };
  parser.ondoctype = () => {
    throw new OoxmlXmlError(`${label} contains a forbidden document type declaration`);
  };
  parser.onattribute = (attribute: QualifiedAttribute) => {
    const expandedName = `${attribute.uri}\0${attribute.local}`;
    if (pendingAttributeNames.has(expandedName)) {
      malformed(`duplicate attribute ${attribute.name}`);
    }
    pendingAttributeNames.add(expandedName);
    if (attribute.name === "xmlns" || attribute.prefix === "xmlns") return;
    pendingAttributes.push({
      name: attribute.name,
      localName: attribute.local,
      ...(attribute.uri ? { namespaceUri: attribute.uri } : {}),
      value: attribute.value,
    });
  };
  parser.onopentag = (tag: QualifiedTag) => {
    nodeCount++;
    if (nodeCount > limits.maxXmlNodes) {
      throw new OoxmlResourceLimitError(`${label} exceeds the ${limits.maxXmlNodes}-node XML limit`);
    }
    const depth = stack.length + 1;
    if (depth > limits.maxXmlDepth) {
      throw new OoxmlResourceLimitError(`${label} exceeds the ${limits.maxXmlDepth}-level XML depth limit`);
    }
    const element: OoxmlXmlElement = {
      name: tag.name,
      localName: tag.local,
      ...(tag.uri ? { namespaceUri: tag.uri } : {}),
      attributes: pendingAttributes,
      children: [],
      content: [],
    };
    pendingAttributes = [];
    pendingAttributeNames = new Set();
    const parent = stack.at(-1);
    if (parent) {
      parent.children.push(element);
      parent.content.push(element);
    } else if (root) malformed("multiple root elements");
    else root = element;
    stack.push(element);
  };
  parser.onclosetag = () => {
    stack.pop();
  };
  parser.ontext = (text) => {
    const current = stack.at(-1);
    if (current) current.content.push(text);
    else if (text.trim()) malformed("text outside the root element");
  };
  parser.oncdata = (text) => {
    const current = stack.at(-1);
    if (current) current.content.push(text);
    else malformed("CDATA outside the root element");
  };

  try {
    parser.write(xml).close();
  } catch (error) {
    if (error instanceof OoxmlResourceLimitError || error instanceof OoxmlXmlError) throw error;
    throw new OoxmlXmlError(`${label} is malformed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!root) throw new OoxmlXmlError(`${label} must contain exactly one root element`);
  return root;
}

export function ooxmlAttribute(
  element: OoxmlXmlElement | undefined,
  localName: string,
  namespace?: NamespaceFilter,
): string | undefined {
  return element?.attributes.find(
    (attribute) => attribute.localName === localName && namespaceMatches(attribute.namespaceUri, namespace),
  )?.value;
}

export function ooxmlChildren(
  element: OoxmlXmlElement | undefined,
  localName?: string,
  namespace?: NamespaceFilter,
): OoxmlXmlElement[] {
  return (
    element?.children.filter(
      (child) =>
        (localName === undefined || child.localName === localName) && namespaceMatches(child.namespaceUri, namespace),
    ) ?? []
  );
}

export function* ooxmlDescendants(
  element: OoxmlXmlElement | undefined,
  localName?: string,
  namespace?: NamespaceFilter,
): Generator<OoxmlXmlElement> {
  if (!element) return;
  for (const child of element.children) {
    if ((localName === undefined || child.localName === localName) && namespaceMatches(child.namespaceUri, namespace)) {
      yield child;
    }
    yield* ooxmlDescendants(child, localName, namespace);
  }
}

export function ooxmlText(element: OoxmlXmlElement | undefined): string {
  if (!element) return "";
  return element.content.map((item) => (typeof item === "string" ? item : ooxmlText(item))).join("");
}

/** 914400 EMU per inch / 96 px per inch */
export const EMU_PER_PX = 9525;

export function emuToPx(emu: number): number {
  return Math.round((emu / EMU_PER_PX) * 100) / 100;
}

/** Points → CSS px (96 dpi) */
export function ptToPx(pt: number): number {
  return Math.round(pt * (96 / 72) * 100) / 100;
}

/** Twentieths of a point (Word's "dxa") → CSS px */
export function twipToPx(twip: number): number {
  return Math.round((twip / 15) * 100) / 100;
}

export function px(n: number): string {
  return `${Math.round(n * 100) / 100}px`;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function parseXml(xml: string): Document {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = document.getElementsByTagNameNS("*", "parsererror")[0];
  if (parserError) throw new OoxmlXmlError(parserError.textContent?.trim() || "XML is malformed");
  return document;
}

// ============================================================================
// XML traversal (tag names are namespace-prefixed, e.g. "w:p", "a:blip")
// ============================================================================

export function child(el: Element | undefined | null, name: string): Element | undefined {
  if (!el) return undefined;
  for (const c of el.children) {
    if (c.tagName === name) return c;
  }
  return undefined;
}

export function childList(el: Element | undefined | null, name?: string): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  for (const c of el.children) {
    if (!name || c.tagName === name) out.push(c);
  }
  return out;
}

export function descend(el: Element | undefined | null, ...path: string[]): Element | undefined {
  let cur: Element | undefined = el ?? undefined;
  for (const name of path) {
    cur = child(cur, name);
    if (!cur) return undefined;
  }
  return cur;
}

export function intAttr(el: Element | undefined | null, attr: string): number | undefined {
  const v = el?.getAttribute(attr);
  if (v == null) return undefined;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
}

export function boolAttr(el: Element | undefined | null, attr: string): boolean | undefined {
  const v = el?.getAttribute(attr);
  if (v == null) return undefined;
  return v === "1" || v === "true" || v === "on";
}

export function getRId(el: Element | undefined | null, attr = "embed"): string | null {
  if (!el) return null;
  for (const namespace of R_NAMESPACES) {
    const value = el.getAttributeNS(namespace, attr);
    if (value) return value;
  }
  return el.getAttribute(`r:${attr}`);
}

// ============================================================================
// Relationships & media
// ============================================================================

/** Resolve a relationship target relative to the part that declares it. */
export function resolveTarget(partPath: string, target: string): string {
  return resolveTargetChecked(partPath, target).path ?? "";
}

export interface ResolvedOoxmlTarget {
  path?: string;
  error?: string;
}

/** Resolve an internal OPC target, retaining an actionable error for invalid paths. */
export function resolveTargetChecked(partPath: string, target: string): ResolvedOoxmlTarget {
  if (!target) return { error: "has an empty Target" };
  if (target.includes("\\")) return { error: `has non-OPC Target "${target}" containing a backslash` };
  if (target.includes("?") || target.includes("#")) {
    return { error: `has non-part Target "${target}" containing a query or fragment` };
  }
  const parts = target.startsWith("/") ? [] : partPath.split("/").slice(0, -1).filter(Boolean);
  for (const seg of target.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return { error: `has Target "${target}" that escapes the package root` };
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.length > 0 ? { path: parts.join("/") } : { error: `has Target "${target}" resolving to no part` };
}

export const MEDIA_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
};

export interface Rel {
  target: string;
  type: string;
  external: boolean;
}

export interface OoxmlRelationship extends Rel {
  id: string;
  path?: string;
}

export interface OoxmlRelationshipProblem {
  message: string;
}

export interface ParsedOoxmlRelationships {
  relationships: OoxmlRelationship[];
  problems: OoxmlRelationshipProblem[];
}

/** Path of the .rels part describing `partPath`. */
export function relsPathFor(partPath: string): string {
  if (!partPath) return "_rels/.rels";
  const slash = partPath.lastIndexOf("/");
  const dir = slash < 0 ? "" : partPath.slice(0, slash);
  const name = partPath.slice(slash + 1);
  return dir ? `${dir}/_rels/${name}.rels` : `_rels/${name}.rels`;
}

/** Parse and validate one OPC relationship part. */
export function parseOoxmlRelationships(xml: string, sourcePart = ""): ParsedOoxmlRelationships {
  const root = parseOoxmlXml(xml, relsPathFor(sourcePart));
  const problems: OoxmlRelationshipProblem[] = [];
  const relationships: OoxmlRelationship[] = [];
  const addProblem = (message: string): void => {
    if (problems.length < MAX_OOXML_PARSE_PROBLEMS) problems.push({ message });
  };
  if (root.localName !== "Relationships" || root.namespaceUri !== PACKAGE_REL_NS) {
    addProblem(`${relsPathFor(sourcePart)} has an invalid Relationships root namespace`);
    return { relationships, problems };
  }
  if (root.children.length > MAX_OOXML_METADATA_ENTRIES) {
    throw new OoxmlResourceLimitError(
      `${relsPathFor(sourcePart)} exceeds the ${MAX_OOXML_METADATA_ENTRIES}-relationship metadata limit`,
    );
  }

  const ids = new Set<string>();
  for (const child of root.children) {
    if (child.localName !== "Relationship" || child.namespaceUri !== PACKAGE_REL_NS) {
      addProblem(`${relsPathFor(sourcePart)} contains an unexpected ${child.name} element`);
      continue;
    }
    const id = ooxmlAttribute(child, "Id", null);
    const type = ooxmlAttribute(child, "Type", null);
    const target = ooxmlAttribute(child, "Target", null);
    const targetMode = ooxmlAttribute(child, "TargetMode", null);
    if (!id || !type || !target) {
      addProblem(`${relsPathFor(sourcePart)} contains a Relationship without Id, Type, or Target`);
      continue;
    }
    if (ids.has(id)) {
      addProblem(`${relsPathFor(sourcePart)} duplicates relationship Id ${id}`);
      continue;
    }
    ids.add(id);

    const external = targetMode?.toLowerCase() === "external";
    if (targetMode && !external && targetMode.toLowerCase() !== "internal") {
      addProblem(`${relsPathFor(sourcePart)} relationship ${id} has invalid TargetMode "${targetMode}"`);
      continue;
    }
    if (external) {
      relationships.push({ id, target, type, external: true });
      continue;
    }
    const resolved = resolveTargetChecked(sourcePart, target);
    if (!resolved.path) {
      addProblem(`${relsPathFor(sourcePart)} relationship ${id} ${resolved.error ?? "has an invalid Target"}`);
    }
    relationships.push({ id, target, type, external: false, ...(resolved.path ? { path: resolved.path } : {}) });
  }
  return { relationships, problems };
}

function domRelationships(document: Document): OoxmlRelationship[] {
  const root = document.documentElement;
  if (root.localName !== "Relationships" || root.namespaceURI !== PACKAGE_REL_NS) return [];
  const relationships: OoxmlRelationship[] = [];
  for (const element of Array.from(root.children)) {
    if (element.localName !== "Relationship" || element.namespaceURI !== PACKAGE_REL_NS) continue;
    const id = element.getAttribute("Id");
    const target = element.getAttribute("Target");
    const type = element.getAttribute("Type");
    const targetMode = element.getAttribute("TargetMode");
    if (!id || !target || !type || (targetMode && !/^(?:Internal|External)$/i.test(targetMode))) continue;
    relationships.push({ id, target, type, external: targetMode?.toLowerCase() === "external" });
  }
  return relationships;
}

/** Parse a .rels document into an arbitrary relationship-id → relationship map. */
export function parseRels(input: Document | OoxmlXmlElement | string | null): Map<string, Rel> {
  const rels = new Map<string, Rel>();
  if (!input) return rels;
  const relationships =
    typeof input === "string"
      ? parseOoxmlRelationships(input).relationships
      : "nodeType" in input
        ? domRelationships(input)
        : input.localName === "Relationships" && input.namespaceUri === PACKAGE_REL_NS
          ? input.children.flatMap((child) => {
              if (child.localName !== "Relationship" || child.namespaceUri !== PACKAGE_REL_NS) return [];
              const id = ooxmlAttribute(child, "Id", null);
              const target = ooxmlAttribute(child, "Target", null);
              const type = ooxmlAttribute(child, "Type", null);
              if (!id || !target || !type) return [];
              return [
                {
                  id,
                  target,
                  type,
                  external: ooxmlAttribute(child, "TargetMode", null)?.toLowerCase() === "external",
                },
              ];
            })
          : [];
  for (const relationship of relationships) {
    rels.set(relationship.id, {
      target: relationship.target,
      type: relationship.type,
      external: relationship.external,
    });
  }
  return rels;
}

export interface OoxmlContentTypes {
  defaults: Map<string, string>;
  overrides: Map<string, string>;
}

export interface ParsedOoxmlContentTypes {
  contentTypes: OoxmlContentTypes;
  problems: string[];
}

export function parseOoxmlContentTypes(xml: string): ParsedOoxmlContentTypes {
  const root = parseOoxmlXml(xml, "[Content_Types].xml");
  const contentTypes: OoxmlContentTypes = { defaults: new Map(), overrides: new Map() };
  const foldedOverrides = new Set<string>();
  const problems: string[] = [];
  const addProblem = (message: string): void => {
    if (problems.length < MAX_OOXML_PARSE_PROBLEMS) problems.push(message);
  };
  if (root.localName !== "Types" || root.namespaceUri !== CONTENT_TYPES_NS) {
    addProblem("[Content_Types].xml has an invalid Types root namespace");
    return { contentTypes, problems };
  }
  if (root.children.length > MAX_OOXML_METADATA_ENTRIES) {
    throw new OoxmlResourceLimitError(
      `[Content_Types].xml exceeds the ${MAX_OOXML_METADATA_ENTRIES}-entry metadata limit`,
    );
  }
  for (const child of root.children) {
    if (child.namespaceUri !== CONTENT_TYPES_NS) {
      addProblem(`[Content_Types].xml contains unexpected foreign element ${child.name}`);
      continue;
    }
    if (child.localName === "Default") {
      const extension = ooxmlAttribute(child, "Extension", null)?.toLowerCase();
      const contentType = ooxmlAttribute(child, "ContentType", null);
      if (!extension || !contentType || extension.includes("/") || extension.startsWith(".")) {
        addProblem("[Content_Types].xml contains an invalid Default entry");
      } else if (contentTypes.defaults.has(extension)) {
        addProblem(`[Content_Types].xml duplicates Default extension ${extension}`);
      } else {
        contentTypes.defaults.set(extension, contentType);
      }
    } else if (child.localName === "Override") {
      const partName = ooxmlAttribute(child, "PartName", null);
      const contentType = ooxmlAttribute(child, "ContentType", null);
      const resolved = partName?.startsWith("/") ? resolveTargetChecked("", partName) : {};
      if (!partName || !contentType || !resolved.path) {
        addProblem(`[Content_Types].xml contains an invalid Override for "${partName ?? ""}"`);
      } else {
        const folded = resolved.path.toLowerCase();
        if (foldedOverrides.has(folded)) {
          addProblem(`[Content_Types].xml duplicates Override part ${resolved.path}`);
        } else {
          foldedOverrides.add(folded);
          contentTypes.overrides.set(resolved.path, contentType);
        }
      }
    } else {
      addProblem(`[Content_Types].xml contains unexpected ${child.name} element`);
    }
  }
  return { contentTypes, problems };
}

export function contentTypeForPart(contentTypes: OoxmlContentTypes, partPath: string): string | undefined {
  const exact = contentTypes.overrides.get(partPath);
  if (exact) return exact;
  const dot = partPath.lastIndexOf(".");
  return dot < 0 ? undefined : contentTypes.defaults.get(partPath.slice(dot + 1).toLowerCase());
}

interface InternalZipData {
  uncompressedSize?: number;
}

interface InternalZipEntry {
  _data?: InternalZipData;
  unsafeOriginalName?: string;
}

function nonCanonicalPartPath(path: string): boolean {
  return (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#") ||
    /%(?:2f|5c)/i.test(path) ||
    path.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
    !/^[\x20-\x7e]+$/.test(path)
  );
}

/** Bounded, cached access to XML parts in one JSZip package. */
export class OoxmlPackageReader {
  readonly paths: string[];
  readonly pathProblems: string[] = [];
  private readonly zip: JSZip;
  private readonly limits: OoxmlReaderLimits;
  private readonly textCache = new Map<string, Promise<string | undefined>>();
  private readonly xmlCache = new Map<string, Promise<OoxmlXmlElement | undefined>>();
  private totalXmlBytes = 0;

  constructor(zip: JSZip, limits: Partial<OoxmlReaderLimits> = {}) {
    this.zip = zip;
    this.limits = { ...DEFAULT_OOXML_READER_LIMITS, ...limits };
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    this.paths = entries.map((entry) => entry.name);
    if (this.paths.length > this.limits.maxArchiveEntries) {
      throw new OoxmlResourceLimitError(
        `OOXML package contains ${this.paths.length} entries, over the ${this.limits.maxArchiveEntries}-entry limit`,
      );
    }
    const folded = new Map<string, string>();
    for (const entry of entries) {
      const path = entry.name;
      const unsafeOriginalName = (entry as unknown as InternalZipEntry).unsafeOriginalName;
      if (unsafeOriginalName && unsafeOriginalName !== path) {
        this.pathProblems.push(`OOXML part name "${unsafeOriginalName}" was sanitized to "${path}"`);
      }
      if (nonCanonicalPartPath(path)) {
        this.pathProblems.push(`OOXML part name "${path}" is not a canonical ASCII package path`);
      }
      const key = path.toLowerCase();
      const previous = folded.get(key);
      if (previous && previous !== path) {
        this.pathProblems.push(`OOXML part names differ only by case: ${previous} and ${path}`);
      } else {
        folded.set(key, path);
      }
    }
  }

  has(path: string): boolean {
    return this.zip.file(path) !== null;
  }

  async text(path: string): Promise<string | undefined> {
    const cached = this.textCache.get(path);
    if (cached) return cached;
    const pending = this.readText(path);
    this.textCache.set(path, pending);
    return pending;
  }

  async xml(path: string): Promise<OoxmlXmlElement | undefined> {
    const cached = this.xmlCache.get(path);
    if (cached) return cached;
    const pending = (async () => {
      const text = await this.text(path);
      return text === undefined ? undefined : parseOoxmlXml(text, path, this.limits);
    })();
    this.xmlCache.set(path, pending);
    return pending;
  }

  private async readText(path: string): Promise<string | undefined> {
    const entry = this.zip.file(path);
    if (!entry) return undefined;
    const declaredSize = (entry as unknown as InternalZipEntry)._data?.uncompressedSize;
    if (declaredSize !== undefined && declaredSize > this.limits.maxXmlPartBytes) {
      throw new OoxmlResourceLimitError(
        `${path} declares ${declaredSize} inflated bytes, over the ${this.limits.maxXmlPartBytes}-byte XML part limit`,
      );
    }
    const text = await entry.async("string");
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > this.limits.maxXmlPartBytes) {
      throw new OoxmlResourceLimitError(
        `${path} contains ${bytes} bytes, over the ${this.limits.maxXmlPartBytes}-byte XML part limit`,
      );
    }
    this.totalXmlBytes += bytes;
    if (this.totalXmlBytes > this.limits.maxTotalXmlBytes) {
      throw new OoxmlResourceLimitError(
        `OOXML validation exceeds the ${this.limits.maxTotalXmlBytes}-byte cumulative XML limit`,
      );
    }
    return text;
  }
}

/**
 * Load a zip-internal media part as a data URL, with caching. Unsupported
 * formats (EMF/WMF, …) cache an empty sentinel and return undefined.
 */
export async function loadMediaDataUrl(
  zip: { file(path: string): { async(type: "base64"): Promise<string> } | null },
  cache: Map<string, string>,
  path: string,
): Promise<string | undefined> {
  const cached = cache.get(path);
  if (cached !== undefined) return cached || undefined;

  const ext = path.substring(path.lastIndexOf(".") + 1).toLowerCase();
  const mime = MEDIA_MIME[ext];
  if (!mime) {
    cache.set(path, "");
    return undefined;
  }

  const base64 = await zip.file(path)?.async("base64");
  const dataUrl = base64 ? `data:${mime};base64,${base64}` : "";
  cache.set(path, dataUrl);
  return dataUrl || undefined;
}

// ============================================================================
// Theme (DrawingML a:clrScheme / a:fontScheme — shared by pptx/docx/xlsx)
// ============================================================================

export interface OoxmlTheme {
  /** Theme color slots (dk1, lt1, accent1, …) → hex without '#' */
  colors: Record<string, string>;
  majorFont: string;
  minorFont: string;
}

export function parseThemeDoc(doc: Document | null): OoxmlTheme {
  const theme: OoxmlTheme = { colors: {}, majorFont: "Calibri Light", minorFont: "Calibri" };
  if (!doc) return theme;

  const clrScheme = doc.getElementsByTagName("a:clrScheme")[0];
  if (clrScheme) {
    for (const slot of clrScheme.children) {
      const name = slot.tagName.replace("a:", "");
      const hex = child(slot, "a:srgbClr")?.getAttribute("val") || child(slot, "a:sysClr")?.getAttribute("lastClr");
      if (hex) theme.colors[name] = hex;
    }
  }

  const fontScheme = doc.getElementsByTagName("a:fontScheme")[0];
  const major = child(child(fontScheme, "a:majorFont"), "a:latin")?.getAttribute("typeface");
  const minor = child(child(fontScheme, "a:minorFont"), "a:latin")?.getAttribute("typeface");
  if (major) theme.majorFont = major;
  if (minor) theme.minorFont = minor;
  return theme;
}

// ============================================================================
// Colors & fonts
// ============================================================================

/**
 * Mix a 6-digit hex color toward white (tint) or black (shade).
 * `keep` is the fraction of the original color retained (0..1).
 */
export function mixHex(hex: string, keep: number, towardWhite: boolean): string {
  const c = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  return c
    .map((v) => {
      const n = towardWhite ? v * keep + 255 * (1 - keep) : v * keep;
      return Math.max(0, Math.min(255, Math.round(n)))
        .toString(16)
        .padStart(2, "0");
    })
    .join("")
    .toUpperCase();
}

/**
 * CSS font-family stack for a document-declared typeface. Quotes and
 * backslashes are stripped — the value lands inside single quotes within a
 * double-quoted style attribute, where a stray quote would truncate the rule.
 */
export function cssFontStack(font: string): string {
  const safe = font.replace(/['"\\]/g, "");
  return `'${safe}', 'Segoe UI', system-ui, -apple-system, sans-serif`;
}

// ============================================================================
// List numbering & bullet glyphs
// ============================================================================

export function toAlpha(n: number): string {
  let s = "";
  let v = n;
  while (v > 0) {
    s = String.fromCharCode(((v - 1) % 26) + 97) + s;
    v = Math.floor((v - 1) / 26);
  }
  return s;
}

const ROMAN: [number, string][] = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

export function toRoman(n: number): string {
  let s = "";
  let v = n;
  for (const [val, sym] of ROMAN) {
    while (v >= val) {
      s += sym;
      v -= val;
    }
  }
  return s;
}

/** Wingdings/Symbol/Courier glyph codes → Unicode equivalents. */
const SYMBOL_GLYPHS: Record<number, string> = {
  183: "•",
  161: "○",
  167: "▪",
  216: "➢",
  252: "✓",
  118: "❖",
  108: "●",
  110: "■",
  117: "◆",
  113: "❑",
  111: "○",
  45: "–",
};

/**
 * Map a bullet character from a symbolic font (Wingdings, Symbol, Courier
 * bullets) to a Unicode glyph browsers can render. Codes in the F0xx private
 * use area are normalized first. Non-symbolic fonts pass through unchanged.
 */
export function mapBulletChar(char: string, font: string): string {
  if (!char) return "•";
  let code = char.charCodeAt(0);
  const isPua = code >= 0xf000;
  if (isPua) code -= 0xf000;
  const f = font.toLowerCase();
  if (isPua || f.includes("wingdings") || f.includes("symbol") || f.includes("courier")) {
    // Real Unicode glyphs (≥ U+2000) already render fine; raw symbolic codes
    // fall back to a plain bullet.
    return SYMBOL_GLYPHS[code] ?? (code >= 0x2000 ? String.fromCharCode(code) : "•");
  }
  return String.fromCharCode(code);
}
