import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { getConfig } from "../config";
import { MCPClient } from "../lib/mcp";
import { useBridgeProvider } from "../hooks/useBridgeProvider";
import { useInternetProvider } from "../hooks/useInternetProvider";
import { useInterpreterProvider } from "../hooks/useInterpreterProvider";
import { useRendererProvider } from "../hooks/useRendererProvider";
import { ToolsContext } from "./ToolsContext";
import type { ToolsContextValue } from "./ToolsContext";
import type { ToolProvider } from "../types/chat";
import { ProviderState } from "../types/chat";

interface ToolsProviderProps {
  children: React.ReactNode;
}

export function ToolsProvider({ children }: ToolsProviderProps) {
  const config = getConfig();
  const mcps = useMemo(() => config.mcps || [], [config.mcps]);
  
  // State management for all providers
  const [providerStates, setProviderStates] = useState<Map<string, ProviderState>>(new Map());
  
  // Create MCP clients
  const [mcpClients] = useState<MCPClient[]>(() => 
    mcps.map(mcp => new MCPClient(mcp.id, mcp.url, mcp.name, mcp.description))
  );
  const clientsRef = useRef<MCPClient[]>(mcpClients);

  const bridgeProvider = useBridgeProvider();
  const internetProvider = useInternetProvider();
  const interpreterProvider = useInterpreterProvider();
  const rendererProvider = useRendererProvider();

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
    
    if (interpreterProvider) {
      list.push(interpreterProvider);
    }
    
    // Add MCP clients (they are already ToolProviders)
    list.push(...mcpClients);
    
    // Add bridge provider if available
    if (bridgeProvider) {
      list.push(bridgeProvider);
    }
    
    // Note: artifacts and repository providers are added conditionally in useChatContext
    
    return list;
  }, [
    internetProvider,
    rendererProvider,
    interpreterProvider,
    mcpClients,
    bridgeProvider,
  ]);

  // Helper functions for state management
  const getProviderState = useCallback((id: string): ProviderState => {
    return providerStates.get(id) ?? ProviderState.Disconnected;
  }, [providerStates]);

  const setProviderEnabled = useCallback(async (id: string, enabled: boolean) => {
    // Find the provider
    const mcpClient = mcpClients.find(c => c.id === id);
    
    if (mcpClient) {
      // For MCP clients, connect/disconnect
      if (enabled) {
        // Set initializing state before connecting
        setProviderStates(prev => new Map(prev).set(id, ProviderState.Initializing));
        try {
          await mcpClient.connect();
          // Success: set connected
          setProviderStates(prev => new Map(prev).set(id, ProviderState.Connected));
        } catch (error) {
          console.error(`Failed to connect MCP client ${id}:`, error);
          // Failure: set failed state
          setProviderStates(prev => new Map(prev).set(id, ProviderState.Failed));
        }
      } else {
        await mcpClient.disconnect();
        // Set disconnected state
        setProviderStates(prev => new Map(prev).set(id, ProviderState.Disconnected));
      }
    } else {
      // For local providers, just update the state
      if (enabled) {
        setProviderStates(prev => new Map(prev).set(id, ProviderState.Connected));
      } else {
        setProviderStates(prev => new Map(prev).set(id, ProviderState.Disconnected));
      }
    }
  }, [mcpClients]);

  const value: ToolsContextValue = {
    providers,
    getProviderState,
    setProviderEnabled,
  };

  return <ToolsContext.Provider value={value}>{children}</ToolsContext.Provider>;
}
