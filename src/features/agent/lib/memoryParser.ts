/**
 * Memory document parsing — YAML frontmatter + markdown body for one
 * concept file in an agent's memory bundle (see opfs-memory.ts).
 *
 * Field set and consumption rules follow the Open Knowledge Format spec
 * (OKF v0.1): only `type` is required, unknown frontmatter keys round-trip
 * through `extra`, and a missing `title` falls back to the filename.
 */

export interface MemoryFrontmatter {
  type: string;
  title: string;
  description?: string;
  resource?: string;
  tags?: string[];
  timestamp: string;
  /** Producer-defined frontmatter keys outside the known OKF fields, preserved verbatim. */
  extra?: Record<string, string>;
}

export interface MemoryDoc {
  frontmatter: MemoryFrontmatter;
  body: string;
}

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;
const KNOWN_KEYS = new Set(["type", "title", "description", "resource", "tags", "timestamp"]);

function parseRawFrontmatter(content: string): { fields: Record<string, string>; body: string } | null {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) return null;

  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex <= 0) continue;
    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }

  return { fields, body: match[2].trim() };
}

function parseTagList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const bracketMatch = raw.match(/^\[(.*)\]$/);
  const items = (bracketMatch ? bracketMatch[1] : raw)
    .split(",")
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
  return items.length ? items : undefined;
}

/** Title-case a `*.md` filename into a display title, e.g. "project-context.md" -> "Project Context". */
export function deriveTitleFromPath(path: string): string {
  const base = path.replace(/\.md$/, "").split("/").pop() || path;
  return base
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Parse a memory concept file's frontmatter + body. Returns null if
 * unparseable or missing the only OKF-required field, `type`. `title` is
 * recommended, not required — falls back to `fallbackTitle` (typically
 * derived from the filename) when absent, per OKF §4.1.
 */
export function parseMemoryDoc(content: string, fallbackTitle?: string): MemoryDoc | null {
  const parsed = parseRawFrontmatter(content);
  if (!parsed) return null;

  const { fields, body } = parsed;
  if (!fields.type) return null;

  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!KNOWN_KEYS.has(key)) extra[key] = value;
  }

  return {
    frontmatter: {
      type: fields.type,
      title: fields.title || fallbackTitle || "Untitled",
      description: fields.description || undefined,
      resource: fields.resource || undefined,
      tags: parseTagList(fields.tags),
      timestamp: fields.timestamp || new Date(0).toISOString(),
      extra: Object.keys(extra).length ? extra : undefined,
    },
    body,
  };
}

/** Serialize a memory concept doc back to frontmatter + markdown body. */
export function serializeMemoryDoc(doc: MemoryDoc): string {
  const fm = doc.frontmatter;
  const lines = ["---", `type: ${fm.type}`, `title: ${fm.title}`];
  if (fm.description) lines.push(`description: ${fm.description}`);
  if (fm.resource) lines.push(`resource: ${fm.resource}`);
  if (fm.tags?.length) lines.push(`tags: [${fm.tags.join(", ")}]`);
  lines.push(`timestamp: ${fm.timestamp}`);
  if (fm.extra) {
    for (const [key, value] of Object.entries(fm.extra)) {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---", "", doc.body);

  return lines.join("\n");
}

const SLUG_FALLBACK = "memory";

/** Turn a free-text title into a safe `*.md` filename for the bundle. */
export function slugifyMemoryPath(title: string): string {
  const slug =
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || SLUG_FALLBACK;

  return slug === "index" || slug === "log" ? `${slug}-notes` : slug;
}
