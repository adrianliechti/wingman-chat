import type { Context } from "@opentelemetry/api";

export type AgentContext = Context;

export interface AgentIdentity {
  id: string;
  name: string;
  kind: "configured" | "delegated" | "builtin";
}

/** Identifiers only: no prompts, credentials, URLs or tool payloads. */
export interface ToolTelemetry {
  agent?: AgentIdentity;
  serverId?: string;
  serverName?: string;
  pluginId?: string;
}
