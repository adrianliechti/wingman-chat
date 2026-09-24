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

  model?: string; // model ID override for this agent
  effort?: import("@/shared/types/chat").ReasoningEffort; // reasoning effort; unset uses the model default
  verbosity?: NonNullable<import("@/shared/types/chat").Model["verbosity"]>; // response length; unset uses the model default
  instructions?: string;

  files?: import("@/features/repository/types/repository").RepositoryFile[];
  skills: string[]; // names referencing global skill library
  plugins: string[]; // ids referencing installed plugins

  tools: string[]; // active built-in tool IDs: "internet", "canvas"
  servers: BridgeServer[]; // per-agent MCP server definitions

  memory?: boolean; // enable the persistent /.memory/ file mount
}
