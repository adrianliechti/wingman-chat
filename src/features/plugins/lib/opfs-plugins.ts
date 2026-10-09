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
import { withPersistenceLock } from "@/shared/lib/persistence";
import type { HubMcpServer, InstalledPlugin } from "./types";

const COLLECTION = "plugins";

const EXT_BY_MIME: Record<string, string> = {
  "image/svg+xml": "svg",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

interface PluginManifest {
  id: string;
  title?: string;
  version?: string;
  description?: string;
  author?: string;
  keywords?: string[];
  mcpServers?: HubMcpServer[];
  icon?: string;
  hubUrl: string;
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

interface DownloadedIcon {
  file: string;
  blob: Blob;
  dataUrl: string;
}

/** Fetch the icon before locking the collection so network delays do not block storage. */
async function downloadIcon(iconUrl: string): Promise<DownloadedIcon | undefined> {
  try {
    const resp = await fetch(iconUrl);
    const contentType = resp.headers.get("content-type")?.split(";")[0].trim();
    const raw = await resp.blob();
    const blob = contentType && contentType !== raw.type ? new Blob([raw], { type: contentType }) : raw;
    return {
      file: `icon.${EXT_BY_MIME[contentType ?? ""] ?? "png"}`,
      blob,
      dataUrl: await blobToDataUrl(blob, contentType ?? blob.type),
    };
  } catch {
    return undefined;
  }
}

/** Persist a plugin as a whole: manifest + every bundled skill and its resources. Returns the icon as a data URL if one was saved. */
export async function savePlugin(plugin: InstalledPlugin, iconUrl?: string): Promise<string | undefined> {
  const icon = iconUrl ? await downloadIcon(iconUrl) : undefined;
  return withPersistenceLock(`collection:${COLLECTION}`, () => writePlugin(plugin, icon));
}

async function writePlugin(plugin: InstalledPlugin, icon?: DownloadedIcon): Promise<string | undefined> {
  const pluginDir = `${COLLECTION}/${plugin.id}`;

  // An icon is decoration: a plugin that cannot store one is still installed.
  let stored = icon;
  if (icon) {
    try {
      await writeBlob(`${pluginDir}/${icon.file}`, icon.blob);
    } catch {
      stored = undefined;
    }
  }

  const manifest: PluginManifest = {
    id: plugin.id,
    title: plugin.title,
    version: plugin.version,
    description: plugin.description,
    author: plugin.author,
    keywords: plugin.keywords,
    mcpServers: plugin.mcpServers,
    icon: stored?.file,
    hubUrl: plugin.hubUrl,
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

  return stored?.dataUrl;
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

  let iconDataUrl: string | undefined;
  if (manifest.icon) {
    const blob = await readBlob(`${pluginDir}/${manifest.icon}`);
    if (blob) iconDataUrl = await blobToDataUrl(blob, inferContentTypeFromPath(manifest.icon) ?? blob.type);
  }

  return {
    id: manifest.id,
    title: manifest.title,
    version: manifest.version,
    description: manifest.description,
    author: manifest.author,
    keywords: manifest.keywords,
    mcpServers: manifest.mcpServers,
    icon: iconDataUrl,
    hubUrl: manifest.hubUrl,
    installedAt: manifest.installedAt,
    skills,
  };
}

export async function listPluginIds(): Promise<string[]> {
  return listDirectories(COLLECTION);
}

export async function loadAllPlugins(): Promise<InstalledPlugin[]> {
  const ids = await listPluginIds();
  const results = await Promise.all(ids.map(loadPlugin));
  return results.filter((p): p is InstalledPlugin => p !== undefined);
}

export async function deletePlugin(id: string): Promise<void> {
  await withPersistenceLock(`collection:${COLLECTION}`, async () => {
    await deleteDirectory(`${COLLECTION}/${id}`);
    await removeIndexEntry(COLLECTION, id);
  });
}
