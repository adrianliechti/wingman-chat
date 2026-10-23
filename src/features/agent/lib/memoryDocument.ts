import { parse, stringify } from "yaml";
import { normalizeArtifactPath } from "@/shared/lib/sandbox";

export const MEMORY_ROOT = "/.memory";
export const MEMORY_NOTE_MAX_BYTES = 8 * 1024;
export const MEMORY_BUNDLE_MAX_BYTES = 1024 * 1024;
export const MEMORY_MAX_NOTES = 256;
export const bytes = (text: string) => new TextEncoder().encode(text).length;

export interface MemoryDocument {
  metadata: Record<string, unknown>;
  body: string;
}

export function isMemoryPath(path: unknown): boolean {
  const normalized = typeof path === "string" ? normalizeArtifactPath(path) : undefined;
  return normalized === MEMORY_ROOT || !!normalized?.startsWith(`${MEMORY_ROOT}/`);
}

export function memoryPath(path: string): string {
  const normalized = normalizeArtifactPath(path);
  if (!normalized || !isMemoryPath(normalized)) throw new Error("Use a path under /.memory/.");
  const relative = normalized.slice(MEMORY_ROOT.length + 1);
  if (
    relative.length > 240 ||
    relative.split("").some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    relative.split("/").some((part) => part.startsWith("."))
  )
    throw new Error("Invalid memory path.");
  return relative;
}

export function isMemoryIndex(path: string): boolean {
  return /(?:^|\/)(?:index|log)\.md$/.test(path);
}

export function parseMemoryDocument(content: string): MemoryDocument {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return { metadata: { type: "Reference" }, body: normalized.trim() };
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  if (!match) throw new Error("Memory frontmatter needs a closing --- line.");
  const metadata: unknown = parse(match[1], { maxAliasCount: 0, uniqueKeys: true, logLevel: "error" });
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    throw new Error("Memory frontmatter must be a YAML mapping.");
  const fields = metadata as Record<string, unknown>;
  if (typeof fields.type !== "string" || !fields.type.trim()) throw new Error("Memory requires a type.");
  for (const field of ["title", "description", "scope", "status", "stale_after"]) {
    if (fields[field] !== undefined && typeof fields[field] !== "string")
      throw new Error(`Memory ${field} must be text.`);
  }
  if (
    fields.stale_after &&
    (!/T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(fields.stale_after as string) ||
      !Number.isFinite(Date.parse(fields.stale_after as string)))
  )
    throw new Error("Memory stale_after must be an ISO date/time.");
  if (fields.tags !== undefined && (!Array.isArray(fields.tags) || fields.tags.some((tag) => typeof tag !== "string")))
    throw new Error("Memory tags must be a list of strings.");
  if (fields.core !== undefined && typeof fields.core !== "boolean")
    throw new Error("Memory core must be true or false.");
  if (
    fields.sources !== undefined &&
    (!Array.isArray(fields.sources) ||
      fields.sources.some((s) => !s || typeof s !== "object" || typeof s.resource !== "string"))
  )
    throw new Error("Each memory source needs a resource.");
  return { metadata: fields, body: match[2].trim() };
}

export function serializeMemoryDocument(doc: MemoryDocument): string {
  return `---\n${stringify(doc.metadata, { lineWidth: 0 })}---\n\n${doc.body.trim()}\n`;
}

export function memoryTitle(path: string, doc: MemoryDocument): string {
  return typeof doc.metadata.title === "string" ? doc.metadata.title : path.replace(/\.md$/, "").split("/").at(-1)!;
}

/** UTF-8 bound including the suffix; never split a Unicode code point. */
export function boundMemoryText(text: string, limit: number, suffix = "\n…"): string {
  if (bytes(text) <= limit) return text;
  if (bytes(suffix) > limit) return "";
  let result = "";
  let used = bytes(suffix);
  for (const char of text) {
    const size = bytes(char);
    if (used + size > limit) break;
    result += char;
    used += size;
  }
  return result + suffix;
}

export async function memoryRevision(content: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function memoryIndexes(files: ReadonlyMap<string, string>): Map<string, string> {
  const directories = new Set([""]);
  for (const path of files.keys()) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join("/") + "/");
  }
  const clean = (text: string) => text.replace(/[\r\n]+/g, " ").replace(/[[\]\\]/g, "\\$&");
  return new Map(
    [...directories].map((dir) => {
      const lines = [...files]
        .filter(([path]) => path.startsWith(dir) && !isMemoryIndex(path))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, content]) => {
          const doc = parseMemoryDocument(content);
          const description =
            typeof doc.metadata.description === "string"
              ? doc.metadata.description
              : typeof doc.metadata.type === "string"
                ? doc.metadata.type
                : "";
          return `- [${clean(boundMemoryText(memoryTitle(path, doc), 160))}](${path.slice(dir.length).split("/").map(encodeURIComponent).join("/")}) — ${clean(boundMemoryText(description, 240))}`;
        });
      return [
        `${dir}index.md`,
        `${dir ? "" : '---\nokf_version: "0.2"\n---\n\n'}# Memory\n\n${lines.join("\n") || "No memories yet."}\n`,
      ];
    }),
  );
}
