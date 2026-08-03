import type JSZip from "jszip";

export interface OoxmlIssue {
  id: string;
  severity: "fail" | "warn";
  message: string;
}

export const fail = (id: string, message: string): OoxmlIssue => ({ id, severity: "fail", message });
export const warn = (id: string, message: string): OoxmlIssue => ({ id, severity: "warn", message });

const XML_ENTITY = /&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi;

export function decodeXml(value: string): string {
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

/** OOXML escapes characters that are illegal in name attributes as `_xHHHH_`. */
export function decodeEscapedName(value: string): string {
  return value.replace(/_x([\da-f]{4})_/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

export function attributes(tag: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of tag.matchAll(/([\w.-]+(?::[\w.-]+)?)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    result.set(match[1], decodeXml(match[2] ?? match[3] ?? ""));
  }
  return result;
}

export function localAttribute(attrs: Map<string, string>, name: string): string | undefined {
  for (const [key, value] of attrs) {
    if (key === name || key.endsWith(`:${name}`)) return value;
  }
  return undefined;
}

export function openingTags(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>`, "gi"))].map((match) => match[0]);
}

export function elementBlocks(xml: string, name: string): string[] {
  return [
    ...xml.matchAll(
      new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>[\\s\\S]*?<\\/(?:(?:[\\w.-]+):)?${name}\\s*>`, "gi"),
    ),
  ].map((match) => match[0]);
}

export function firstTagText(xml: string, name: string): string | undefined {
  const match = xml.match(
    new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}\\s*>`, "i"),
  );
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, "")) : undefined;
}

export function resolvePackagePath(sourcePart: string, target: string): string {
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

export function relationshipPath(partPath: string): string {
  const slash = partPath.lastIndexOf("/");
  return `${partPath.slice(0, slash)}/_rels/${partPath.slice(slash + 1)}.rels`;
}

export interface Relationship {
  id: string;
  type: string;
  target: string;
  external: boolean;
  path: string;
}

export async function readRelationships(zip: JSZip, partPath: string): Promise<Relationship[]> {
  const xml = await zip.file(relationshipPath(partPath))?.async("string");
  if (!xml) return [];
  const relationships: Relationship[] = [];
  for (const tag of openingTags(xml, "Relationship")) {
    const attrs = attributes(tag);
    const id = attrs.get("Id");
    const target = attrs.get("Target");
    if (!id || !target) continue;
    const external = attrs.get("TargetMode") === "External";
    relationships.push({
      id,
      target,
      type: attrs.get("Type") ?? "",
      external,
      path: external ? "" : resolvePackagePath(partPath, target),
    });
  }
  return relationships;
}
