import { createContext } from "react";
import type { MCP, Tool } from "../types/chat";
import type { MCPConnection } from "../hooks/useMCP";

export interface ToolsContextType {
  mcps: MCP[];
  connectedMCPs: Map<string, MCPConnection>;
  connectingMCPs: Set<string>;
  
  connectMCP: (id: string) => Promise<void>;
  disconnectMCP: (id: string) => Promise<void>;
  toggleMCP: (id: string) => Promise<void>;
  
  isConnected: (id: string) => boolean;
  isConnecting: (id: string) => boolean;
  
  getAllTools: () => Tool[];
}

export const ToolsContext = createContext<ToolsContextType | undefined>(undefined);
