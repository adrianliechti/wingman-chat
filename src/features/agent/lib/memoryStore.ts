/**
 * Memory bundle store — the filesystem-agnostic core behind opfs-memory.ts.
 *
 * A bundle is an Open Knowledge Format (OKF v0.1) directory: concept docs
 * (frontmatter + markdown body), a generated index.md (compact table of
 * contents, safe to inject into every prompt), and a log.md change history
 * grouped by date per OKF §7. Everything here runs against the small
 * {@link MemoryFileSystem} surface so it can be exercised in tests with an
 * in-memory map and in the app with OPFS.
 */

import {
  deriveTitleFromPath,
  isSafeMemoryPath,
  type MemoryDoc,
  type MemoryFrontmatter,
  parseMemoryDoc,
  RESERVED_MEMORY_FILES,
  serializeMemoryDoc,
  slugifyMemoryPath,
} from "./memoryParser";

export interface MemoryEntry extends MemoryFrontmatter {
  /** Filename within the bundle, e.g. "project-context.md". */
  path: string;
}

/** The subset of a file API the store needs. Paths are POSIX-style, relative to the storage root. */
export interface MemoryFileSystem {
  readText(path: string): Promise<string | undefined>;
  writeText(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  /** File names (not paths) directly inside `dir`; `[]` when it doesn't exist. */
  listFiles(dir: string): Promise<string[]>;
  fileExists(path: string): Promise<boolean>;
  readFileMetadata(path: string): Promise<{ lastModified?: number } | undefined>;
}

export interface MemoryStoreOptions {
  /** Bundle directory, e.g. "agents/{id}/memory". */
  dir: string;
  /** Pre-bundle single-file memory to migrate from, if any. */
  legacyPath?: string;
  /** Clock override for deterministic tests. */
  now?: () => Date;
}

export interface MemoryStore {
  list(): Promise<MemoryEntry[]>;
  read(path: string): Promise<MemoryDoc | undefined>;
  /** Every concept doc with its body — used by search. */
  readAll(): Promise<{ path: string; doc: MemoryDoc }[]>;
  readIndex(): Promise<string>;
  write(path: string, frontmatter: Omit<MemoryFrontmatter, "timestamp">, body: string): Promise<MemoryEntry>;
  delete(path: string): Promise<boolean>;
  ensureMigrated(): Promise<void>;
}

const OKF_VERSION = "0.1";
/** Keep log.md bounded: newest entries first, older ones fall off. */
export const MEMORY_LOG_MAX_ENTRIES = 200;

export class MemoryPathError extends Error {}

interface LogGroup {
  date: string;
  lines: string[];
}

export function createMemoryStore(fs: MemoryFileSystem, options: MemoryStoreOptions): MemoryStore {
  const { dir, legacyPath } = options;
  const now = options.now ?? (() => new Date());
  const filePath = (name: string) => `${dir}/${name}`;

  // Serialize mutations so concurrent tool calls can't interleave index/log rewrites.
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  const assertPath = (path: unknown) => {
    if (!isSafeMemoryPath(path)) throw new MemoryPathError(`Invalid memory path: ${String(path)}`);
  };

  async function list(): Promise<MemoryEntry[]> {
    const files = await fs.listFiles(dir);
    const entries: MemoryEntry[] = [];

    for (const file of files) {
      if (RESERVED_MEMORY_FILES.has(file) || !file.endsWith(".md")) continue;
      const content = await fs.readText(filePath(file));
      if (!content) continue;
      const doc = parseMemoryDoc(content, deriveTitleFromPath(file));
      if (!doc) continue;
      entries.push({ path: file, ...doc.frontmatter });
    }

    return entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp) || a.path.localeCompare(b.path));
  }

  async function read(path: string): Promise<MemoryDoc | undefined> {
    if (!isSafeMemoryPath(path)) return undefined;
    const content = await fs.readText(filePath(path));
    if (!content) return undefined;
    return parseMemoryDoc(content, deriveTitleFromPath(path)) ?? undefined;
  }

  async function readAll(): Promise<{ path: string; doc: MemoryDoc }[]> {
    const files = await fs.listFiles(dir);
    const docs: { path: string; doc: MemoryDoc }[] = [];
    for (const file of files) {
      if (RESERVED_MEMORY_FILES.has(file)) continue;
      const doc = await read(file);
      if (doc) docs.push({ path: file, doc });
    }
    return docs;
  }

  async function readIndex(): Promise<string> {
    return (await fs.readText(filePath("index.md"))) || "";
  }

  async function rebuildIndex(): Promise<MemoryEntry[]> {
    const entries = await list();
    const lines = entries.map((e) => {
      const tags = e.tags?.length ? ` [${e.tags.join(", ")}]` : "";
      return `* [${e.title}](${e.path}) - ${e.description || e.type}${tags}`;
    });
    const body = lines.length ? lines.join("\n") : "_No memories yet._";
    const content = `---\nokf_version: "${OKF_VERSION}"\n---\n\n# Memory\n\n${body}\n`;
    await fs.writeText(filePath("index.md"), content);
    return entries;
  }

  async function appendLog(action: string, message: string): Promise<void> {
    const logPath = filePath("log.md");
    const existing = await fs.readText(logPath);
    const groups = existing ? parseLogGroups(existing) : [];

    const today = now().toISOString().slice(0, 10);
    const entryLine = `* **${action}**: ${message}`;

    if (groups[0]?.date === today) {
      groups[0].lines.unshift(entryLine);
    } else {
      groups.unshift({ date: today, lines: [entryLine] });
    }

    await fs.writeText(logPath, serializeLogGroups(pruneLogGroups(groups, MEMORY_LOG_MAX_ENTRIES)));
  }

  async function write(
    path: string,
    frontmatter: Omit<MemoryFrontmatter, "timestamp">,
    body: string,
  ): Promise<MemoryEntry> {
    assertPath(path);
    return serialized(async () => {
      const existing = await read(path);
      const timestamp = now().toISOString();

      // Carry forward `resource` and unknown keys so partial updates don't clobber
      // fields written by another producer (OKF §4.1).
      const merged: MemoryFrontmatter = {
        ...frontmatter,
        resource: frontmatter.resource ?? existing?.frontmatter.resource,
        extra: frontmatter.extra ?? existing?.frontmatter.extra,
        timestamp,
      };

      await fs.writeText(filePath(path), serializeMemoryDoc({ frontmatter: merged, body }));
      const entries = await rebuildIndex();
      await appendLog(existing ? "Updated" : "Created", `[${merged.title}](${path})`);

      const entry = entries.find((e) => e.path === path);
      if (!entry) throw new Error(`Failed to write memory entry at ${path}`);
      return entry;
    });
  }

  async function remove(path: string): Promise<boolean> {
    assertPath(path);
    return serialized(async () => {
      const existing = await read(path);
      if (!existing) return false;
      await fs.deleteFile(filePath(path));
      await rebuildIndex();
      await appendLog("Deleted", `${existing.frontmatter.title} (\`${path}\`)`);
      return true;
    });
  }

  /**
   * One-time migration from the old single-file memory (organized by
   * `## Section` headers) into the bundle format. No-op once the bundle
   * already has an index.md.
   */
  function ensureMigrated(): Promise<void> {
    return serialized(async () => {
      if (await fs.fileExists(filePath("index.md"))) return;

      const legacy = legacyPath ? await fs.readText(legacyPath) : undefined;
      if (!legacyPath || !legacy?.trim()) {
        await rebuildIndex();
        return;
      }

      const meta = await fs.readFileMetadata(legacyPath);
      const timestamp = (meta?.lastModified ? new Date(meta.lastModified) : now()).toISOString();

      const usedPaths = new Set<string>();
      let migratedCount = 0;
      for (const section of splitLegacySections(legacy)) {
        const slug = slugifyMemoryPath(section.title);
        let path = `${slug}.md`;
        let suffix = 2;
        while (usedPaths.has(path)) path = `${slug}-${suffix++}.md`;
        usedPaths.add(path);

        await fs.writeText(
          filePath(path),
          serializeMemoryDoc({
            frontmatter: { type: section.title, title: section.title, timestamp },
            body: section.body,
          }),
        );
        migratedCount++;
      }

      await fs.deleteFile(legacyPath);
      await rebuildIndex();
      await appendLog(
        "Migration",
        `Migrated from single-file MEMORY.md (${migratedCount} entr${migratedCount === 1 ? "y" : "ies"})`,
      );
    });
  }

  return { list, read, readAll, readIndex, write, delete: remove, ensureMigrated };
}

/** Split a legacy `## Section` markdown file into titled, non-empty sections. */
export function splitLegacySections(legacy: string): { title: string; body: string }[] {
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

  return sections.filter((s) => s.body);
}

/** Parse log.md's `## YYYY-MM-DD` date sections (OKF §7) into ordered groups, newest first. */
export function parseLogGroups(content: string): LogGroup[] {
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

export function serializeLogGroups(groups: LogGroup[]): string {
  const sections = groups.filter((g) => g.lines.length > 0).map((g) => `## ${g.date}\n${g.lines.join("\n")}`);
  return `# Directory Update Log\n\n${sections.join("\n\n")}\n`;
}

/** Keep only the newest `max` log lines across groups (groups are newest-first). */
export function pruneLogGroups(groups: LogGroup[], max: number): LogGroup[] {
  let remaining = max;
  const pruned: LogGroup[] = [];
  for (const group of groups) {
    if (remaining <= 0) break;
    const lines = group.lines.slice(0, remaining);
    remaining -= lines.length;
    if (lines.length) pruned.push({ date: group.date, lines });
  }
  return pruned;
}
