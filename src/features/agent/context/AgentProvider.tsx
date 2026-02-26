import { useState, useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Agent, BridgeServer } from '@/features/agent/types/agent';
import type { RepositoryFile } from '@/features/repository/types/repository';
import * as opfs from '@/shared/lib/opfs';
import { AgentContext } from './AgentContext';
import type { AgentContextType } from './AgentContext';
import { getConfig } from '@/shared/config';

const COLLECTION = 'agents';
const AGENT_STORAGE_KEY = 'app_agent';

// Stored agent metadata (without files - they're stored separately)
interface StoredAgentMeta {
  id: string;
  name: string;
  instructions?: string;
  repositoryEnabled: boolean;
  embedder: string;
  skills: string[];
  servers: BridgeServer[];
  tools: string[];
  createdAt: string;
  updatedAt: string;
}

// Stored file metadata (without text/vectors - they're stored separately)
interface StoredFileMeta {
  id: string;
  name: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  error?: string;
  uploadedAt: string;
  hasText: boolean;
  hasVectors: boolean;
  segmentCount: number;
}

// Agent-specific OPFS operations using folder structure:
// /agents/{id}/agent.json - metadata
// /agents/{id}/files/{fileId}/metadata.json - file metadata
// /agents/{id}/files/{fileId}/content.txt - extracted text
// /agents/{id}/files/{fileId}/embeddings.bin - embedding vectors as Float32Array
// /agents/{id}/files/{fileId}/segments.json - segment texts

async function storeAgent(agent: Agent): Promise<void> {
  const agentPath = `${COLLECTION}/${agent.id}`;
  
  const meta: StoredAgentMeta = {
    id: agent.id,
    name: agent.name,
    instructions: agent.instructions,
    repositoryEnabled: agent.repositoryEnabled,
    embedder: agent.embedder,
    skills: agent.skills,
    servers: agent.servers,
    tools: agent.tools,
    createdAt: agent.createdAt instanceof Date ? agent.createdAt.toISOString() : agent.createdAt as unknown as string,
    updatedAt: agent.updatedAt instanceof Date ? agent.updatedAt.toISOString() : agent.updatedAt as unknown as string,
  };
  
  await opfs.writeJson(`${agentPath}/agent.json`, meta);
  
  // Store each file separately
  if (agent.files) {
    for (const file of agent.files) {
      await storeAgentFile(agent.id, file);
    }
  }
  
  await opfs.upsertIndexEntry(COLLECTION, {
    id: agent.id,
    title: agent.name,
    updated: meta.updatedAt,
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
    uploadedAt: file.uploadedAt instanceof Date ? file.uploadedAt.toISOString() : file.uploadedAt as unknown as string,
    hasText: !!file.text,
    hasVectors: !!(file.segments && file.segments.length > 0),
    segmentCount: file.segments?.length || 0,
  };
  
  await opfs.writeJson(`${filePath}/metadata.json`, meta);
  
  if (file.text) {
    await opfs.writeText(`${filePath}/content.txt`, file.text);
  }
  
  if (file.segments && file.segments.length > 0) {
    const segmentTexts = file.segments.map(s => s.text);
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
    
    const blob = new Blob([buffer.buffer], { type: 'application/octet-stream' });
    await opfs.writeBlob(`${filePath}/embeddings.bin`, blob);
  }
}

async function loadAgent(id: string): Promise<Agent | undefined> {
  const agentPath = `${COLLECTION}/${id}`;
  
  const meta = await opfs.readJson<StoredAgentMeta>(`${agentPath}/agent.json`);
  if (!meta) return undefined;
  
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
    id: meta.id,
    name: meta.name,
    instructions: meta.instructions,
    repositoryEnabled: meta.repositoryEnabled ?? false,
    embedder: meta.embedder || '',
    skills: meta.skills || [],
    servers: meta.servers || [],
    tools: meta.tools || [],
    createdAt: new Date(meta.createdAt),
    updatedAt: new Date(meta.updatedAt),
    files: files.length > 0 ? files : undefined,
  };
}

async function loadAgentFile(agentId: string, fileId: string): Promise<RepositoryFile | undefined> {
  const filePath = `${COLLECTION}/${agentId}/files/${fileId}`;
  
  const meta = await opfs.readJson<StoredFileMeta>(`${filePath}/metadata.json`);
  if (!meta) return undefined;
  
  let text: string | undefined;
  if (meta.hasText) {
    text = await opfs.readText(`${filePath}/content.txt`);
  }
  
  let segments: Array<{ text: string; vector: number[] }> | undefined;
  if (meta.hasVectors && meta.segmentCount > 0) {
    const segmentTexts = await opfs.readJson<string[]>(`${filePath}/segments.json`);
    const vectorsBlob = await opfs.readBlob(`${filePath}/embeddings.bin`);
    
    if (segmentTexts && vectorsBlob) {
      const buffer = await vectorsBlob.arrayBuffer();
      const floats = new Float32Array(buffer);
      const vectorDim = floats[0];
      
      segments = [];
      for (let i = 0; i < meta.segmentCount; i++) {
        const start = 1 + i * vectorDim;
        const vector = Array.from(floats.slice(start, start + vectorDim));
        segments.push({
          text: segmentTexts[i] || '',
          vector,
        });
      }
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

// Migration: convert existing repositories + bridge servers + skills into agents
async function migrateFromLegacy(): Promise<Agent[]> {
  const migrated: Agent[] = [];
  
  try {
    const config = getConfig();
    const embedder = config.repository?.embedder || '';
    
    // Collect existing enabled skill IDs
    let enabledSkillIds: string[] = [];
    try {
      const skills = await opfs.loadAllSkills();
      enabledSkillIds = skills.filter(s => s.enabled).map(s => s.id);
    } catch { /* no skills */ }
    
    // Collect existing bridge servers
    let bridgeServers: BridgeServer[] = [];
    try {
      const raw = await opfs.readJson<BridgeServer[]>('bridge.json');
      if (raw && Array.isArray(raw)) {
        bridgeServers = raw;
      }
    } catch { /* no bridges */ }
    
    // Determine default-on tool IDs from config
    const defaultTools: string[] = [];
    if (config.internet) defaultTools.push('internet');
    if (config.interpreter) defaultTools.push('interpreter');
    if (config.renderer) defaultTools.push('renderer');
    
    // Load existing repositories
    const repoIndex = await opfs.readIndex('repositories');
    
    if (repoIndex.length > 0) {
      let firstAgent = true;
      
      for (const entry of repoIndex) {
        try {
          // Read repo metadata
          const repoMeta = await opfs.readJson<{
            id: string; name: string; embedder: string; instructions?: string;
            createdAt: string; updatedAt: string;
          }>(`repositories/${entry.id}/repository.json`);
          
          if (!repoMeta) continue;
          
          const agentId = crypto.randomUUID();
          
          // Copy files from repository to agent
          const fileIds = await opfs.listDirectories(`repositories/${entry.id}/files`);
          const files: RepositoryFile[] = [];
          
          for (const fileId of fileIds) {
            // Copy each file's folder contents
            const srcBase = `repositories/${entry.id}/files/${fileId}`;
            const dstBase = `${COLLECTION}/${agentId}/files/${fileId}`;
            
            const fileMeta = await opfs.readJson<StoredFileMeta>(`${srcBase}/metadata.json`);
            if (fileMeta) {
              await opfs.writeJson(`${dstBase}/metadata.json`, fileMeta);
              
              if (fileMeta.hasText) {
                const text = await opfs.readText(`${srcBase}/content.txt`);
                if (text) await opfs.writeText(`${dstBase}/content.txt`, text);
              }
              
              if (fileMeta.hasVectors) {
                const blob = await opfs.readBlob(`${srcBase}/embeddings.bin`);
                if (blob) await opfs.writeBlob(`${dstBase}/embeddings.bin`, blob);
                
                const segTexts = await opfs.readJson<string[]>(`${srcBase}/segments.json`);
                if (segTexts) await opfs.writeJson(`${dstBase}/segments.json`, segTexts);
              }
              
              files.push({
                id: fileMeta.id,
                name: fileMeta.name,
                status: fileMeta.status,
                progress: fileMeta.progress,
                error: fileMeta.error,
                uploadedAt: new Date(fileMeta.uploadedAt),
              });
            }
          }
          
          const agent: Agent = {
            id: agentId,
            name: repoMeta.name,
            instructions: repoMeta.instructions,
            repositoryEnabled: true,
            embedder: repoMeta.embedder || embedder,
            skills: firstAgent ? enabledSkillIds : [],
            servers: firstAgent ? bridgeServers : [],
            tools: defaultTools,
            createdAt: new Date(repoMeta.createdAt),
            updatedAt: new Date(repoMeta.updatedAt),
            files: files.length > 0 ? files : undefined,
          };
          
          await storeAgent(agent);
          migrated.push(agent);
          firstAgent = false;
        } catch (error) {
          console.error(`Failed to migrate repository ${entry.id}:`, error);
        }
      }
    } else if (bridgeServers.length > 0 || enabledSkillIds.length > 0) {
      // No repositories but we have bridge servers or skills — create a Default agent
      const agent: Agent = {
        id: crypto.randomUUID(),
        name: 'Default',
        repositoryEnabled: false,
        embedder,
        skills: enabledSkillIds,
        servers: bridgeServers,
        tools: defaultTools,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      await storeAgent(agent);
      migrated.push(agent);
    }
    
    // Mark migration complete
    await opfs.writeJson(`${COLLECTION}/.migrated`, { migratedAt: new Date().toISOString() });
    
    console.log(`[agent] Migration complete: ${migrated.length} agents created`);
  } catch (error) {
    console.error('[agent] Migration failed:', error);
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
          await opfs.writeJson(`${COLLECTION}/.migrated`, { migratedAt: new Date().toISOString() });
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
          const foundAgent = loadedAgents.find(a => a.id === savedCurrentAgentId);
          if (foundAgent) {
            setCurrentAgent(foundAgent);
          }
        }
      } catch (error) {
        console.error('Failed to load agents:', error);
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
        const agent = agentsRef.current.find(a => a.id === id);
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
        const agent = refs.current.find(a => a.id === id);
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
    const config = getConfig();

    // Determine default-on tool IDs from config
    const defaultTools: string[] = [];
    if (config.internet) defaultTools.push('internet');
    if (config.interpreter) defaultTools.push('interpreter');
    if (config.renderer) defaultTools.push('renderer');

    const newAgent: Agent = {
      id: crypto.randomUUID(),
      name,
      repositoryEnabled: false,
      embedder: config.repository?.embedder || '',
      skills: [],
      servers: [],
      tools: defaultTools,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    setAgents(prev => [...prev, newAgent]);
    setCurrentAgent(newAgent);
    
    try {
      await storeAgent(newAgent);
    } catch (error) {
      console.error('Error saving new agent:', error);
    }
    
    return newAgent;
  }, []);

  const updateAgent = useCallback((id: string, updates: Partial<Omit<Agent, 'id' | 'createdAt'>>) => {
    setAgents(prev => {
      const updated = prev.map(agent => 
        agent.id === id 
          ? { ...agent, ...updates, updatedAt: new Date() }
          : agent
      );
      
      setTimeout(() => scheduleSave(id), 0);
      
      return updated;
    });
    
    if (currentAgent?.id === id) {
      setCurrentAgent(prev => prev ? { ...prev, ...updates, updatedAt: new Date() } : null);
    }
  }, [currentAgent, scheduleSave]);

  const deleteAgent = useCallback(async (id: string) => {
    setAgents(prev => prev.filter(agent => agent.id !== id));
    
    if (currentAgent?.id === id) {
      setCurrentAgent(null);
    }
    
    try {
      await removeAgent(id);
    } catch (error) {
      console.error(`Error deleting agent ${id}:`, error);
    }
  }, [currentAgent]);

  // File operations (repository files within an agent)
  const upsertFile = useCallback((agentId: string, file: RepositoryFile) => {
    setAgents(prev => {
      const updated = prev.map(agent => {
        if (agent.id !== agentId) return agent;
        const files = agent.files ? [...agent.files] : [];
        const existingIdx = files.findIndex(f => f.id === file.id);
        if (existingIdx !== -1) {
          files[existingIdx] = file;
        } else {
          files.push(file);
        }
        return { ...agent, files, updatedAt: new Date() };
      });
      
      setTimeout(() => scheduleSave(agentId), 0);
      
      return updated;
    });
  }, [scheduleSave]);

  const removeFile = useCallback((agentId: string, fileId: string) => {
    setAgents(prev => {
      const updated = prev.map(agent => {
        if (agent.id !== agentId) return agent;
        const files = agent.files ? agent.files.filter(f => f.id !== fileId) : [];
        return { ...agent, files, updatedAt: new Date() };
      });
      
      removeAgentFile(agentId, fileId).catch(error => {
        console.error(`Error deleting agent file ${fileId}:`, error);
      });
      
      setTimeout(() => scheduleSave(agentId), 0);
      
      return updated;
    });
  }, [scheduleSave]);

  // Bridge server operations within an agent
  const addServer = useCallback((agentId: string, serverData: Omit<BridgeServer, 'id'>): BridgeServer => {
    const newServer: BridgeServer = {
      ...serverData,
      id: crypto.randomUUID(),
    };
    
    setAgents(prev => {
      const updated = prev.map(agent => {
        if (agent.id !== agentId) return agent;
        return { ...agent, servers: [...agent.servers, newServer], updatedAt: new Date() };
      });
      setTimeout(() => scheduleSave(agentId), 0);
      return updated;
    });
    
    if (currentAgent?.id === agentId) {
      setCurrentAgent(prev => prev ? { ...prev, servers: [...prev.servers, newServer], updatedAt: new Date() } : null);
    }
    
    return newServer;
  }, [currentAgent, scheduleSave]);

  const updateServer = useCallback((agentId: string, serverId: string, updates: Partial<Omit<BridgeServer, 'id'>>) => {
    setAgents(prev => {
      const updated = prev.map(agent => {
        if (agent.id !== agentId) return agent;
        return {
          ...agent,
          servers: agent.servers.map(s => s.id === serverId ? { ...s, ...updates } : s),
          updatedAt: new Date(),
        };
      });
      setTimeout(() => scheduleSave(agentId), 0);
      return updated;
    });
    
    if (currentAgent?.id === agentId) {
      setCurrentAgent(prev => prev ? {
        ...prev,
        servers: prev.servers.map(s => s.id === serverId ? { ...s, ...updates } : s),
        updatedAt: new Date(),
      } : null);
    }
  }, [currentAgent, scheduleSave]);

  const removeServer = useCallback((agentId: string, serverId: string) => {
    setAgents(prev => {
      const updated = prev.map(agent => {
        if (agent.id !== agentId) return agent;
        return {
          ...agent,
          servers: agent.servers.filter(s => s.id !== serverId),
          updatedAt: new Date(),
        };
      });
      setTimeout(() => scheduleSave(agentId), 0);
      return updated;
    });
    
    if (currentAgent?.id === agentId) {
      setCurrentAgent(prev => prev ? {
        ...prev,
        servers: prev.servers.filter(s => s.id !== serverId),
        updatedAt: new Date(),
      } : null);
    }
  }, [currentAgent, scheduleSave]);

  const toggleServer = useCallback((agentId: string, serverId: string) => {
    setAgents(prev => {
      const updated = prev.map(agent => {
        if (agent.id !== agentId) return agent;
        return {
          ...agent,
          servers: agent.servers.map(s => s.id === serverId ? { ...s, enabled: !s.enabled } : s),
          updatedAt: new Date(),
        };
      });
      setTimeout(() => scheduleSave(agentId), 0);
      return updated;
    });
    
    if (currentAgent?.id === agentId) {
      setCurrentAgent(prev => prev ? {
        ...prev,
        servers: prev.servers.map(s => s.id === serverId ? { ...s, enabled: !s.enabled } : s),
        updatedAt: new Date(),
      } : null);
    }
  }, [currentAgent, scheduleSave]);

  const toggleAgentDrawer = useCallback(() => {
    setShowAgentDrawer(prev => !prev);
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

  return (
    <AgentContext.Provider value={value}>
      {children}
    </AgentContext.Provider>
  );
}
