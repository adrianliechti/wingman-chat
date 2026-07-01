/**
 * OPFS Skills — Skill CRUD and SKILL.md serialization.
 */

import type { Skill, SkillResource } from "@/features/skills/lib/skillParser";
import { parseSkillFile } from "@/features/skills/lib/skillParser";
import { inferContentTypeFromPath, isTextContentType } from "./fileTypes";
import type { IndexEntry } from "./opfs-core";
import {
  blobToDataUrl,
  dataUrlToBlob,
  deleteDirectory,
  deleteFile,
  isDataUrl,
  listDirectories,
  listFiles,
  readBlob,
  readIndex,
  readText,
  removeIndexEntry,
  upsertIndexEntry,
  writeBlob,
  writeText,
} from "./opfs-core";

export interface StoredSkill {
  name: string;
  description: string;
  content: string;
}

/**
 * Save a skill as SKILL.md in /skills/{name}/ folder.
 */
export async function saveSkill(skill: Skill): Promise<void> {
  const skillDir = `skills/${skill.name}`;
  await writeText(`${skillDir}/SKILL.md`, serializeSkillToMd(skill));
  await saveSkillResources(skillDir, skill.resources ?? []);

  // Update index
  await upsertIndexEntry("skills", {
    id: skill.id,
    title: skill.name,
    updated: new Date().toISOString(),
  });
}

/**
 * Load a skill from /skills/{name}/SKILL.md.
 */
export async function loadSkill(name: string): Promise<Skill | undefined> {
  const content = await readText(`skills/${name}/SKILL.md`);
  if (!content) {
    return undefined;
  }

  const result = parseSkillFile(content);
  if (!result.success) {
    console.warn(`Failed to parse skill ${name}:`, result.errors);
    return undefined;
  }

  // Find ID from index or generate one
  const index = await readIndex("skills");
  const entry = index.find((e: IndexEntry) => e.title === name);

  const resources = await loadSkillResources(`skills/${name}`);

  return {
    id: entry?.id || crypto.randomUUID(),
    ...result.skill,
    resources: resources.length ? resources : undefined,
  };
}

/**
 * Delete a skill and its folder.
 */
export async function deleteSkill(name: string): Promise<void> {
  // Find ID from index for removal
  const index = await readIndex("skills");
  const entry = index.find((e: IndexEntry) => e.title === name);

  // Delete the folder
  await deleteDirectory(`skills/${name}`);

  // Update index
  if (entry) {
    await removeIndexEntry("skills", entry.id);
  }
}

/**
 * List all skill names.
 */
export async function listSkillNames(): Promise<string[]> {
  return listDirectories("skills");
}

/**
 * Load all skills.
 */
export async function loadAllSkills(): Promise<Skill[]> {
  const names = await listSkillNames();
  const skills: Skill[] = [];

  for (const name of names) {
    const skill = await loadSkill(name);
    if (skill) {
      skills.push(skill);
    }
  }

  return skills;
}

/**
 * Walk a skill folder for bundled resource files, returning paths relative to
 * the folder (e.g. "scripts/extract.py"). Skips the SKILL.md itself and hidden
 * files — mirrors the server's skill-resource listing.
 */
async function walkSkillResourcePaths(skillDir: string): Promise<string[]> {
  const out: string[] = [];

  const recurse = async (rel: string): Promise<void> => {
    const dir = rel ? `${skillDir}/${rel}` : skillDir;

    for (const name of await listFiles(dir)) {
      if (name.startsWith(".")) continue;
      const p = rel ? `${rel}/${name}` : name;
      if (p === "SKILL.md") continue;
      out.push(p);
    }

    for (const sub of await listDirectories(dir)) {
      if (sub.startsWith(".")) continue;
      await recurse(rel ? `${rel}/${sub}` : sub);
    }
  };

  await recurse("");
  return out.sort((a, b) => a.localeCompare(b));
}

/** Load every bundled resource for a skill (text inline, binary as data URL). */
async function loadSkillResources(skillDir: string): Promise<SkillResource[]> {
  const resources: SkillResource[] = [];

  for (const path of await walkSkillResourcePaths(skillDir)) {
    const blob = await readBlob(`${skillDir}/${path}`);
    if (!blob) continue;

    const contentType = inferContentTypeFromPath(path) || blob.type || undefined;
    const content = isTextContentType(contentType) ? await blob.text() : await blobToDataUrl(blob, contentType);
    resources.push({ path, content, contentType });
  }

  return resources;
}

/** Persist a skill's resources, removing any files that are no longer present. */
async function saveSkillResources(skillDir: string, resources: SkillResource[]): Promise<void> {
  const desired = new Set(resources.map((r) => r.path));

  for (const existing of await walkSkillResourcePaths(skillDir)) {
    if (!desired.has(existing)) await deleteFile(`${skillDir}/${existing}`);
  }

  for (const r of resources) {
    const full = `${skillDir}/${r.path}`;
    if (isDataUrl(r.content)) {
      await writeBlob(full, dataUrlToBlob(r.content));
    } else {
      await writeText(full, r.content, r.contentType || "text/plain;charset=utf-8");
    }
  }
}

/**
 * Serialize a skill to SKILL.md format.
 */
function serializeSkillToMd(skill: Skill): string {
  const lines = ["---", `name: ${skill.name}`, `description: ${skill.description}`];
  if (skill.compatibility) lines.push(`compatibility: ${skill.compatibility}`);
  lines.push("---", "", skill.content);

  return lines.join("\n");
}
