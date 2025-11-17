import { useMemo } from "react";
import { useMCP } from "../hooks/useMCP";
import { useArtifacts } from "../hooks/useArtifacts";
import { useBridge } from "../hooks/useBridge";
import { useSearchProvider } from "../hooks/useSearchProvider";
import { useInterpreterProvider } from "../hooks/useInterpreterProvider";
import { useRendererProvider } from "../hooks/useRendererProvider";
import { useRepository } from "../hooks/useRepository";
import { useRepositories } from "../hooks/useRepositories";
import { ToolsContext } from "./ToolsContext";
import type { ToolsContextType } from "./ToolsContext";
import type { ToolProvider } from "../types/chat";

interface ToolsProviderProps {
  children: React.ReactNode;
}

export function ToolsProvider({ children }: ToolsProviderProps) {
  const mcpHook = useMCP();
  const artifacts = useArtifacts();
  const { bridgeProvider } = useBridge();
  const searchProvider = useSearchProvider();
  const interpreterProvider = useInterpreterProvider();
  const rendererProvider = useRendererProvider();
  const { currentRepository } = useRepositories();
  const { repositoryProvider } = useRepository(currentRepository?.id || '', 'auto');

  // Build all providers with UI metadata
  const providers = useMemo<ToolProvider[]>(() => {
    const list: ToolProvider[] = [];
    
    // Add local providers (only if available in config)
    if (searchProvider) {
      list.push({
        ...searchProvider,
        icon: 'Globe',
      });
    }
    
    if (rendererProvider) {
      list.push({
        ...rendererProvider,
        icon: 'Image',
      });
    }
    
    if (artifacts.isAvailable) {
      const provider = artifacts.artifactsProvider();
      if (provider) {
        list.push({
          ...provider,
          icon: 'Table',
          setEnabled: (enabled) => artifacts.setEnabled(enabled),
        });
      }
    }
    
    if (interpreterProvider) {
      list.push({
        ...interpreterProvider,
        icon: 'Package',
      });
    }
    
    // Add MCP providers
    mcpHook.mcps.forEach((mcp) => {
      const connection = mcpHook.connectedMCPs.get(mcp.id);
      if (connection) {
        list.push({
          id: connection.mcp.id,
          name: connection.mcp.name,
          description: connection.mcp.description,
          icon: 'Rocket',
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
          icon: 'Rocket',
          tools: async () => [],
          isEnabled: false,
          isInitializing: mcpHook.isConnecting(mcp.id),
          setEnabled: () => mcpHook.toggleMCP(mcp.id),
        });
      }
    });
    
    // Add bridge provider if available
    const bridge = bridgeProvider();
    if (bridge) {
      list.push(bridge);
    }
    
    // Add repository provider if available
    const repo = repositoryProvider();
    if (repo) {
      list.push(repo);
    }
    
    return list;
  }, [
    searchProvider,
    rendererProvider,
    interpreterProvider,
    artifacts,
    mcpHook,
    bridgeProvider,
    repositoryProvider,
  ]);

  const value: ToolsContextType = {
    providers,
  };

  return <ToolsContext.Provider value={value}>{children}</ToolsContext.Provider>;
}
