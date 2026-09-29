import { assertSafeResourcePath, type SkillMetadata, type SkillSource } from "@tanstack/ai-skills";
import type { SkillEntry } from "./skillsProvider";

/** Plugin names are qualified and path-safe; personal/template names stay unchanged. */
export function skillName(entry: Pick<SkillEntry, "name" | "plugin">): string {
  return entry.plugin ? `${encodeURIComponent(entry.plugin)}:${entry.name}` : entry.name;
}

export function skillMetadata(entry: SkillEntry): SkillMetadata {
  return {
    name: skillName(entry),
    description: entry.description,
    ...(entry.compatibility ? { compatibility: entry.compatibility } : {}),
  };
}

/** Bytes-only TanStack source for the selected browser library, templates, and plugins. */
export function createSkillSource(entries: SkillEntry[]) {
  const byName = new Map(entries.map((entry) => [skillName(entry), entry]));
  const catalog = [...byName.values()].map(skillMetadata);
  const get = (name: string) => {
    const entry = byName.get(name);
    if (!entry) throw new Error(`Skill "${name}" not found`);
    return entry;
  };
  return {
    list: async () => catalog,
    load: async (name) => get(name).loadContent(),
    // Scripts remain readable resources: our browser interpreter executes the
    // selected files, while TanStack's script tier currently only inventories them.
    listResources: async (name) => get(name).resources ?? [],
    readResource: async (name, path) => {
      assertSafeResourcePath(path);
      const entry = get(name);
      if (!entry.resources?.includes(path)) throw new Error(`Skill "${name}" has no resource "${path}"`);
      const content = await entry.loadResource?.(path);
      if (content == null) throw new Error(`Failed to load resource "${path}" for skill "${name}"`);
      return content;
    },
  } satisfies SkillSource;
}
