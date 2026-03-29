import { createContext } from "react";
import type { Agent, BridgeServer } from "@/features/agent/types/agent";
import type { RepositoryFile } from "@/features/repository/types/repository";

export interface AgentContextType {
  agents: Agent[];
  currentAgent: Agent | null;
  createAgent: (name: string) => Promise<Agent>;
  updateAgent: (id: string, updates: Partial<Omit<Agent, "id">>) => void;
  deleteAgent: (id: string) => Promise<void>;
  setCurrentAgent: (agent: Agent | null) => void;
  showAgentDrawer: boolean;
  setShowAgentDrawer: (show: boolean) => void;
  toggleAgentDrawer: () => void;
  // File operations (repository files within an agent)
  upsertFile: (agentId: string, file: RepositoryFile) => void;
  removeFile: (agentId: string, fileId: string) => void;
  // Bridge server operations within an agent
  addServer: (agentId: string, server: Omit<BridgeServer, "id">) => BridgeServer;
  updateServer: (agentId: string, serverId: string, updates: Partial<Omit<BridgeServer, "id">>) => void;
  removeServer: (agentId: string, serverId: string) => void;
  toggleServer: (agentId: string, serverId: string) => void;
}

export const AgentContext = createContext<AgentContextType | undefined>(undefined);
