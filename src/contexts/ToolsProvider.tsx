import { useMemo } from "react";
import { useMCP } from "../hooks/useMCP";
import { useArtifacts } from "../hooks/useArtifacts";
import { useBridge } from "../hooks/useBridge";
import { useSearch } from "../hooks/useSearch";
import { useInterpreter } from "../hooks/useInterpreter";
import { useRenderer } from "../hooks/useRenderer";
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
  const search = useSearch();
  const interpreter = useInterpreter();
  const renderer = useRenderer();
  const { currentRepository } = useRepositories();
  const { repositoryProvider } = useRepository(currentRepository?.id || '', 'auto');

  // Build all providers with UI metadata
  const providers = useMemo<ToolProvider[]>(() => {
    const list: ToolProvider[] = [];
    
    // Add local providers (only if available in config)
    if (search.isAvailable) {
      const provider = search.searchProvider();
      if (provider) {
        list.push({
          ...provider,
          icon: 'Globe',
          setEnabled: (enabled) => search.setEnabled(enabled),
        });
      }
    }
    
    if (renderer.isAvailable) {
      const provider = renderer.rendererProvider();
      if (provider) {
        list.push({
          ...provider,
          icon: 'Image',
          setEnabled: (enabled) => renderer.setEnabled(enabled),
        });
      }
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
    
    if (interpreter.isAvailable) {
      const provider = interpreter.interpreterProvider();
      if (provider) {
        list.push({
          ...provider,
          icon: 'Package',
          setEnabled: (enabled) => interpreter.setEnabled(enabled),
        });
      }
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
    search,
    renderer,
    artifacts,
    interpreter,
    mcpHook,
    bridgeProvider,
    repositoryProvider,
  ]);

  const value: ToolsContextType = {
    providers,
  };

  return <ToolsContext.Provider value={value}>{children}</ToolsContext.Provider>;
}
