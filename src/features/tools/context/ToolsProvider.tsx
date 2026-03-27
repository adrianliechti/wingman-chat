import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { getConfig } from "@/shared/config";
import { MCPClient } from "@/features/settings/lib/mcp";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { useAgentProviders } from "@/features/agent/hooks/useAgentProviders";
import { useInternetProvider } from "@/features/research/hooks/useInternetProvider";
import { useRendererProvider } from "@/features/renderer/hooks/useRendererProvider";
import { useArtifactsProvider } from "@/features/artifacts/hooks/useArtifactsProvider";
import { ToolsContext } from "./ToolsContext";
import type {
  ToolProvider,
  TextContent,
  ImageContent,
  AudioContent,
  FileContent,
  ToolContext,
} from "@/shared/types/chat";
import { ProviderState } from "@/shared/types/chat";

export function ToolsProvider({ children }: { children: React.ReactNode }) {
  const config = getConfig();

  // User-selected tools (session-only, reset on new chat)
  const [userTools, setUserTools] = useState<Set<string>>(new Set());
  const [modelEnabledTools, setModelEnabledTools] = useState<Set<string>>(new Set());
  const [modelDisabledTools, setModelDisabledTools] = useState<Set<string>>(new Set());

  // MCP connection lifecycle (only MCP clients need Initializing/Failed states)
  const [mcpStates, setMcpStates] = useState<Map<string, ProviderState>>(new Map());
  const mcpStatesRef = useRef(mcpStates);
  useEffect(() => {
    mcpStatesRef.current = mcpStates;
  }, [mcpStates]);

  // Config MCP clients (created once)
  const [configMcpClients] = useState<MCPClient[]>(() =>
    (config.mcps || []).map((mcp) => new MCPClient(mcp.id, mcp.url, mcp.name, mcp.description, mcp.headers, mcp.icon)),
  );

  // Agent
  const { currentAgent } = useAgents();
  const {
    providers: agentProviders,
    enabledTools: agentTools,
    mcpClients: agentMcpClients,
  } = useAgentProviders(currentAgent);

  // Built-in providers
  const internetProvider = useInternetProvider();
  const rendererProvider = useRendererProvider();
  const artifactsProvider = useArtifactsProvider();

  // All MCP clients & lookup set
  const allMcpClients = useMemo(() => [...configMcpClients, ...agentMcpClients], [configMcpClients, agentMcpClients]);
  const mcpIds = useMemo(() => new Set(allMcpClients.map((c) => c.id)), [allMcpClients]);

  // Agent-required: built-in tools + assembled providers (repo, skills, memory, bridges)
  const agentRequired = useMemo(() => {
    const ids = new Set(agentTools);
    agentProviders.forEach((p) => ids.add(p.id));
    return ids;
  }, [agentTools, agentProviders]);

  // Model config wins by delta:
  // 1) start from user-selected tools
  // 2) add agent-required tools
  // 3) add model-forced enabled tools
  // 4) remove model-forced disabled tools (highest precedence)
  const desiredTools = useMemo(() => {
    const merged = new Set(userTools);
    agentRequired.forEach((id) => merged.add(id));
    modelEnabledTools.forEach((id) => merged.add(id));
    modelDisabledTools.forEach((id) => merged.delete(id));
    return merged;
  }, [userTools, agentRequired, modelEnabledTools, modelDisabledTools]);

  // All available providers
  const providers = useMemo<ToolProvider[]>(() => {
    const list: ToolProvider[] = [];
    if (rendererProvider) list.push(rendererProvider);
    if (internetProvider) list.push(internetProvider);
    if (artifactsProvider) list.push(artifactsProvider);
    list.push(...configMcpClients, ...agentProviders);
    return list;
  }, [internetProvider, rendererProvider, artifactsProvider, configMcpClients, agentProviders]);

  // State: MCP clients use lifecycle state, local providers derive from desiredTools
  const getProviderState = useCallback(
    (id: string): ProviderState => {
      if (mcpIds.has(id)) return mcpStates.get(id) ?? ProviderState.Disconnected;
      return desiredTools.has(id) ? ProviderState.Connected : ProviderState.Disconnected;
    },
    [mcpIds, mcpStates, desiredTools],
  );

  // Connect/disconnect an MCP client (idempotent — skips no-ops via state ref)
  const connectMcp = useCallback(
    async (id: string, enabled: boolean) => {
      const client = allMcpClients.find((c) => c.id === id);
      if (!client) return;

      const current = mcpStatesRef.current.get(id);
      if (
        enabled &&
        (current === ProviderState.Connected ||
          current === ProviderState.Initializing ||
          current === ProviderState.Authenticating)
      )
        return;
      if (!enabled && (!current || current === ProviderState.Disconnected)) return;

      if (enabled) {
        setMcpStates((prev) => new Map(prev).set(id, ProviderState.Initializing));
        try {
          await client.connect();
          setMcpStates((prev) => new Map(prev).set(id, ProviderState.Connected));
        } catch (error) {
          console.error(`Failed to connect MCP ${id}:`, error);
          setMcpStates((prev) => new Map(prev).set(id, ProviderState.Failed));
        }
      } else {
        await client.disconnect();
        setMcpStates((prev) => new Map(prev).set(id, ProviderState.Disconnected));
      }
    },
    [allMcpClients],
  );

  // Wire up onDisconnected callbacks so ping failures update state
  // Also wire up auth lifecycle callbacks so the UI reflects Authenticating state
  useEffect(() => {
    for (const client of allMcpClients) {
      // eslint-disable-next-line react-hooks/immutability -- setting callbacks on external MCP client objects is the purpose of this effect
      client.onDisconnected = () => {
        setMcpStates((prev) => new Map(prev).set(client.id, ProviderState.Failed));
      };
      // eslint-disable-next-line react-hooks/immutability
      client.onAuthenticating = () => {
        setMcpStates((prev) => new Map(prev).set(client.id, ProviderState.Authenticating));
      };
      // eslint-disable-next-line react-hooks/immutability
      client.onAuthComplete = () => {
        // Transition back to Initializing while the reconnection is in flight
        setMcpStates((prev) => new Map(prev).set(client.id, ProviderState.Initializing));
      };
    }
  }, [allMcpClients]);

  // When a client is removed from allMcpClients, clear its stale state so
  // re-adding it (toggle off → on) doesn't get blocked by the Connected guard.
  useEffect(() => {
    setMcpStates((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const id of next.keys()) {
        if (!mcpIds.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [mcpIds]);

  // Reconcile MCP connections with desired state (idempotent — safe to re-run)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const id of mcpIds) {
        connectMcp(id, desiredTools.has(id)).catch(console.error);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [desiredTools, mcpIds, connectMcp]);

  // User-facing toggle
  const setProviderEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      setUserTools((prev) => {
        const next = new Set(prev);
        if (enabled) next.add(id);
        else next.delete(id);
        return next;
      });
      // Immediate MCP connection for responsiveness
      if (mcpIds.has(id)) await connectMcp(id, enabled);
    },
    [mcpIds, connectMcp],
  );

  // Reset user tool selections (called on new/switch chat)
  const resetTools = useCallback(() => {
    setUserTools(new Set());
  }, []);

  // Restore an MCP app UI from persisted chat data
  const restoreToolUI = useCallback(
    async (
      providerId: string,
      toolName: string,
      resourceUri: string,
      args: Record<string, unknown>,
      result: (TextContent | ImageContent | AudioContent | FileContent)[],
      context: ToolContext,
    ) => {
      const client = allMcpClients.find((c) => c.id === providerId);
      if (!client || !client.isConnected()) {
        console.warn(`Cannot restore tool UI: MCP client ${providerId} not connected`);
        return;
      }
      await client.restoreToolUI(toolName, resourceUri, args, result, context);
    },
    [allMcpClients],
  );

  const setModelOverrides = useCallback((enabled: string[], disabled: string[]) => {
    setModelEnabledTools(new Set(enabled));
    setModelDisabledTools(new Set(disabled));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    const clients = configMcpClients;
    return () => {
      clients.forEach((c) => c.disconnect().catch(console.error));
    };
  }, [configMcpClients]);

  return (
    <ToolsContext.Provider
      value={{
        providers,
        getProviderState,
        setProviderEnabled,
        setModelOverrides,
        resetTools,
        restoreToolUI,
      }}
    >
      {children}
    </ToolsContext.Provider>
  );
}
