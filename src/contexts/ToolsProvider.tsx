import { useCallback } from "react";
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
  const { artifactsProvider } = useArtifacts();
  const { bridgeProvider } = useBridge();
  const { searchProvider } = useSearch();
  const { interpreterProvider } = useInterpreter();
  const { rendererProvider } = useRenderer();
  const { currentRepository } = useRepositories();
  const { repositoryProvider } = useRepository(currentRepository?.id || '', 'auto');

  // Combine local providers with MCP providers
  const getProviders = useCallback((): ToolProvider[] => {
    const providers: ToolProvider[] = [];
    
    // Add local providers if enabled
    const artifactsProviderInstance = artifactsProvider();
    if (artifactsProviderInstance) {
      providers.push(artifactsProviderInstance);
    }
    
    const bridgeProviderInstance = bridgeProvider();
    if (bridgeProviderInstance) {
      providers.push(bridgeProviderInstance);
    }
    
    const searchProviderInstance = searchProvider();
    if (searchProviderInstance) {
      providers.push(searchProviderInstance);
    }
    
    const interpreterProviderInstance = interpreterProvider();
    if (interpreterProviderInstance) {
      providers.push(interpreterProviderInstance);
    }
    
    const rendererProviderInstance = rendererProvider();
    if (rendererProviderInstance) {
      providers.push(rendererProviderInstance);
    }
    
    const repositoryProviderInstance = repositoryProvider();
    if (repositoryProviderInstance) {
      providers.push(repositoryProviderInstance);
    }
    
    // Add MCP providers
    const mcpProviders = mcpHook.getAllProviders();
    providers.push(...mcpProviders);
    
    return providers;
  }, [
    artifactsProvider,
    bridgeProvider,
    searchProvider,
    interpreterProvider,
    rendererProvider,
    repositoryProvider,
    mcpHook,
  ]);

  const value: ToolsContextType = {
    mcps: mcpHook.mcps,
    connectedMCPs: mcpHook.connectedMCPs,
    connectingMCPs: mcpHook.connectingMCPs,
    connectMCP: mcpHook.connectMCP,
    disconnectMCP: mcpHook.disconnectMCP,
    toggleMCP: mcpHook.toggleMCP,
    isConnected: mcpHook.isConnected,
    isConnecting: mcpHook.isConnecting,
    getProviders,
  };

  return <ToolsContext.Provider value={value}>{children}</ToolsContext.Provider>;
}
