/**
 * OPFS Skills — Skill CRUD and SKILL.md serialization.
 */

import type { Skill, SkillResource } from "@/features/skills/lib/skillParser";
import { parseSkillFile, serializeSkill, validateSkillName } from "@/features/skills/lib/skillParser";
import { withPersistenceLock } from "./persistence";
import { writeFileChanges } from "./opfs-transaction";
import { inferContentTypeFromPath, isTextContentType } from "./fileTypes";
import type { IndexEntry } from "./opfs-core";
import {
  blobToDataUrl,
  dataUrlToBlob,
  deleteDirectory,
  fileExists,
  isDataUrl,
  listDirectories,
  listFiles,
  readBlob,
  readIndex,
  readText,
  removeIndexEntry,
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
  await withPersistenceLock("collection:skills", () => writeSkill(skill));
}

async function writeSkill(skill: Skill): Promise<void> {
  if (!validateSkillName(skill.name).valid) throw new Error(`Invalid skill name: ${skill.name}`);
  const definition = serializeSkill(skill);
  if (!parseSkillFile(definition).success) throw new Error(`Invalid skill definition: ${skill.name}`);
  const skillDir = `skills/${skill.name}`;
  const changes = new Map<string, Blob | undefined>();
  for (const resource of skill.resources ?? []) {
    const path = resource.path;
    if (
      !path ||
      path === "SKILL.md" ||
      /[\\\0]/.test(path) ||
      path.startsWith("/") ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error(`Invalid skill resource path: ${path}`);
    changes.set(
      `${skillDir}/${path}`,
      isDataUrl(resource.content) ? dataUrlToBlob(resource.content) : new Blob([resource.content]),
    );
  }
  for (const path of await walkSkillResourcePaths(skillDir)) {
    if (!changes.has(`${skillDir}/${path}`)) changes.set(`${skillDir}/${path}`, undefined);
  }
  changes.set(`${skillDir}/SKILL.md`, new Blob([definition]));
  let oldName: string | undefined;
  await withPersistenceLock("index:skills", async () => {
    const index = await readIndex("skills");
    oldName = index.find((entry) => entry.id === skill.id)?.title;
    if (index.some((entry) => entry.title === skill.name && entry.id !== skill.id))
      throw new Error(`A skill named ${skill.name} already exists`);
    if (oldName && oldName !== skill.name) {
      for (const path of ["SKILL.md", ...(await walkSkillResourcePaths(`skills/${oldName}`))])
        changes.set(`skills/${oldName}/${path}`, undefined);
    }
    changes.set(
      "skills/index.json",
      new Blob([
        JSON.stringify([
          ...index.filter((entry) => entry.id !== skill.id),
          {
            id: skill.id,
            title: skill.name,
            updated: new Date().toISOString(),
          },
        ]),
      ]),
    );
    await writeFileChanges(changes);
  });
  if (oldName && oldName !== skill.name)
    await deleteDirectory(`skills/${oldName}`).catch((error) => console.warn("Skill folder cleanup failed:", error));
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
    id: entry?.id || name,
    ...result.skill,
    resources: resources.length ? resources : undefined,
  };
}

/**
 * Delete a skill and its folder.
 */
export async function deleteSkill(name: string): Promise<void> {
  return withPersistenceLock("collection:skills", () => removeSkillFiles(name));
}

async function removeSkillFiles(name: string): Promise<void> {
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
  return withPersistenceLock("collection:skills", readAllSkills);
}

async function readAllSkills(): Promise<Skill[]> {
  const names = (await fileExists("skills/index.json"))
    ? (await readIndex("skills")).flatMap((entry) => (entry.title ? [entry.title] : []))
    : await listSkillNames();
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
