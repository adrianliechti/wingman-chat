import { useMCP } from "../hooks/useMCP";
import { ToolsContext } from "./ToolsContext";
import type { ToolsContextType } from "./ToolsContext";

interface ToolsProviderProps {
  children: React.ReactNode;
}

export function ToolsProvider({ children }: ToolsProviderProps) {
  const mcpHook = useMCP();

  const value: ToolsContextType = {
    mcps: mcpHook.mcps,
    connectedMCPs: mcpHook.connectedMCPs,
    connectingMCPs: mcpHook.connectingMCPs,
    connectMCP: mcpHook.connectMCP,
    disconnectMCP: mcpHook.disconnectMCP,
    toggleMCP: mcpHook.toggleMCP,
    isConnected: mcpHook.isConnected,
    isConnecting: mcpHook.isConnecting,
    getAllTools: mcpHook.getAllTools,
  };

  return <ToolsContext.Provider value={value}>{children}</ToolsContext.Provider>;
}
