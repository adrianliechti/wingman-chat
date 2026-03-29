export type { RepositoryFile } from "@/features/repository/types/repository";

export interface BridgeServer {
  id: string;

  name: string;
  description: string;

  url: string;

  icon?: string;
  headers?: Record<string, string>;

  enabled: boolean;
}

export interface Agent {
  id: string;

  name: string;
  description?: string;

  model?: string; // model ID override for this agent
  instructions?: string;

  files?: import("@/features/repository/types/repository").RepositoryFile[];
  skills: string[]; // names referencing global skill library

  tools: string[]; // active built-in tool IDs: "internet", "renderer"
  servers: BridgeServer[]; // per-agent MCP server definitions

  memory?: boolean; // enable persistent memory via MEMORY.md
}
