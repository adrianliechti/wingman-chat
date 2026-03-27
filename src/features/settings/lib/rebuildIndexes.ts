import * as opfs from "@/shared/lib/opfs";

interface ChatMeta {
  title?: string;
  updated?: string;
}

interface AgentMeta {
  name?: string;
  updatedAt?: string;
}

interface ImageMeta {
  title?: string;
  created?: string;
  updated?: string;
}

interface RepositoryMeta {
  name?: string;
  title?: string;
  updatedAt?: string;
  updated?: string;
}

export interface RebuildIndexesResult {
  chats: number;
  agents: number;
  images: number;
  skills: number;
  repositories: number;
  cleanedChatsFolders: number;
  cleanedAgentsFolders: number;
  cleanedImagesFolders: number;
  cleanedSkillsFolders: number;
  cleanedRepositoryFolders: number;
}

async function isDirectoryEmpty(path: string): Promise<boolean> {
  const [files, dirs] = await Promise.all([opfs.listFiles(path), opfs.listDirectories(path)]);

  return files.length === 0 && dirs.length === 0;
}

async function rebuildChatsIndex(): Promise<{ count: number; cleaned: number }> {
  const entriesById = new Map<string, opfs.IndexEntry>();
  let cleaned = 0;

  const chatDirs = await opfs.listDirectories("chats");
  for (const id of chatDirs) {
    const chat = await opfs.readJson<ChatMeta>(`chats/${id}/chat.json`);
    if (!chat) {
      const chatPath = `chats/${id}`;
      const empty = await isDirectoryEmpty(chatPath);
      if (empty) {
        await opfs.deleteDirectory(chatPath);
        cleaned++;
      }
      continue;
    }

    entriesById.set(id, {
      id,
      title: chat.title,
      updated: chat.updated || new Date().toISOString(),
    });
  }

  const chatFiles = await opfs.listFiles("chats");
  for (const file of chatFiles) {
    if (file === "index.json" || !file.endsWith(".json")) continue;

    const id = file.replace(/\.json$/, "");
    if (entriesById.has(id)) continue;

    const chat = await opfs.readJson<ChatMeta>(`chats/${file}`);
    if (!chat) continue;

    entriesById.set(id, {
      id,
      title: chat.title,
      updated: chat.updated || new Date().toISOString(),
    });
  }

  const entries = Array.from(entriesById.values());
  await opfs.writeIndex("chats", entries);
  return { count: entries.length, cleaned };
}

async function rebuildAgentsIndex(): Promise<{ count: number; cleaned: number }> {
  const entries: opfs.IndexEntry[] = [];
  const agentDirs = await opfs.listDirectories("agents");
  let cleaned = 0;

  for (const id of agentDirs) {
    const content = (await opfs.readText(`agents/${id}/AGENTS.md`)) || (await opfs.readText(`agents/${id}/AGENT.md`));

    let title = id;
    let hasMetadata = Boolean(content);
    if (content) {
      const nameMatch = content.match(/^name:\s*(.+)$/m);
      if (nameMatch) {
        title = nameMatch[1].trim();
      }
    } else {
      const legacyMeta = await opfs.readJson<AgentMeta>(`agents/${id}/agent.json`);
      if (legacyMeta?.name) {
        title = legacyMeta.name;
        hasMetadata = true;
      }
    }

    if (!hasMetadata) {
      const agentPath = `agents/${id}`;
      const empty = await isDirectoryEmpty(agentPath);
      if (empty) {
        await opfs.deleteDirectory(agentPath);
        cleaned++;
        continue;
      }
    }

    entries.push({
      id,
      title,
      updated: new Date().toISOString(),
    });
  }

  await opfs.writeIndex("agents", entries);
  return { count: entries.length, cleaned };
}

async function rebuildImagesIndex(): Promise<{ count: number; cleaned: number }> {
  const entries: opfs.IndexEntry[] = [];
  const imageDirs = await opfs.listDirectories("images");
  let cleaned = 0;

  for (const id of imageDirs) {
    const meta = await opfs.readJson<ImageMeta>(`images/${id}/metadata.json`);
    if (!meta) {
      const imagePath = `images/${id}`;
      const empty = await isDirectoryEmpty(imagePath);
      if (empty) {
        await opfs.deleteDirectory(imagePath);
        cleaned++;
      }
      continue;
    }

    entries.push({
      id,
      title: meta.title,
      updated: meta.updated || meta.created || new Date().toISOString(),
    });
  }

  await opfs.writeIndex("images", entries);
  return { count: entries.length, cleaned };
}

async function rebuildSkillsIndex(): Promise<{ count: number; cleaned: number }> {
  const existing = await opfs.readIndex("skills");
  const existingIdByTitle = new Map<string, string>();
  for (const entry of existing) {
    if (entry.title) {
      existingIdByTitle.set(entry.title, entry.id);
    }
  }

  const entries: opfs.IndexEntry[] = [];
  const skillDirs = await opfs.listDirectories("skills");
  let cleaned = 0;

  for (const skillName of skillDirs) {
    const skillPath = `skills/${skillName}`;
    const skillMd = await opfs.readText(`${skillPath}/SKILL.md`);
    if (!skillMd) {
      const empty = await isDirectoryEmpty(skillPath);
      if (empty) {
        await opfs.deleteDirectory(skillPath);
        cleaned++;
        continue;
      }
    }

    const existingId = existingIdByTitle.get(skillName);

    entries.push({
      id: existingId || skillName,
      title: skillName,
      updated: new Date().toISOString(),
    });
  }

  await opfs.writeIndex("skills", entries);
  return { count: entries.length, cleaned };
}

async function rebuildRepositoriesIndex(): Promise<{ count: number; cleaned: number }> {
  const entriesById = new Map<string, opfs.IndexEntry>();
  let cleaned = 0;

  const repoDirs = await opfs.listDirectories("repositories");
  for (const id of repoDirs) {
    const meta = await opfs.readJson<RepositoryMeta>(`repositories/${id}/repository.json`);
    if (!meta) {
      const repoPath = `repositories/${id}`;
      const empty = await isDirectoryEmpty(repoPath);
      if (empty) {
        await opfs.deleteDirectory(repoPath);
        cleaned++;
      }
      continue;
    }

    entriesById.set(id, {
      id,
      title: meta.name || meta.title || id,
      updated: meta.updatedAt || meta.updated || new Date().toISOString(),
    });
  }

  const repoFiles = await opfs.listFiles("repositories");
  for (const file of repoFiles) {
    if (file === "index.json" || !file.endsWith(".json")) continue;

    const id = file.replace(/\.json$/, "");
    if (entriesById.has(id)) continue;

    const meta = await opfs.readJson<RepositoryMeta>(`repositories/${file}`);
    if (!meta) continue;

    entriesById.set(id, {
      id,
      title: meta.name || meta.title || id,
      updated: meta.updatedAt || meta.updated || new Date().toISOString(),
    });
  }

  const entries = Array.from(entriesById.values());
  await opfs.writeIndex("repositories", entries);
  return { count: entries.length, cleaned };
}

export async function rebuildAllIndexes(): Promise<RebuildIndexesResult> {
  const [chatsResult, agentsResult, imagesResult, skillsResult, repositoriesResult] = await Promise.all([rebuildChatsIndex(), rebuildAgentsIndex(), rebuildImagesIndex(), rebuildSkillsIndex(), rebuildRepositoriesIndex()]);

  return {
    chats: chatsResult.count,
    agents: agentsResult.count,
    images: imagesResult.count,
    skills: skillsResult.count,
    repositories: repositoriesResult.count,
    cleanedChatsFolders: chatsResult.cleaned,
    cleanedAgentsFolders: agentsResult.cleaned,
    cleanedImagesFolders: imagesResult.cleaned,
    cleanedSkillsFolders: skillsResult.cleaned,
    cleanedRepositoryFolders: repositoriesResult.cleaned,
  };
}
