export type { RepositoryFile } from '@/features/repository/types/repository';

export interface BridgeServer {
  id: string;
  name: string;
  description: string;
  url: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

export interface Agent {
  id: string;
  name: string;

  instructions?: string;

  repositoryEnabled: boolean;
  embedder: string;

  skills: string[]; // IDs referencing global skill library
  servers: BridgeServer[]; // per-agent MCP server definitions
  tools: string[]; // active built-in tool IDs: "internet", "interpreter", "renderer"

  createdAt: Date;
  updatedAt: Date;

  files?: import('@/features/repository/types/repository').RepositoryFile[];
}
