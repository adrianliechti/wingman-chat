/**
 * OPFS Memory — Agent memory bundle CRUD.
 *
 * Each agent's memory is an Open Knowledge Format (OKF v0.1) bundle under
 * /agents/{agentId}/memory/: concept docs (frontmatter + markdown body),
 * a generated index.md (compact table of contents, safe to inject into
 * every prompt), and a log.md change history grouped by date per OKF §7.
 * Mirrors the conventions used by the skills bundle (SKILL.md + index.json)
 * — see opfs-skills.ts.
 */

import {
  deriveTitleFromPath,
  type MemoryDoc,
  type MemoryFrontmatter,
  parseMemoryDoc,
  serializeMemoryDoc,
  slugifyMemoryPath,
} from "@/features/agent/lib/memoryParser";
import { deleteFile, fileExists, listFiles, readFileMetadata, readText, writeText } from "./opfs-core";

export type { MemoryDoc, MemoryFrontmatter } from "@/features/agent/lib/memoryParser";

export interface MemoryEntry extends MemoryFrontmatter {
  /** Filename within the bundle, e.g. "project-context.md". */
  path: string;
}

const RESERVED_FILES = new Set(["index.md", "log.md"]);
const OKF_VERSION = "0.1";

function bundleDir(agentId: string): string {
  return `agents/${agentId}/memory`;
}

function legacyMemoryPath(agentId: string): string {
  return `agents/${agentId}/MEMORY.md`;
}

/** List every concept doc in an agent's memory bundle (frontmatter only, no bodies). */
export async function listMemoryEntries(agentId: string): Promise<MemoryEntry[]> {
  const dir = bundleDir(agentId);
  const files = await listFiles(dir);
  const entries: MemoryEntry[] = [];

  for (const file of files) {
    if (RESERVED_FILES.has(file) || !file.endsWith(".md")) continue;
    const content = await readText(`${dir}/${file}`);
    if (!content) continue;
    const doc = parseMemoryDoc(content, deriveTitleFromPath(file));
    if (!doc) continue;
    entries.push({ path: file, ...doc.frontmatter });
  }

  return entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/** Read one memory concept doc (frontmatter + body). */
export async function readMemoryDoc(agentId: string, path: string): Promise<MemoryDoc | undefined> {
  const content = await readText(`${bundleDir(agentId)}/${path}`);
  if (!content) return undefined;
  return parseMemoryDoc(content, deriveTitleFromPath(path)) ?? undefined;
}

/** Read the compact, always-safe-to-inject index.md (table of contents). */
export async function readMemoryIndex(agentId: string): Promise<string> {
  return (await readText(`${bundleDir(agentId)}/index.md`)) || "";
}

/**
 * Create or update one memory concept doc. `resource` and any unrecognized
 * frontmatter keys (`extra`) carry forward from the existing doc when the
 * caller doesn't explicitly set them, so partial updates don't clobber
 * fields written by another producer (OKF §4.1: consumers SHOULD preserve
 * unknown keys when round-tripping). Refreshes index.md and appends to log.md.
 */
export async function writeMemoryDoc(
  agentId: string,
  path: string,
  frontmatter: Omit<MemoryFrontmatter, "timestamp">,
  body: string,
): Promise<MemoryEntry> {
  const dir = bundleDir(agentId);
  const filePath = `${dir}/${path}`;
  const existing = await readMemoryDoc(agentId, path);
  const timestamp = new Date().toISOString();

  const merged: MemoryFrontmatter = {
    ...frontmatter,
    resource: frontmatter.resource ?? existing?.frontmatter.resource,
    extra: frontmatter.extra ?? existing?.frontmatter.extra,
    timestamp,
  };

  await writeText(filePath, serializeMemoryDoc({ frontmatter: merged, body }));
  const entries = await rebuildMemoryIndex(agentId);
  await appendMemoryLog(agentId, existing ? "Updated" : "Created", `[${frontmatter.title}](${path})`);

  const entry = entries.find((e) => e.path === path);
  if (!entry) throw new Error(`Failed to write memory entry at ${path}`);
  return entry;
}

/** Delete one memory concept doc. Refreshes index.md and appends to log.md. */
export async function deleteMemoryDoc(agentId: string, path: string): Promise<void> {
  const existing = await readMemoryDoc(agentId, path);
  await deleteFile(`${bundleDir(agentId)}/${path}`);
  await rebuildMemoryIndex(agentId);
  if (existing) {
    await appendMemoryLog(agentId, "Deleted", `${existing.frontmatter.title} (\`${path}\`)`);
  }
}

/** Regenerate index.md as an OKF §6-shaped listing: optional version frontmatter, one heading, one bullet per concept. */
async function rebuildMemoryIndex(agentId: string): Promise<MemoryEntry[]> {
  const entries = await listMemoryEntries(agentId);
  const lines = entries.map((e) => `* [${e.title}](${e.path}) - ${e.description || e.type}`);
  const body = lines.length ? lines.join("\n") : "_No memories yet._";
  const content = `---\nokf_version: "${OKF_VERSION}"\n---\n\n# Memory\n\n${body}\n`;
  await writeText(`${bundleDir(agentId)}/index.md`, content);
  return entries;
}

/** Parse log.md's `## YYYY-MM-DD` date sections (OKF §7) into ordered groups, newest first. */
function parseLogGroups(content: string): { date: string; lines: string[] }[] {
  const headingRegex = /^## (\d{4}-\d{2}-\d{2})\s*$/gm;
  const matches = [...content.matchAll(headingRegex)];

  return matches.map((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? content.length) : content.length;
    const lines = content
      .slice(start, end)
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("*"));
    return { date: m[1], lines };
  });
}

function serializeLogGroups(groups: { date: string; lines: string[] }[]): string {
  const sections = groups.filter((g) => g.lines.length > 0).map((g) => `## ${g.date}\n${g.lines.join("\n")}`);
  return `# Directory Update Log\n\n${sections.join("\n\n")}\n`;
}

/** Append one entry to log.md under today's date heading (newest section first), per OKF §7. */
async function appendMemoryLog(agentId: string, action: string, message: string): Promise<void> {
  const logPath = `${bundleDir(agentId)}/log.md`;
  const existingContent = await readText(logPath);
  const groups = existingContent ? parseLogGroups(existingContent) : [];

  const today = new Date().toISOString().slice(0, 10);
  const entryLine = `* **${action}**: ${message}`;

  if (groups[0]?.date === today) {
    groups[0].lines.unshift(entryLine);
  } else {
    groups.unshift({ date: today, lines: [entryLine] });
  }

  await writeText(logPath, serializeLogGroups(groups));
}

/**
 * One-time migration from the old single-file `MEMORY.md` (organized by
 * `## Section` headers) into the bundle format. No-op once the bundle
 * already has an index.md, or if there's nothing to migrate.
 */
export async function ensureMemoryMigrated(agentId: string): Promise<void> {
  const dir = bundleDir(agentId);
  if (await fileExists(`${dir}/index.md`)) return;

  const legacyPath = legacyMemoryPath(agentId);
  const legacy = await readText(legacyPath);
  if (!legacy?.trim()) {
    await rebuildMemoryIndex(agentId);
    return;
  }

  const meta = await readFileMetadata(legacyPath);
  const timestamp = meta?.lastModified ? new Date(meta.lastModified).toISOString() : new Date().toISOString();

  const sections: { title: string; body: string }[] = [];
  const headerRegex = /^##\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  let lastTitle: string | null = null;

  while ((match = headerRegex.exec(legacy))) {
    if (lastTitle !== null) {
      sections.push({ title: lastTitle, body: legacy.slice(lastIndex, match.index).trim() });
    } else if (legacy.slice(0, match.index).trim()) {
      sections.push({ title: "General", body: legacy.slice(0, match.index).trim() });
    }
    lastTitle = match[1].trim();
    lastIndex = headerRegex.lastIndex;
  }
  sections.push(
    lastTitle !== null
      ? { title: lastTitle, body: legacy.slice(lastIndex).trim() }
      : { title: "General", body: legacy.trim() },
  );

  const usedPaths = new Set<string>();
  let migratedCount = 0;
  for (const section of sections) {
    if (!section.body) continue;
    const slug = slugifyMemoryPath(section.title);
    let path = `${slug}.md`;
    let suffix = 2;
    while (usedPaths.has(path)) path = `${slug}-${suffix++}.md`;
    usedPaths.add(path);

    await writeText(
      `${dir}/${path}`,
      serializeMemoryDoc({ frontmatter: { type: section.title, title: section.title, timestamp }, body: section.body }),
    );
    migratedCount++;
  }

  await deleteFile(legacyPath);
  await rebuildMemoryIndex(agentId);
  await appendMemoryLog(
    agentId,
    "Migration",
    `Migrated from single-file MEMORY.md (${migratedCount} entr${migratedCount === 1 ? "y" : "ies"})`,
  );
}
