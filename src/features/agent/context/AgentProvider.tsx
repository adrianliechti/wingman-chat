import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import type { Agent, BridgeServer } from "@/features/agent/types/agent";
import { getSavedModelId } from "@/features/chat/hooks/useModels";
import type { RepositoryFile } from "@/features/repository/types/repository";
import { clearMcpOAuthStorage } from "@/features/settings/lib/mcpAuth";
import { usePersistentCollection } from "@/shared/hooks/usePersistentCollection";
import { loadAgents, storeAgent, removeAgent } from "../lib/agentStorage";
import { AgentContext } from "./AgentContext";

const AGENT_STORAGE_KEY = "app_agent";
const storage = { load: loadAgents, store: storeAgent, remove: removeAgent };

export function AgentProvider({ children }: { children: ReactNode }) {
  const { items: agents, isLoaded, create, update, remove } = usePersistentCollection(storage);
  const [currentId, setCurrentId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(AGENT_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  // Selection stores identity only; files, tools and servers always come from
  // the same authoritative agent snapshot that is being persisted.
  const currentAgent = agents.find((agent) => agent.id === currentId) ?? null;
  const [showAgentDrawer, setShowAgentDrawer] = useState(false);
  const [agentDrawerView, setAgentDrawerView] = useState<"list" | "details">("list");

  useEffect(() => {
    if (!isLoaded) return;
    try {
      if (currentId) localStorage.setItem(AGENT_STORAGE_KEY, currentId);
      else localStorage.removeItem(AGENT_STORAGE_KEY);
    } catch (error) {
      console.warn("Could not save agent selection:", error);
    }
  }, [currentId, isLoaded]);

  const setCurrentAgent = useCallback((agent: Agent | null) => setCurrentId(agent?.id ?? null), []);
  const createAgent = useCallback(
    (name: string, initialData?: Partial<Omit<Agent, "id" | "name">>): Promise<Agent> => {
      const agent: Agent = {
        ...initialData,
        id: crypto.randomUUID(),
        name,
        model: initialData?.model ?? getSavedModelId() ?? undefined,
        skills: initialData?.skills ?? [],
        servers: initialData?.servers ?? [],
        tools: initialData?.tools ?? [],
      };
      setCurrentId(agent.id);
      return create(agent);
    },
    [create],
  );

  const updateAgent = useCallback(
    (id: string, updates: Partial<Omit<Agent, "id">>) => {
      update(id, (agent) => ({ ...agent, ...updates }));
    },
    [update],
  );

  const deleteAgent = useCallback(
    async (id: string) => {
      setCurrentId((current) => (current === id ? null : current));
      await remove(id);
    },
    [remove],
  );

  const upsertFile = useCallback(
    (id: string, file: RepositoryFile) => {
      update(id, (agent) => {
        const files = [...(agent.files ?? [])];
        const index = files.findIndex((current) => current.id === file.id);
        if (index < 0) files.push(file);
        else files[index] = { ...files[index], ...file };
        return { ...agent, files };
      });
    },
    [update],
  );

  const removeFile = useCallback(
    (id: string, fileId: string) => {
      update(id, (agent) => ({ ...agent, files: agent.files?.filter((file) => file.id !== fileId) }));
    },
    [update],
  );

  const addServer = useCallback(
    (id: string, data: Omit<BridgeServer, "id">): BridgeServer => {
      const server = { ...data, id: crypto.randomUUID() };
      update(id, (agent) => ({ ...agent, servers: [...agent.servers, server] }));
      return server;
    },
    [update],
  );

  const updateServer = useCallback(
    (id: string, serverId: string, changes: Partial<Omit<BridgeServer, "id">>) => {
      update(id, (agent) => ({
        ...agent,
        servers: agent.servers.map((server) =>
          server.id === serverId ? { ...server, ...changes, id: serverId } : server,
        ),
      }));
    },
    [update],
  );

  const removeServer = useCallback(
    (id: string, serverId: string) => {
      clearMcpOAuthStorage(serverId);
      update(id, (agent) => ({ ...agent, servers: agent.servers.filter((server) => server.id !== serverId) }));
    },
    [update],
  );

  const toggleServer = useCallback(
    (id: string, serverId: string) => {
      update(id, (agent) => ({
        ...agent,
        servers: agent.servers.map((server) =>
          server.id === serverId ? { ...server, enabled: !server.enabled } : server,
        ),
      }));
    },
    [update],
  );

  const toggleAgentDrawer = useCallback(() => {
    if (!showAgentDrawer) setAgentDrawerView("list");
    setShowAgentDrawer(!showAgentDrawer);
  }, [showAgentDrawer]);

  return (
    <AgentContext
      value={{
        agents,
        currentAgent,
        createAgent,
        updateAgent,
        deleteAgent,
        setCurrentAgent,
        showAgentDrawer,
        setShowAgentDrawer,
        toggleAgentDrawer,
        agentDrawerView,
        setAgentDrawerView,
        upsertFile,
        removeFile,
        addServer,
        updateServer,
        removeServer,
        toggleServer,
      }}
    >
      {children}
    </AgentContext>
  );
}
