import type { Agent, BridgeServer } from "@/features/agent/types/agent";
import { reconcileRepositoryFilePaths } from "@/features/repository/lib/repository-paths";
import type { RepositoryFile } from "@/features/repository/types/repository";
import * as opfs from "@/shared/lib/opfs";
import { writeFileChanges } from "@/shared/lib/opfs-transaction";
import { withPersistenceLock } from "@/shared/lib/persistence";
const COLLECTION = "agents";

// Stored file metadata (without text/vectors - they're stored separately)
interface StoredFileMeta {
  id: string;
  name: string;
  path?: string;
  status: "pending" | "processing" | "completed" | "error";
  progress: number;
  error?: string;
  uploadedAt: string;
  embeddingRequestModel?: string;
  embeddingModel?: string;
}

// Agent-specific OPFS operations using folder structure:
// /agents/{id}/AGENTS.md - YAML frontmatter (metadata) + markdown body (instructions)
// /agents/{id}/servers.json - BridgeServer[] (complex nested data)
// /agents/{id}/files/{fileId}/metadata.json - file metadata
// /agents/{id}/files/{fileId}/content.txt - extracted text
// /agents/{id}/files/{fileId}/embeddings.bin - embedding vectors as Float32Array
// /agents/{id}/files/{fileId}/segments.json - segment texts

import { parseAgentMd, serializeAgentMd } from "./agentMarkdown";
export { parseAgentMd, serializeAgentMd } from "./agentMarkdown";

export async function storeAgent(agent: Agent): Promise<void> {
  return withPersistenceLock("collection:agents", () => writeAgent(agent));
}

async function writeAgent(agent: Agent): Promise<void> {
  const agentPath = `${COLLECTION}/${agent.id}`;
  const changes = new Map<string, Blob | undefined>();
  const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: "application/json" });
  changes.set(`${agentPath}/servers.json`, agent.servers.length ? json(agent.servers) : undefined);
  for (const file of agent.files ?? []) {
    const path = `${agentPath}/files/${file.id}`;
    changes.set(`${path}/content.txt`, file.text === undefined ? undefined : new Blob([file.text]));
    if (file.segments?.length) {
      const dimension = file.segments[0].vector.length;
      for (const segment of file.segments) {
        if (!dimension || segment.vector.length !== dimension)
          throw new Error(`Invalid embedding vectors for ${file.name}`);
        for (const value of segment.vector) {
          if (typeof value !== "number" || !Number.isFinite(Math.fround(value)))
            throw new Error(`Invalid embedding vectors for ${file.name}`);
        }
      }
      const buffer = new Float32Array(1 + file.segments.length * dimension);
      buffer[0] = dimension;
      file.segments.forEach((segment, i) => buffer.set(segment.vector, 1 + i * dimension));
      changes.set(`${path}/segments.json`, json(file.segments.map((segment) => segment.text)));
      changes.set(`${path}/embeddings.bin`, new Blob([buffer.buffer]));
    } else {
      changes.set(`${path}/segments.json`, undefined);
      changes.set(`${path}/embeddings.bin`, undefined);
    }
    const meta: StoredFileMeta = {
      id: file.id,
      name: file.name,
      path: file.path,
      status: file.status,
      progress: file.progress,
      error: file.error,
      uploadedAt: new Date(file.uploadedAt).toISOString(),
      embeddingRequestModel: file.embeddingRequestModel,
      embeddingModel: file.embeddingModel,
    };
    changes.set(`${path}/metadata.json`, json(meta));
  }
  const desiredIds = (agent.files ?? []).map((file) => file.id);
  changes.set(`${agentPath}/files/index.json`, json(desiredIds));
  changes.set(`${agentPath}/AGENTS.md`, new Blob([serializeAgentMd(agent)]));
  await withPersistenceLock("index:agents", async () => {
    const index = await opfs.readIndex(COLLECTION);
    changes.set(
      "agents/index.json",
      json([
        ...index.filter((entry) => entry.id !== agent.id),
        {
          id: agent.id,
          title: agent.name,
          updated: new Date().toISOString(),
        },
      ]),
    );
    await writeFileChanges(changes);
  });
  // Committed membership excludes these folders even if cleanup is interrupted.
  for (const id of await opfs.listDirectories(`${agentPath}/files`)) {
    if (!desiredIds.includes(id))
      await opfs
        .deleteDirectory(`${agentPath}/files/${id}`)
        .catch((error) => console.warn("Agent file cleanup failed:", error));
  }
}

export async function loadAgent(id: string): Promise<Agent | undefined> {
  const agentPath = `${COLLECTION}/${id}`;

  // Try AGENTS.md first, then legacy AGENT.md, then agent.json
  let name = "Untitled";
  let instructions: string | undefined;
  let skills: string[] = [];
  let plugins: string[] = [];
  let tools: string[] = [];
  let servers: BridgeServer[] = [];
  let model: string | undefined;
  let memory: boolean | undefined;

  const mdContent = (await opfs.readText(`${agentPath}/AGENTS.md`)) || (await opfs.readText(`${agentPath}/AGENT.md`));
  if (mdContent) {
    const parsed = parseAgentMd(mdContent);
    if (!parsed) throw new Error(`Invalid agent definition in ${agentPath}/AGENTS.md`);
    if (parsed) {
      name = parsed.name;
      instructions = parsed.instructions;
      skills = parsed.skills;
      plugins = parsed.plugins;
      tools = parsed.tools;
      model = parsed.model;
      memory = parsed.memory || undefined;
    }
  } else {
    // Legacy: read agent.json
    const meta = await opfs.readJson<{
      id: string;
      name: string;
      instructions?: string;
      repositoryEnabled?: boolean;
      embedder: string;
      skills: string[];
      servers: BridgeServer[];
      tools: string[];
      createdAt: string;
      updatedAt: string;
    }>(`${agentPath}/agent.json`);
    if (!meta) return undefined;

    name = meta.name;
    instructions = meta.instructions;
    skills = meta.skills || [];
    tools = meta.tools || [];
    servers = meta.servers || [];
  }

  // Load servers from servers.json (new format; legacy agents have them inline in agent.json)
  if (servers.length === 0) {
    const loadedServers = await opfs.readJson<BridgeServer[]>(`${agentPath}/servers.json`);
    if (loadedServers && Array.isArray(loadedServers)) {
      servers = loadedServers;
    }
  }

  // Load files from subfolders
  const files: RepositoryFile[] = [];
  const fileIds =
    (await opfs.readJson<string[]>(`${agentPath}/files/index.json`)) ??
    (await opfs.listDirectories(`${agentPath}/files`));
  if (!Array.isArray(fileIds) || fileIds.some((id) => typeof id !== "string"))
    throw new Error(`Invalid file index for agent ${id}`);

  for (const fileId of fileIds) {
    const file = await loadAgentFile(id, fileId);
    if (file) {
      files.push(file);
    }
  }

  // Normalize old records in memory. Loading is read-only; the next explicit
  // save persists these paths through the normal write path.
  const reconciled = reconcileRepositoryFilePaths(files);

  return {
    id,
    name,
    instructions,
    skills,
    plugins,
    servers,
    tools,
    model,
    memory,
    files: reconciled.files.length > 0 ? reconciled.files : undefined,
  };
}

async function loadAgentFile(agentId: string, fileId: string): Promise<RepositoryFile | undefined> {
  const filePath = `${COLLECTION}/${agentId}/files/${fileId}`;

  const meta = await opfs.readJson<StoredFileMeta>(`${filePath}/metadata.json`);
  if (!meta) return undefined;

  // Prefer actual content.txt presence over metadata flags, which can be stale
  // in some migrated/imported data sets.
  const text = await opfs.readText(`${filePath}/content.txt`);

  let segments: Array<{ text: string; vector: number[] }> | undefined;
  const segmentTexts = await opfs.readJson<string[]>(`${filePath}/segments.json`);
  const vectorsBlob = await opfs.readBlob(`${filePath}/embeddings.bin`);

  if (segmentTexts && vectorsBlob) {
    const buffer = await vectorsBlob.arrayBuffer();
    if (buffer.byteLength % 4 !== 0 || buffer.byteLength < 4) throw new Error(`Invalid embeddings in ${filePath}`);
    const floats = new Float32Array(buffer);
    const vectorDim = floats[0];
    if (
      !Array.isArray(segmentTexts) ||
      segmentTexts.some((text) => typeof text !== "string") ||
      !Number.isInteger(vectorDim) ||
      vectorDim <= 0 ||
      floats.length !== 1 + segmentTexts.length * vectorDim ||
      floats.some((value) => !Number.isFinite(value))
    ) {
      throw new Error(`Invalid embeddings in ${filePath}`);
    }

    segments = [];
    for (let i = 0; i < segmentTexts.length; i++) {
      const start = 1 + i * vectorDim;
      const vector = Array.from(floats.slice(start, start + vectorDim));
      segments.push({
        text: segmentTexts[i] || "",
        vector,
      });
    }
  }

  return {
    id: fileId,
    name: meta.name,
    path: meta.path,
    // No ingestion job survives a page reload. Keep recovered text available for retry.
    status: meta.status === "processing" || meta.status === "pending" ? "error" : meta.status,
    progress: meta.status === "processing" || meta.status === "pending" ? 0 : meta.progress,
    error:
      meta.status === "processing" || meta.status === "pending"
        ? "File processing was interrupted. Retry indexing or upload the file again."
        : meta.error,
    embeddingRequestModel: meta.embeddingRequestModel,
    embeddingModel: meta.embeddingModel,
    uploadedAt: new Date(meta.uploadedAt),
    text,
    segments,
  };
}

export async function removeAgent(id: string): Promise<void> {
  await withPersistenceLock("collection:agents", async () => {
    await opfs.deleteDirectory(`${COLLECTION}/${id}`);
    await opfs.removeIndexEntry(COLLECTION, id);
  });
}

export async function loadAgents(): Promise<Agent[]> {
  return withPersistenceLock("collection:agents", async () => {
    const agents: Agent[] = [];
    for (const entry of await opfs.readIndex(COLLECTION)) {
      try {
        const agent = await loadAgent(entry.id);
        if (agent) agents.push(agent);
      } catch (error) {
        console.error(`Could not load agent ${entry.id}:`, error);
      }
    }
    return agents;
  });
}
