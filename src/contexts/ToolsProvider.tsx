import { useState, useEffect, useRef, useMemo } from "react";
import { getConfig } from "../config";
import { MCPClient } from "../lib/mcp";
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
  const config = getConfig();
  const mcps = useMemo(() => config.mcps || [], [config.mcps]);
  
  const [mcpClients] = useState<MCPClient[]>(() => 
    mcps.map(mcp => new MCPClient(mcp.id, mcp.url, mcp.name, mcp.description))
  );
  const clientsRef = useRef<MCPClient[]>(mcpClients);

  const artifactsProvider = useArtifactsProvider();
  const bridgeProvider = useBridgeProvider();
  const internetProvider = useInternetProvider();
  const interpreterProvider = useInterpreterProvider();
  const rendererProvider = useRendererProvider();
  const { currentRepository } = useRepositories();
  const repositoryProvider = useRepositoryProvider(currentRepository?.id || '', 'auto');

  // Cleanup on unmount
  useEffect(() => {
    const clients = clientsRef.current;
    return () => {
      // Disconnect all clients on unmount
      clients.forEach(client => {
        client.disconnect().catch(console.error);
      });
    };
  }, []);

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
    
    // Add MCP clients (they are already ToolProviders)
    list.push(...mcpClients);
    
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
    mcpClients,
    bridgeProvider,
    repositoryProvider,
  ]);

  const value: ToolsContextType = {
    providers,
  };

  return <ToolsContext.Provider value={value}>{children}</ToolsContext.Provider>;
}
