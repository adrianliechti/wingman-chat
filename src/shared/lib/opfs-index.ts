import { parseAgentMd } from "@/features/agent/lib/agentMarkdown";
import { parseSkillFile } from "@/features/skills/lib/skillParser";
import { type IndexEntry, listDirectories, listFiles, readJson, readText, writeJson } from "./opfs-core";
import { withPersistenceLock } from "./persistence";

export const STORAGE_COLLECTIONS = ["agents", "chats", "images", "skills"] as const;

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
    let previous: IndexEntry[] = [];
    try {
      const value = await readJson<unknown>(`${collection}/index.json`);
      if (Array.isArray(value))
        previous = value.filter((entry): entry is IndexEntry => entry && typeof entry.id === "string");
    } catch {
      /* The index itself is what this operation repairs. */
    }
    for (const hint of importedHints) {
      if (!previous.some((entry) => entry.id === hint.id)) previous.push(hint);
    }
    const entries = new Map<string, IndexEntry>();
    const epoch = new Date(0).toISOString();
    for (const id of await listDirectories(collection)) {
      const path = `${collection}/${id}`;
      const prior = previous.find((entry) => (collection === "skills" ? entry.title === id : entry.id === id));
      if (collection === "agents") {
        const md = (await readText(`${path}/AGENTS.md`)) ?? (await readText(`${path}/AGENT.md`));
        const meta = md !== undefined ? parseAgentMd(md) : await readJson<{ name?: string }>(`${path}/agent.json`);
        if (!meta) continue;
        entries.set(id, { id, title: meta.name, updated: prior?.updated ?? epoch });
      } else if (collection === "skills") {
        const md = await readText(`${path}/SKILL.md`);
        if (!md || !parseSkillFile(md).success) continue;
        const skillId = prior?.id ?? id;
        entries.set(skillId, { id: skillId, title: id, updated: prior?.updated ?? epoch });
      } else {
        const meta = await readJson<Partial<IndexEntry>>(
          `${path}/${collection === "chats" ? "chat.json" : "metadata.json"}`,
        );
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
        const meta = await readJson<Partial<IndexEntry> & { messages?: unknown[] }>(`${collection}/${name}`);
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
    const result = [...entries.values()];
    await writeJson(`${collection}/index.json`, result);
    return result;
  });
}
