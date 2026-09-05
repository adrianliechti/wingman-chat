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

/** Files in the bundle that are generated, never concept docs. */
export const RESERVED_MEMORY_FILES = new Set(["index.md", "log.md"]);
const MAX_MEMORY_PATH_LENGTH = 120;

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "string") return parsed;
    } catch {
      // fall through to a plain strip
    }
    return value.slice(1, -1);
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

function parseRawFrontmatter(content: string): { fields: Record<string, string>; body: string } | null {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) return null;

  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex <= 0) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = unquote(line.slice(colonIndex + 1).trim());
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

/**
 * Render one scalar frontmatter value on a single line. Newlines are collapsed
 * (a multi-line value would terminate the frontmatter block early), and values
 * that YAML would otherwise misread — leading indicators, `: ` / ` #` sequences,
 * surrounding whitespace, empty strings — are JSON-quoted, which `parseMemoryDoc`
 * unquotes symmetrically.
 */
function formatYamlValue(value: string): string {
  const flat = value.replace(/\s*\r?\n\s*/g, " ").trim();
  const needsQuotes = flat === "" || /^[\s"'[\]{}#&*!|>%@`,?:-]/.test(flat) || /:\s|\s#/.test(flat);
  return needsQuotes ? JSON.stringify(flat) : flat;
}

/** Tags live inside `[a, b]`, so strip the characters that would break that list. */
function formatTag(tag: string): string {
  return tag
    .replace(/[[\],"'\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Serialize a memory concept doc back to frontmatter + markdown body. */
export function serializeMemoryDoc(doc: MemoryDoc): string {
  const fm = doc.frontmatter;
  const lines = ["---", `type: ${formatYamlValue(fm.type)}`, `title: ${formatYamlValue(fm.title)}`];
  if (fm.description) lines.push(`description: ${formatYamlValue(fm.description)}`);
  if (fm.resource) lines.push(`resource: ${formatYamlValue(fm.resource)}`);
  const tags = fm.tags?.map(formatTag).filter(Boolean);
  if (tags?.length) lines.push(`tags: [${tags.join(", ")}]`);
  lines.push(`timestamp: ${fm.timestamp}`);
  if (fm.extra) {
    for (const [key, value] of Object.entries(fm.extra)) {
      if (KNOWN_KEYS.has(key) || !/^[A-Za-z0-9_-]+$/.test(key)) continue;
      lines.push(`${key}: ${formatYamlValue(value)}`);
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

/**
 * Is `path` a plain file name that stays inside the bundle directory? Rejects
 * anything with separators, traversal, hidden-file prefixes, or a reserved
 * (generated) file name. Lenient about casing so files imported from elsewhere
 * remain readable; use {@link getMemoryPathError} for the strict rules applied
 * to model-authored paths.
 */
export function isSafeMemoryPath(path: unknown): path is string {
  if (typeof path !== "string" || !path || path.length > MAX_MEMORY_PATH_LENGTH) return false;
  if (RESERVED_MEMORY_FILES.has(path)) return false;
  if (!path.endsWith(".md")) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(path);
}

/**
 * Strict validation for paths chosen by the model: lowercase, hyphen-separated
 * slug ending in `.md`, not a reserved file. Returns a model-facing error
 * message, or null when the path is acceptable.
 */
export function getMemoryPathError(path: unknown): string | null {
  if (typeof path !== "string" || !path) return "path is required";
  if (path.length > MAX_MEMORY_PATH_LENGTH) return `path must be at most ${MAX_MEMORY_PATH_LENGTH} characters`;
  if (RESERVED_MEMORY_FILES.has(path)) return `"${path}" is a generated file and cannot be used as an entry path`;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(path)) {
    return 'path must be a lowercase, hyphenated "*.md" filename, e.g. "project-context.md"';
  }
  return null;
}
