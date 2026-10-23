import { parseAgentMd } from "@/features/agent/lib/agentMarkdown";
import { parseSkillFile } from "@/features/skills/lib/skillParser";
import { type IndexEntry, listDirectories, listFiles, readJson, readText, writeJson } from "./opfs-core";
import { withPersistenceLock } from "./persistence";

export const STORAGE_COLLECTIONS = ["agents", "chats", "images", "skills"] as const;

/** Collections whose listing can be derived from their folders. */
const REBUILDABLE_COLLECTIONS: readonly string[] = [...STORAGE_COLLECTIONS, "plugins"];

export function isRebuildableCollection(collection: string): boolean {
  return REBUILDABLE_COLLECTIONS.includes(collection);
}

/**
 * One record with unreadable JSON must not block repairing every other record
 * (and with it every restore, which rebuilds indexes last). Storage read
 * errors still fail the rebuild so a partial listing never replaces a full one.
 */
async function readRecord<T>(path: string): Promise<{ ok: true; value: T | undefined } | { ok: false }> {
  try {
    return { ok: true, value: await readJson<T>(path) };
  } catch (error) {
    if (error instanceof Error && error.cause instanceof SyntaxError) {
      console.warn(`Skipping record with invalid JSON while rebuilding index: ${path}`);
      return { ok: false };
    }
    throw error;
  }
}

/** One index scanner for repair and restore. It never deletes stored data. */
export async function rebuildFolderIndex(collection: string): Promise<IndexEntry[]> {
  return withPersistenceLock(`collection:${collection}`, () => rebuildFolderIndexUnlocked(collection));
}

/** Caller owns the collection lock. Index reads and replacement share a lock. */
export async function rebuildFolderIndexUnlocked(
  collection: string,
  importedHints: IndexEntry[] = [],
): Promise<IndexEntry[]> {
  if (!(STORAGE_COLLECTIONS as readonly string[]).includes(collection)) return [];
  return withPersistenceLock(`index:${collection}`, async () => {
    // Explicit repair may replace a corrupt index, but never trusts it as the
    // source of membership. Preserve valid identity/timestamps where possible.
    const previous = await salvageIndexEntries(collection);
    for (const hint of importedHints) {
      if (!previous.some((entry) => entry.id === hint.id)) previous.push(hint);
    }
    const result = await scanFolderIndex(collection, previous);
    await writeJson(`${collection}/index.json`, result);
    return result;
  });
}

/** Valid entries of a possibly damaged index, for their identities and timestamps. */
export async function salvageIndexEntries(collection: string): Promise<IndexEntry[]> {
  try {
    const value = await readJson<unknown>(`${collection}/index.json`);
    if (Array.isArray(value))
      return value.filter((entry): entry is IndexEntry => entry && typeof entry.id === "string" && !!entry.id);
  } catch {
    /* The index itself is what the caller repairs. */
  }
  return [];
}

/**
 * Derive a collection listing from its folders. No lock, no write: the caller
 * decides whether the result replaces the stored index.
 */
export async function scanFolderIndex(collection: string, previous: IndexEntry[] = []): Promise<IndexEntry[]> {
  if (!isRebuildableCollection(collection)) return [];
  {
    const entries = new Map<string, IndexEntry>();
    const epoch = new Date(0).toISOString();
    for (const id of await listDirectories(collection)) {
      const path = `${collection}/${id}`;
      const prior = previous.find((entry) => (collection === "skills" ? entry.title === id : entry.id === id));
      if (collection === "agents") {
        const md = (await readText(`${path}/AGENTS.md`)) ?? (await readText(`${path}/AGENT.md`));
        let meta: { name?: string } | null | undefined;
        if (md !== undefined) meta = parseAgentMd(md);
        else {
          const record = await readRecord<{ name?: string }>(`${path}/agent.json`);
          if (!record.ok) {
            if (prior) entries.set(id, prior);
            continue;
          }
          meta = record.value;
        }
        if (!meta) continue;
        entries.set(id, { id, title: meta.name, updated: prior?.updated ?? epoch });
      } else if (collection === "skills") {
        const md = await readText(`${path}/SKILL.md`);
        if (!md || !parseSkillFile(md).success) continue;
        const skillId = prior?.id ?? id;
        entries.set(skillId, { id: skillId, title: id, updated: prior?.updated ?? epoch });
      } else if (collection === "plugins") {
        const record = await readRecord<{ title?: string; installedAt?: string }>(`${path}/plugin.json`);
        if (!record.ok) {
          if (prior) entries.set(id, prior);
          continue;
        }
        if (!record.value) continue;
        entries.set(id, {
          id,
          title: record.value.title || id,
          updated: prior?.updated ?? record.value.installedAt ?? epoch,
        });
      } else {
        const record = await readRecord<Partial<IndexEntry>>(
          `${path}/${collection === "chats" ? "chat.json" : "metadata.json"}`,
        );
        // The folder exists, so keep the previous listing for a damaged record
        // rather than making it vanish from the sidebar.
        if (!record.ok) {
          if (prior) entries.set(id, prior);
          continue;
        }
        const meta = record.value;
        if (!meta) continue;
        entries.set(id, {
          id,
          title: meta.title,
          customTitle: meta.customTitle,
          customIndex: meta.customIndex,
          created: meta.created,
          updated: meta.updated || meta.created || prior?.updated || epoch,
        });
      }
    }
    // Reading old flat chat backups remains cheap compatibility, with no writes
    // or migrations during ordinary loading.
    if (collection === "chats") {
      for (const name of await listFiles(collection)) {
        if (name === "index.json" || !name.endsWith(".json")) continue;
        const id = name.slice(0, -5);
        if (entries.has(id)) continue;
        const record = await readRecord<Partial<IndexEntry> & { messages?: unknown[] }>(`${collection}/${name}`);
        if (!record.ok) continue;
        const meta = record.value;
        if (!Array.isArray(meta?.messages)) continue;
        entries.set(id, {
          id,
          title: meta.title,
          customTitle: meta.customTitle,
          customIndex: meta.customIndex,
          created: meta.created,
          updated: meta.updated || meta.created || epoch,
        });
      }
    }
    return [...entries.values()];
  }
}
