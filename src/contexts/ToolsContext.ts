import { createContext } from "react";
import type { MCP, ToolProvider } from "../types/chat";
import type { MCPConnection } from "../hooks/useMCP";

export interface ToolsContextType {
  // MCP management
  mcps: MCP[];
  connectedMCPs: Map<string, MCPConnection>;
  connectingMCPs: Set<string>;
  
  connectMCP: (id: string) => Promise<void>;
  disconnectMCP: (id: string) => Promise<void>;
  toggleMCP: (id: string) => Promise<void>;
  
  isConnected: (id: string) => boolean;
  isConnecting: (id: string) => boolean;
  
  // Unified provider access (MCP + local providers)
  getProviders: () => ToolProvider[];
}

export const ToolsContext = createContext<ToolsContextType | undefined>(undefined);
