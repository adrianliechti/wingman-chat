import { useMemo } from "react";
import { Rocket } from "lucide-react";
import { useMCP } from "../hooks/useMCP";
import { useArtifactsProvider } from "../hooks/useArtifactsProvider";
import { useBridgeProvider } from "../hooks/useBridgeProvider";
import { useInternetProvider } from "../hooks/useInternetProvider";
import { useInterpreterProvider } from "../hooks/useInterpreterProvider";
import { useRendererProvider } from "../hooks/useRendererProvider";
import { useRepositoryProvider } from "../hooks/useRepositoryProvider";
import { useRepositories } from "../hooks/useRepositories";
import { ToolsContext } from "./ToolsContext";
import type { ToolsContextType } from "./ToolsContext";
import type { ToolProvider } from "../types/chat";

interface ToolsProviderProps {
  children: React.ReactNode;
}

export function ToolsProvider({ children }: ToolsProviderProps) {
  const mcpHook = useMCP();
  const artifactsProvider = useArtifactsProvider();
  const bridgeProvider = useBridgeProvider();
  const internetProvider = useInternetProvider();
  const interpreterProvider = useInterpreterProvider();
  const rendererProvider = useRendererProvider();
  const { currentRepository } = useRepositories();
  const repositoryProvider = useRepositoryProvider(currentRepository?.id || '', 'auto');

  // Build all providers with UI metadata
  const providers = useMemo<ToolProvider[]>(() => {
    const list: ToolProvider[] = [];
    
    // Add local providers (only if available in config)
    if (internetProvider) {
      list.push(internetProvider);
    }
    
    if (rendererProvider) {
      list.push(rendererProvider);
    }
    
    if (artifactsProvider) {
      list.push(artifactsProvider);
    }
    
    if (interpreterProvider) {
      list.push(interpreterProvider);
    }
    
    // Add MCP providers
    mcpHook.mcps.forEach((mcp) => {
      const connection = mcpHook.connectedMCPs.get(mcp.id);
      if (connection) {
        list.push({
          id: connection.mcp.id,
          name: connection.mcp.name,
          description: connection.mcp.description,
          icon: Rocket,
          instructions: connection.instructions,
          tools: async () => connection.tools,
          isEnabled: true,
          isInitializing: mcpHook.isConnecting(mcp.id),
          setEnabled: () => mcpHook.toggleMCP(mcp.id),
        });
      } else {
        // Add disconnected MCP for UI toggle
        list.push({
          id: mcp.id,
          name: mcp.name,
          description: mcp.description,
          icon: Rocket,
          tools: async () => [],
          isEnabled: false,
          isInitializing: mcpHook.isConnecting(mcp.id),
          setEnabled: () => mcpHook.toggleMCP(mcp.id),
        });
      }
    });
    
    // Add bridge provider if available
    if (bridgeProvider) {
      list.push(bridgeProvider);
    }
    
    // Add repository provider if available
    if (repositoryProvider) {
      list.push(repositoryProvider);
    }
    
    return list;
  }, [
    internetProvider,
    rendererProvider,
    interpreterProvider,
    artifactsProvider,
    mcpHook,
    bridgeProvider,
    repositoryProvider,
  ]);

  const value: ToolsContextType = {
    providers,
  };

  return <ToolsContext.Provider value={value}>{children}</ToolsContext.Provider>;
}
