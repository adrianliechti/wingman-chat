import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { getConfig } from "@/shared/config";
import { MCPClient } from "@/features/settings/lib/mcp";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { useAgentProviders } from "@/features/agent/hooks/useAgentProviders";
import { useInternetProvider } from "@/features/research/hooks/useInternetProvider";
import { useRendererProvider } from "@/features/renderer/hooks/useRendererProvider";
import { ToolsContext } from "./ToolsContext";
import type { ToolsContextValue } from "./ToolsContext";
import type { ToolProvider } from "@/shared/types/chat";
import { ProviderState } from "@/shared/types/chat";

interface ToolsProviderProps {
  children: React.ReactNode;
}

export function ToolsProvider({ children }: ToolsProviderProps) {
  const config = getConfig();
  const configMcps = useMemo(() => config.mcps || [], [config.mcps]);
  
  // State management for all providers
  const [providerStates, setProviderStates] = useState<Map<string, ProviderState>>(new Map());
  
  // Create MCP clients from config
  const [configMcpClients] = useState<MCPClient[]>(() => 
    configMcps.map(mcp => new MCPClient(mcp.id, mcp.url, mcp.name, mcp.description, mcp.headers))
  );
  const configClientsRef = useRef<MCPClient[]>(configMcpClients);

  // Get current agent and its providers
  const { currentAgent } = useAgents();
  const { providers: agentProviders, enabledToolIds, mcpClients: agentMcpClients } = useAgentProviders(currentAgent);
  
  const internetProvider = useInternetProvider();
  const rendererProvider = useRendererProvider();

  // Cleanup config MCP clients on unmount
  useEffect(() => {
    const clients = configClientsRef.current;
    return () => {
      clients.forEach(client => {
        client.disconnect().catch(console.error);
      });
    };
  }, []);

  // Required providers: agent-enabled built-ins + all agent-assembled providers
  // (repository, skills, memory, bridge MCPs) — all always on.
  const requiredProviders = useMemo(() => {
    const ids = new Set(enabledToolIds);
    agentProviders.forEach(p => ids.add(p.id));
    return ids;
  }, [enabledToolIds, agentProviders]);

  // Combine all MCP clients (config + agent bridge servers)
  const allMcpClients = useMemo(() => {
    return [...configMcpClients, ...agentMcpClients];
  }, [configMcpClients, agentMcpClients]);

  // Build all providers: built-ins + config MCPs + agent providers (repo, skills, agent bridges)
  const providers = useMemo<ToolProvider[]>(() => {
    const list: ToolProvider[] = [];
    
    // Add local providers (always available if configured)
    if (internetProvider) list.push(internetProvider);
    if (rendererProvider) list.push(rendererProvider);
    
    // Add config MCP clients (always available)
    list.push(...configMcpClients);

    // Add agent-assembled providers (repository, skills, agent bridge MCPs)
    list.push(...agentProviders);
    
    // Note: artifacts provider is still added conditionally in useChatContext
    
    return list;
  }, [
    internetProvider,
    rendererProvider,
    configMcpClients,
    agentProviders,
  ]);

  // Helper functions for state management
  const getProviderState = useCallback((id: string): ProviderState => {
    return providerStates.get(id) ?? ProviderState.Disconnected;
  }, [providerStates]);

  const isProviderRequired = useCallback((id: string): boolean => {
    return requiredProviders.has(id);
  }, [requiredProviders]);

  // Auto-connect agent-required providers (enabled built-ins + enabled bridges)
  useEffect(() => {
    if (requiredProviders.size === 0) return;

    const connectRequired = async () => {
      for (const id of requiredProviders) {
        const state = providerStates.get(id);
        if (!state || state === ProviderState.Disconnected) {
          const provider = providers.find(p => p.id === id);
          if (provider) {
            try {
              await setProviderEnabled(id, true);
            } catch (error) {
              console.error(`Failed to auto-connect agent-required provider ${id}:`, error);
            }
          }
        }
      }
    };

    connectRequired();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requiredProviders]);

  const setProviderEnabled = useCallback(async (id: string, enabled: boolean) => {
    // Find the provider - check if it's an MCPClient
    const mcpClient = allMcpClients.find(c => c.id === id);
    
    if (mcpClient && mcpClient instanceof MCPClient) {
      // For MCP clients, connect/disconnect
      if (enabled) {
        setProviderStates(prev => new Map(prev).set(id, ProviderState.Initializing));
        try {
          await mcpClient.connect();
          setProviderStates(prev => new Map(prev).set(id, ProviderState.Connected));
        } catch (error) {
          console.error(`Failed to connect MCP client ${id}:`, error);
          setProviderStates(prev => new Map(prev).set(id, ProviderState.Failed));
        }
      } else {
        await mcpClient.disconnect();
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
  }, [allMcpClients]);

  const value: ToolsContextValue = {
    providers,
    getProviderState,
    isProviderRequired,
    setProviderEnabled,
  };

  return <ToolsContext.Provider value={value}>{children}</ToolsContext.Provider>;
}
