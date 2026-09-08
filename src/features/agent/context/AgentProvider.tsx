import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Agent, BridgeServer } from "@/features/agent/types/agent";
import { getSavedModelId } from "@/features/chat/hooks/useModels";
import type { RepositoryFile } from "@/features/repository/types/repository";
import { clearMcpOAuthStorage } from "@/features/settings/lib/mcpAuth";
import { usePersistentCollection } from "@/shared/hooks/usePersistentCollection";
import { getConfig } from "@/shared/config";
import { convertFileToText } from "@/shared/lib/convert";
import { FileIngestion } from "@/features/repository/lib/file-ingestion";
import { loadAgents, storeAgent, removeAgent } from "../lib/agentStorage";
import { AgentContext } from "./AgentContext";

const AGENT_STORAGE_KEY = "app_agent";
const storage = { load: loadAgents, store: storeAgent, remove: removeAgent };

export function AgentProvider({ children }: { children: ReactNode }) {
  const {
    items: agents,
    isLoaded,
    create,
    update,
    remove,
    getItems,
    flush,
  } = usePersistentCollection(storage);
  const ownerActive = useRef(true);
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
        plugins: initialData?.plugins ?? [],
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

  const getAgent = useCallback(
    (id: string) => (ownerActive.current ? getItems().find((agent) => agent.id === id) : undefined),
    [getItems],
  );
  const [ingestion] = useState(
    () =>
      new FileIngestion({
        getFiles: (id) => {
          const agent = getAgent(id);
          return agent ? (agent.files ?? []) : undefined;
        },
        insertFile: upsertFile,
        updateFile: (agentId, fileId, changes) =>
          update(agentId, (agent) => ({
            ...agent,
            files: agent.files?.map((file) =>
              file.id === fileId ? { ...file, ...changes, id: fileId } : file,
            ),
          })),
        flush,
        getModel: () => getConfig().repository?.embedder ?? "",
        convert: (file, signal) => convertFileToText(file, { signal }),
        segment: (text, signal) => getConfig().client.segmentText(text, { signal }),
        embed: (model, text, signal) => getConfig().client.embedText(model, text, { signal }),
      }),
  );
  useEffect(() => {
    ownerActive.current = true;
    return () => {
      ownerActive.current = false;
      ingestion.cancelAll();
    };
  }, [ingestion]);

  const addFile = useCallback(
    (agentId: string, file: File) => ingestion.addFile(agentId, file),
    [ingestion],
  );
  const reindexFile = useCallback(
    (agentId: string, fileId: string) => ingestion.reindexFile(agentId, fileId),
    [ingestion],
  );
  const deleteAgent = useCallback(
    async (id: string) => {
      ingestion.cancelRepository(id);
      setCurrentId((current) => (current === id ? null : current));
      await remove(id);
    },
    [ingestion, remove],
  );

  const removeFile = useCallback(
    (id: string, fileId: string) => {
      ingestion.cancelFile(id, fileId);
      update(id, (agent) => ({
        ...agent,
        files: agent.files?.filter((file) => file.id !== fileId),
      }));
    },
    [ingestion, update],
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
      update(id, (agent) => ({
        ...agent,
        servers: agent.servers.filter((server) => server.id !== serverId),
      }));
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
        getAgent,
        addFile,
        reindexFile,
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
