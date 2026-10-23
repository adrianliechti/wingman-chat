import { createContext } from "react";
import type { Agent } from "@/features/agent/types/agent";
import type { RepositoryFile } from "@/features/repository/types/repository";

export interface AgentContextType {
  agents: Agent[];
  currentAgent: Agent | null;
  createAgent: (name: string, initialData?: Partial<Omit<Agent, "id" | "name">>) => Promise<Agent>;
  updateAgent: (id: string, updates: Partial<Omit<Agent, "id">>) => void;
  deleteAgent: (id: string) => Promise<void>;
  setCurrentAgent: (agent: Agent | null) => void;
  showAgentDrawer: boolean;
  setShowAgentDrawer: (show: boolean) => void;
  toggleAgentDrawer: () => void;
  agentDrawerView: "list" | "details";
  setAgentDrawerView: (view: "list" | "details") => void;
  // File operations (repository files within an agent)
  upsertFile: (agentId: string, file: RepositoryFile) => void;
  removeFile: (agentId: string, fileId: string) => void;
  getAgent: (agentId: string) => Agent | undefined;
  addFile: (agentId: string, file: File) => Promise<void>;
  reindexFile: (agentId: string, fileId: string) => Promise<void>;
}

export const AgentContext = createContext<AgentContextType | undefined>(undefined);
