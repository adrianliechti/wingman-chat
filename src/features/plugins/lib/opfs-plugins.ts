/**
 * OPFS persistence for installed plugins.
 *
 * Directory layout:
 *   /plugins/{id}/plugin.json          — manifest (hub url, version, sha256, mcp servers, keywords)
 *   /plugins/{id}/skills/{name}/SKILL.md + resources — bundled skills, self-contained
 *   /plugins/index.json                 — standard OPFS collection index
 *
 * A plugin's skills live inside its own folder, never copied into the personal
 * `skills/` library — installing/uninstalling a plugin is a single atomic unit.
 */

import type { ParsedSkill, SkillResource } from "@/features/skills/lib/skillParser";
import { inferContentTypeFromPath, isTextContentType } from "@/shared/lib/fileTypes";
import {
  blobToDataUrl,
  dataUrlToBlob,
  deleteDirectory,
  isDataUrl,
  listDirectories,
  listFiles,
  readBlob,
  readJson,
  readText,
  removeIndexEntry,
  upsertIndexEntry,
  writeBlob,
  writeJson,
  writeText,
} from "@/shared/lib/opfs-core";
import type { InstalledPlugin, PluginMCPServer } from "./types";

const COLLECTION = "plugins";

interface PluginManifest {
  id: string;
  title?: string;
  version?: string;
  description?: string;
  keywords?: string[];
  mcpServers?: PluginMCPServer[];
  hubUrl: string;
  sha256: string;
  installedAt: string;
  skillNames: string[];
}

function serializeSkillMd(skill: ParsedSkill): string {
  const lines = ["---", `name: ${skill.name}`, `description: ${skill.description}`];
  if (skill.compatibility) lines.push(`compatibility: ${skill.compatibility}`);
  lines.push("---", "", skill.content);
  return lines.join("\n");
}

function parseSkillMd(
  content: string,
): Pick<ParsedSkill, "name" | "description" | "content" | "compatibility"> | undefined {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return undefined;
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  if (!fields.name || !fields.description) return undefined;
  return {
    name: fields.name,
    description: fields.description,
    content: match[2].trim(),
    ...(fields.compatibility ? { compatibility: fields.compatibility } : {}),
  };
}

async function walkResourcePaths(skillDir: string): Promise<string[]> {
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

async function loadResources(skillDir: string): Promise<SkillResource[]> {
  const resources: SkillResource[] = [];
  for (const path of await walkResourcePaths(skillDir)) {
    const blob = await readBlob(`${skillDir}/${path}`);
    if (!blob) continue;
    const contentType = inferContentTypeFromPath(path) || blob.type || undefined;
    const content = isTextContentType(contentType) ? await blob.text() : await blobToDataUrl(blob, contentType);
    resources.push({ path, content, contentType });
  }
  return resources;
}

async function saveResources(skillDir: string, resources: SkillResource[] = []): Promise<void> {
  for (const r of resources) {
    const full = `${skillDir}/${r.path}`;
    if (isDataUrl(r.content)) {
      await writeBlob(full, dataUrlToBlob(r.content));
    } else {
      await writeText(full, r.content, r.contentType || "text/plain;charset=utf-8");
    }
  }
}

/** Persist a plugin as a whole: manifest + every bundled skill and its resources. */
export async function savePlugin(plugin: InstalledPlugin): Promise<void> {
  const pluginDir = `${COLLECTION}/${plugin.id}`;

  const manifest: PluginManifest = {
    id: plugin.id,
    title: plugin.title,
    version: plugin.version,
    description: plugin.description,
    keywords: plugin.keywords,
    mcpServers: plugin.mcpServers,
    hubUrl: plugin.hubUrl,
    sha256: plugin.sha256,
    installedAt: plugin.installedAt,
    skillNames: plugin.skills.map((s) => s.name),
  };
  await writeJson(`${pluginDir}/plugin.json`, manifest);

  for (const skill of plugin.skills) {
    const skillDir = `${pluginDir}/skills/${skill.name}`;
    await writeText(`${skillDir}/SKILL.md`, serializeSkillMd(skill));
    await saveResources(skillDir, skill.resources);
  }

  await upsertIndexEntry(COLLECTION, {
    id: plugin.id,
    title: plugin.title || plugin.id,
    updated: new Date().toISOString(),
  });
}

/** Load one installed plugin by id, including its bundled skills and resources. */
export async function loadPlugin(id: string): Promise<InstalledPlugin | undefined> {
  const pluginDir = `${COLLECTION}/${id}`;
  const manifest = await readJson<PluginManifest>(`${pluginDir}/plugin.json`);
  if (!manifest) return undefined;

  const skills: ParsedSkill[] = [];
  for (const name of manifest.skillNames) {
    const skillDir = `${pluginDir}/skills/${name}`;
    const content = await readText(`${skillDir}/SKILL.md`);
    if (!content) continue;
    const parsed = parseSkillMd(content);
    if (!parsed) continue;
    const resources = await loadResources(skillDir);
    skills.push({ ...parsed, resources: resources.length ? resources : undefined });
  }

  return {
    id: manifest.id,
    title: manifest.title,
    version: manifest.version,
    description: manifest.description,
    keywords: manifest.keywords,
    mcpServers: manifest.mcpServers,
    hubUrl: manifest.hubUrl,
    sha256: manifest.sha256,
    installedAt: manifest.installedAt,
    skills,
  };
}

export async function listPluginIds(): Promise<string[]> {
  return listDirectories(COLLECTION);
}

export async function loadAllPlugins(): Promise<InstalledPlugin[]> {
  const ids = await listPluginIds();
  const plugins: InstalledPlugin[] = [];
  for (const id of ids) {
    const plugin = await loadPlugin(id);
    if (plugin) plugins.push(plugin);
  }
  return plugins;
}

export async function deletePlugin(id: string): Promise<void> {
  await deleteDirectory(`${COLLECTION}/${id}`);
  await removeIndexEntry(COLLECTION, id);
}
