/**
 * OPFS Skills — Skill CRUD and SKILL.md serialization.
 */

import type { Skill } from '@/features/skills/lib/skillParser';
import { parseSkillFile } from '@/features/skills/lib/skillParser';
import {
  writeText, readText, deleteDirectory, listDirectories,
  readIndex, upsertIndexEntry, removeIndexEntry,
} from './opfs-core';
import type { IndexEntry } from './opfs-core';

export interface StoredSkill {
  name: string;
  description: string;
  content: string;
}

/**
 * Save a skill as SKILL.md in /skills/{name}/ folder.
 */
export async function saveSkill(skill: Skill): Promise<void> {
  const skillContent = serializeSkillToMd(skill);
  await writeText(`skills/${skill.name}/SKILL.md`, skillContent);
  
  // Update index
  await upsertIndexEntry('skills', {
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
  const index = await readIndex('skills');
  const entry = index.find((e: IndexEntry) => e.title === name);
  
  return {
    id: entry?.id || crypto.randomUUID(),
    ...result.skill,
  };
}

/**
 * Delete a skill and its folder.
 */
export async function deleteSkill(name: string): Promise<void> {
  // Find ID from index for removal
  const index = await readIndex('skills');
  const entry = index.find((e: IndexEntry) => e.title === name);
  
  // Delete the folder
  await deleteDirectory(`skills/${name}`);
  
  // Update index
  if (entry) {
    await removeIndexEntry('skills', entry.id);
  }
}

/**
 * List all skill names.
 */
export async function listSkillNames(): Promise<string[]> {
  return listDirectories('skills');
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
 * Serialize a skill to SKILL.md format.
 */
function serializeSkillToMd(skill: Skill): string {
  const lines = [
    '---',
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    '---',
    '',
    skill.content
  ];
  
  return lines.join('\n');
}
