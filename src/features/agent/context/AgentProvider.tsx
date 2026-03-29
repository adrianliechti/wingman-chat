import { useState, useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { Agent, BridgeServer } from "@/features/agent/types/agent";
import type { RepositoryFile } from "@/features/repository/types/repository";
import * as opfs from "@/shared/lib/opfs";
import { AgentContext } from "./AgentContext";
import type { AgentContextType } from "./AgentContext";
import { clearMcpOAuthStorage } from "@/features/settings/lib/mcpAuth";

const COLLECTION = "agents";
const AGENT_STORAGE_KEY = "app_agent";

// Stored file metadata (without text/vectors - they're stored separately)
interface StoredFileMeta {
  id: string;
  name: string;
  status: "pending" | "processing" | "completed" | "error";
  progress: number;
  error?: string;
  uploadedAt: string;
}

// Agent-specific OPFS operations using folder structure:
// /agents/{id}/AGENTS.md - YAML frontmatter (metadata) + markdown body (instructions)
// /agents/{id}/servers.json - BridgeServer[] (complex nested data)
// /agents/{id}/files/{fileId}/metadata.json - file metadata
// /agents/{id}/files/{fileId}/content.txt - extracted text
// /agents/{id}/files/{fileId}/embeddings.bin - embedding vectors as Float32Array
// /agents/{id}/files/{fileId}/segments.json - segment texts

// --- AGENTS.md serialization / parsing ---

function serializeAgentMd(agent: Agent): string {
  const lines: string[] = ["---"];
  lines.push(`name: ${agent.name}`);
  if (agent.description) lines.push(`description: ${agent.description}`);
  if (agent.model) lines.push(`model: ${agent.model}`);
  if (agent.skills.length > 0) lines.push(`skills: [${agent.skills.map((s) => `'${s}'`).join(", ")}]`);
  if (agent.tools.length > 0) lines.push(`tools: [${agent.tools.map((t) => `'${t}'`).join(", ")}]`);
  if (agent.memory) lines.push("memory: true");
  lines.push("---");
  if (agent.instructions) {
    lines.push("");
    lines.push(agent.instructions);
  }
  return lines.join("\n");
}

function parseAgentMd(content: string):
  | {
      name: string;
      description?: string;
      model?: string;
      skills: string[];
      tools: string[];
      memory?: boolean;
      instructions?: string;
    }
  | undefined {
  const match = content.match(/^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/);
  if (!match) return undefined;

  const frontmatter = match[1];
  const body = match[2]?.trim() || undefined;

  const fields: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    fields[key] = value;
  }

  // Parse YAML list values — supports bracket arrays ['a', 'b'], or comma-separated a, b
  const parseList = (val?: string): string[] => {
    if (!val) return [];
    // Bracket array: ['a', 'b'] or [a, b]
    const bracketMatch = val.match(/^\[(.*)\]$/);
    if (bracketMatch) {
      return bracketMatch[1]
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    }
    // Comma-separated (legacy)
    return val
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  };

  return {
    name: fields.name || "Untitled",
    description: fields.description || undefined,
    skills: parseList(fields.skills),
    tools: parseList(fields.tools),
    model: fields.model || undefined,
    memory: fields.memory === "true",
    instructions: body,
  };
}

async function storeAgent(agent: Agent): Promise<void> {
  const agentPath = `${COLLECTION}/${agent.id}`;

  // Write AGENTS.md (frontmatter + instructions body)
  await opfs.writeText(`${agentPath}/AGENTS.md`, serializeAgentMd(agent));

  // Write servers separately (complex nested data)
  if (agent.servers.length > 0) {
    await opfs.writeJson(`${agentPath}/servers.json`, agent.servers);
  } else {
    await opfs.deleteFile(`${agentPath}/servers.json`).catch(() => {});
  }

  // Store each file separately
  if (agent.files) {
    for (const file of agent.files) {
      await storeAgentFile(agent.id, file);
    }
  }

  await opfs.upsertIndexEntry(COLLECTION, {
    id: agent.id,
    title: agent.name,
    updated: new Date().toISOString(),
  });
}

async function storeAgentFile(agentId: string, file: RepositoryFile): Promise<void> {
  const filePath = `${COLLECTION}/${agentId}/files/${file.id}`;

  const meta: StoredFileMeta = {
    id: file.id,
    name: file.name,
    status: file.status,
    progress: file.progress,
    error: file.error,
    uploadedAt:
      file.uploadedAt instanceof Date ? file.uploadedAt.toISOString() : (file.uploadedAt as unknown as string),
  };

  await opfs.writeJson(`${filePath}/metadata.json`, meta);

  if (file.text) {
    await opfs.writeText(`${filePath}/content.txt`, file.text);
  }

  if (file.segments && file.segments.length > 0) {
    const segmentTexts = file.segments.map((s) => s.text);
    await opfs.writeJson(`${filePath}/segments.json`, segmentTexts);

    const vectorDim = file.segments[0].vector.length;
    const totalFloats = 1 + file.segments.length * vectorDim;
    const buffer = new Float32Array(totalFloats);
    buffer[0] = vectorDim;

    let offset = 1;
    for (const segment of file.segments) {
      buffer.set(segment.vector, offset);
      offset += vectorDim;
    }

    const blob = new Blob([buffer.buffer], {
      type: "application/octet-stream",
    });
    await opfs.writeBlob(`${filePath}/embeddings.bin`, blob);
  }
}

async function loadAgent(id: string): Promise<Agent | undefined> {
  const agentPath = `${COLLECTION}/${id}`;

  // Try AGENTS.md first, then legacy AGENT.md, then agent.json
  let name = "Untitled";
  let description: string | undefined;
  let instructions: string | undefined;
  let skills: string[] = [];
  let tools: string[] = [];
  let servers: BridgeServer[] = [];
  let model: string | undefined;
  let memory: boolean | undefined;

  const mdContent = (await opfs.readText(`${agentPath}/AGENTS.md`)) || (await opfs.readText(`${agentPath}/AGENT.md`));
  if (mdContent) {
    const parsed = parseAgentMd(mdContent);
    if (parsed) {
      name = parsed.name;
      description = parsed.description;
      instructions = parsed.instructions;
      skills = parsed.skills;
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
  const fileIds = await opfs.listDirectories(`${agentPath}/files`);

  for (const fileId of fileIds) {
    const file = await loadAgentFile(id, fileId);
    if (file) {
      files.push(file);
    }
  }

  return {
    id,
    name,
    description,
    instructions,
    skills,
    servers,
    tools,
    model,
    memory,
    files: files.length > 0 ? files : undefined,
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
    const floats = new Float32Array(buffer);
    const vectorDim = floats[0];

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
    id: meta.id,
    name: meta.name,
    status: meta.status,
    progress: meta.progress,
    error: meta.error,
    uploadedAt: new Date(meta.uploadedAt),
    text,
    segments,
  };
}

async function removeAgent(id: string): Promise<void> {
  await opfs.deleteDirectory(`${COLLECTION}/${id}`);
  await opfs.removeIndexEntry(COLLECTION, id);
}

async function removeAgentFile(agentId: string, fileId: string): Promise<void> {
  await opfs.deleteDirectory(`${COLLECTION}/${agentId}/files/${fileId}`);
}

async function loadAgentIndex(): Promise<opfs.IndexEntry[]> {
  return opfs.readIndex(COLLECTION);
}

// Guard against double-migration (React StrictMode fires effects twice)
let migrationRunning = false;

// Migration: convert existing repositories + bridge servers + skills into agents
async function migrateFromLegacy(): Promise<Agent[]> {
  if (migrationRunning) return [];
  migrationRunning = true;

  const migrated: Agent[] = [];

  try {
    // Collect existing skill names
    let enabledSkillNames: string[] = [];
    try {
      const skills = await opfs.loadAllSkills();
      enabledSkillNames = skills.map((s) => s.name);
    } catch {
      /* no skills */
    }

    // Determine default-on tool IDs from config
    const defaultTools: string[] = [];

    // Load existing repositories
    const repoIndex = await opfs.readIndex("repositories");

    if (repoIndex.length > 0) {
      let firstAgent = true;

      for (const entry of repoIndex) {
        try {
          // Read repo metadata — try folder structure first, then flat file (IndexedDB migration format)
          let repoName = entry.title || "Untitled";
          let repoInstructions: string | undefined;
          const files: RepositoryFile[] = [];
          const agentId = crypto.randomUUID();

          const repoMeta = await opfs.readJson<{
            id: string;
            name: string;
            embedder: string;
            instructions?: string;
            createdAt: string;
            updatedAt: string;
            files?: Array<{
              id: string;
              name: string;
              status: string;
              progress: number;
              text?: string;
              segments?: Array<{ text: string; vector: number[] }>;
              error?: string;
              uploadedAt: string;
            }>;
          }>(`repositories/${entry.id}/repository.json`);

          if (repoMeta) {
            // Folder structure (old RepositoryProvider format)
            repoName = repoMeta.name;
            repoInstructions = repoMeta.instructions;

            // Copy files from folder structure
            const fileIds = await opfs.listDirectories(`repositories/${entry.id}/files`);
            for (const fileId of fileIds) {
              const srcBase = `repositories/${entry.id}/files/${fileId}`;
              const dstBase = `${COLLECTION}/${agentId}/files/${fileId}`;

              const fileMeta = await opfs.readJson<StoredFileMeta>(`${srcBase}/metadata.json`);
              if (fileMeta) {
                await opfs.writeJson(`${dstBase}/metadata.json`, fileMeta);

                const text = await opfs.readText(`${srcBase}/content.txt`);
                if (text) await opfs.writeText(`${dstBase}/content.txt`, text);

                const blob = await opfs.readBlob(`${srcBase}/embeddings.bin`);
                if (blob) await opfs.writeBlob(`${dstBase}/embeddings.bin`, blob);

                const segTexts = await opfs.readJson<string[]>(`${srcBase}/segments.json`);
                if (segTexts) await opfs.writeJson(`${dstBase}/segments.json`, segTexts);

                files.push({
                  id: fileMeta.id,
                  name: fileMeta.name,
                  status: fileMeta.status,
                  progress: fileMeta.progress,
                  error: fileMeta.error,
                  uploadedAt: new Date(fileMeta.uploadedAt),
                  text,
                });
              }
            }
          } else {
            // Flat file format (IndexedDB migration wrote repositories/{id}.json with embedded files)
            const flatRepo = await opfs.readJson<{
              id: string;
              name: string;
              embedder?: string;
              instructions?: string;
              createdAt: string;
              updatedAt: string;
              files?: Array<{
                id: string;
                name: string;
                status: string;
                progress: number;
                text?: string;
                segments?: Array<{ text: string; vector: number[] }>;
                error?: string;
                uploadedAt: string | Date;
              }>;
            }>(`repositories/${entry.id}.json`);

            if (!flatRepo) continue;

            repoName = flatRepo.name;
            repoInstructions = flatRepo.instructions;

            // Extract embedded files into folder structure
            if (flatRepo.files && Array.isArray(flatRepo.files)) {
              for (const f of flatRepo.files) {
                const fileId = f.id || crypto.randomUUID();
                const dstBase = `${COLLECTION}/${agentId}/files/${fileId}`;

                const meta: StoredFileMeta = {
                  id: fileId,
                  name: f.name || "Unknown File",
                  status: (f.status as StoredFileMeta["status"]) || "completed",
                  progress: typeof f.progress === "number" ? f.progress : 100,
                  error: f.error,
                  uploadedAt:
                    typeof f.uploadedAt === "string"
                      ? f.uploadedAt
                      : new Date(f.uploadedAt || Date.now()).toISOString(),
                };

                await opfs.writeJson(`${dstBase}/metadata.json`, meta);

                if (f.text) {
                  await opfs.writeText(`${dstBase}/content.txt`, f.text);
                }

                if (f.segments && f.segments.length > 0) {
                  const segmentTexts = f.segments.map((s) => s.text);
                  await opfs.writeJson(`${dstBase}/segments.json`, segmentTexts);

                  const vectorDim = f.segments[0].vector.length;
                  const totalFloats = 1 + f.segments.length * vectorDim;
                  const buffer = new Float32Array(totalFloats);
                  buffer[0] = vectorDim;
                  let offset = 1;
                  for (const segment of f.segments) {
                    buffer.set(segment.vector, offset);
                    offset += vectorDim;
                  }
                  const blob = new Blob([buffer.buffer], {
                    type: "application/octet-stream",
                  });
                  await opfs.writeBlob(`${dstBase}/embeddings.bin`, blob);
                }

                files.push({
                  id: fileId,
                  name: meta.name,
                  status: meta.status,
                  progress: meta.progress,
                  error: meta.error,
                  uploadedAt: new Date(meta.uploadedAt),
                  text: f.text,
                  segments: f.segments,
                });
              }
            }
          }

          const agent: Agent = {
            id: agentId,
            name: repoName,
            instructions: repoInstructions,
            skills: firstAgent ? enabledSkillNames : [],
            servers: [],
            tools: defaultTools,
            files: files.length > 0 ? files : undefined,
          };

          await storeAgent(agent);
          migrated.push(agent);
          firstAgent = false;
        } catch (error) {
          console.error(`Failed to migrate repository ${entry.id}:`, error);
        }
      }
    }

    // Mark migration complete
    await opfs.writeJson(`${COLLECTION}/.migrated`, {
      migratedAt: new Date().toISOString(),
    });

    console.log(`[agent] Migration complete: ${migrated.length} agents created`);
  } catch (error) {
    console.error("[agent] Migration failed:", error);
    migrationRunning = false;
  }

  return migrated;
}

export function AgentProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [currentAgent, setCurrentAgent] = useState<Agent | null>(null);
  const [showAgentDrawer, setShowAgentDrawer] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const pendingSaves = useRef<Set<string>>(new Set());
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentsRef = useRef<Agent[]>(agents);
  agentsRef.current = agents;

  // Load agents from OPFS on mount; run migration if needed
  useEffect(() => {
    const loadData = async () => {
      try {
        // Check if migration has been done
        const migrationDone = await opfs.readJson<{ migratedAt: string }>(`${COLLECTION}/.migrated`);

        if (!migrationDone) {
          // Run migration from repositories + bridge + skills
          const migratedAgents = await migrateFromLegacy();
          if (migratedAgents.length > 0) {
            setAgents(migratedAgents);
            setCurrentAgent(migratedAgents[0]);
            setIsLoaded(true);
            return;
          }
          // Even if no agents were migrated, mark migration complete
          await opfs.writeJson(`${COLLECTION}/.migrated`, {
            migratedAt: new Date().toISOString(),
          });
        }

        // Normal load
        const index = await loadAgentIndex();
        const loadedAgents: Agent[] = [];

        for (const entry of index) {
          const agent = await loadAgent(entry.id);
          if (agent) {
            loadedAgents.push(agent);
          }
        }

        setAgents(loadedAgents);

        // Restore current agent from localStorage
        const savedCurrentAgentId = localStorage.getItem(AGENT_STORAGE_KEY);
        if (savedCurrentAgentId) {
          const foundAgent = loadedAgents.find((a) => a.id === savedCurrentAgentId);
          if (foundAgent) {
            setCurrentAgent(foundAgent);
          }
        }
      } catch (error) {
        console.error("Failed to load agents:", error);
      } finally {
        setIsLoaded(true);
      }
    };

    loadData();
  }, []);

  // Debounced save function
  const scheduleSave = useCallback((agentId: string) => {
    pendingSaves.current.add(agentId);

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      const idsToSave = Array.from(pendingSaves.current);
      pendingSaves.current.clear();

      for (const id of idsToSave) {
        const agent = agentsRef.current.find((a) => a.id === id);
        if (agent) {
          try {
            await storeAgent(agent);
          } catch (error) {
            console.error(`Error saving agent ${id}:`, error);
          }
        }
      }
    }, 100);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    const pending = pendingSaves;
    const refs = agentsRef;
    const timeout = saveTimeoutRef;

    return () => {
      if (timeout.current) {
        clearTimeout(timeout.current);
      }

      const idsToSave = Array.from(pending.current);
      pending.current.clear();

      for (const id of idsToSave) {
        const agent = refs.current.find((a) => a.id === id);
        if (agent) {
          storeAgent(agent).catch(console.warn);
        }
      }
    };
  }, []);

  // Persist current agent selection
  useEffect(() => {
    if (!isLoaded) return;

    if (currentAgent) {
      localStorage.setItem(AGENT_STORAGE_KEY, currentAgent.id);
    } else {
      localStorage.removeItem(AGENT_STORAGE_KEY);
    }
  }, [currentAgent, isLoaded]);

  const createAgent = useCallback(async (name: string): Promise<Agent> => {
    const newAgent: Agent = {
      id: crypto.randomUUID(),
      name,
      skills: [],
      servers: [],
      tools: [],
    };

    setAgents((prev) => [...prev, newAgent]);
    setCurrentAgent(newAgent);

    try {
      await storeAgent(newAgent);
    } catch (error) {
      console.error("Error saving new agent:", error);
    }

    return newAgent;
  }, []);

  const updateAgent = useCallback(
    (id: string, updates: Partial<Omit<Agent, "id">>) => {
      setAgents((prev) => {
        const updated = prev.map((agent) => (agent.id === id ? { ...agent, ...updates } : agent));

        setTimeout(() => scheduleSave(id), 0);

        return updated;
      });

      if (currentAgent?.id === id) {
        setCurrentAgent((prev) => (prev ? { ...prev, ...updates } : null));
      }
    },
    [currentAgent, scheduleSave],
  );

  const deleteAgent = useCallback(
    async (id: string) => {
      setAgents((prev) => prev.filter((agent) => agent.id !== id));

      if (currentAgent?.id === id) {
        setCurrentAgent(null);
      }

      try {
        await removeAgent(id);
      } catch (error) {
        console.error(`Error deleting agent ${id}:`, error);
      }
    },
    [currentAgent],
  );

  // File operations (repository files within an agent)
  const upsertFile = useCallback(
    (agentId: string, file: RepositoryFile) => {
      setAgents((prev) => {
        const updated = prev.map((agent) => {
          if (agent.id !== agentId) return agent;
          const files = agent.files ? [...agent.files] : [];
          const existingIdx = files.findIndex((f) => f.id === file.id);
          if (existingIdx !== -1) {
            files[existingIdx] = file;
          } else {
            files.push(file);
          }
          return { ...agent, files };
        });

        setTimeout(() => scheduleSave(agentId), 0);

        return updated;
      });
    },
    [scheduleSave],
  );

  const removeFile = useCallback(
    (agentId: string, fileId: string) => {
      setAgents((prev) => {
        const updated = prev.map((agent) => {
          if (agent.id !== agentId) return agent;
          const files = agent.files ? agent.files.filter((f) => f.id !== fileId) : [];
          return { ...agent, files };
        });

        removeAgentFile(agentId, fileId).catch((error) => {
          console.error(`Error deleting agent file ${fileId}:`, error);
        });

        setTimeout(() => scheduleSave(agentId), 0);

        return updated;
      });
    },
    [scheduleSave],
  );

  // Bridge server operations within an agent
  const addServer = useCallback(
    (agentId: string, serverData: Omit<BridgeServer, "id">): BridgeServer => {
      const newServer: BridgeServer = {
        ...serverData,
        id: crypto.randomUUID(),
      };

      setAgents((prev) => {
        const updated = prev.map((agent) => {
          if (agent.id !== agentId) return agent;
          return { ...agent, servers: [...agent.servers, newServer] };
        });
        setTimeout(() => scheduleSave(agentId), 0);
        return updated;
      });

      if (currentAgent?.id === agentId) {
        setCurrentAgent((prev) => (prev ? { ...prev, servers: [...prev.servers, newServer] } : null));
      }

      return newServer;
    },
    [currentAgent, scheduleSave],
  );

  const updateServer = useCallback(
    (agentId: string, serverId: string, updates: Partial<Omit<BridgeServer, "id">>) => {
      setAgents((prev) => {
        const updated = prev.map((agent) => {
          if (agent.id !== agentId) return agent;
          return {
            ...agent,
            servers: agent.servers.map((s) => (s.id === serverId ? { ...s, ...updates } : s)),
          };
        });
        setTimeout(() => scheduleSave(agentId), 0);
        return updated;
      });

      if (currentAgent?.id === agentId) {
        setCurrentAgent((prev) =>
          prev
            ? {
                ...prev,
                servers: prev.servers.map((s) => (s.id === serverId ? { ...s, ...updates } : s)),
              }
            : null,
        );
      }
    },
    [currentAgent, scheduleSave],
  );

  const removeServer = useCallback(
    (agentId: string, serverId: string) => {
      const server = agents.find((a) => a.id === agentId)?.servers.find((s) => s.id === serverId);
      if (server) {
        clearMcpOAuthStorage(server.id);
      }

      setAgents((prev) => {
        const updated = prev.map((agent) => {
          if (agent.id !== agentId) return agent;
          return {
            ...agent,
            servers: agent.servers.filter((s) => s.id !== serverId),
          };
        });
        setTimeout(() => scheduleSave(agentId), 0);
        return updated;
      });

      if (currentAgent?.id === agentId) {
        setCurrentAgent((prev) =>
          prev
            ? {
                ...prev,
                servers: prev.servers.filter((s) => s.id !== serverId),
              }
            : null,
        );
      }
    },
    [currentAgent, scheduleSave],
  );

  const toggleServer = useCallback(
    (agentId: string, serverId: string) => {
      setAgents((prev) => {
        const updated = prev.map((agent) => {
          if (agent.id !== agentId) return agent;
          return {
            ...agent,
            servers: agent.servers.map((s) => (s.id === serverId ? { ...s, enabled: !s.enabled } : s)),
          };
        });
        setTimeout(() => scheduleSave(agentId), 0);
        return updated;
      });

      if (currentAgent?.id === agentId) {
        setCurrentAgent((prev) =>
          prev
            ? {
                ...prev,
                servers: prev.servers.map((s) => (s.id === serverId ? { ...s, enabled: !s.enabled } : s)),
              }
            : null,
        );
      }
    },
    [currentAgent, scheduleSave],
  );

  const toggleAgentDrawer = useCallback(() => {
    setShowAgentDrawer((prev) => !prev);
  }, []);

  const value: AgentContextType = {
    agents,
    currentAgent,
    createAgent,
    updateAgent,
    deleteAgent,
    setCurrentAgent,
    showAgentDrawer,
    setShowAgentDrawer,
    toggleAgentDrawer,
    upsertFile,
    removeFile,
    addServer,
    updateServer,
    removeServer,
    toggleServer,
  };

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}
