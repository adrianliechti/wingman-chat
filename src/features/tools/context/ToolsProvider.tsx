import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgentProviders } from "@/features/agent/hooks/useAgentProviders";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { useArtifactsProvider } from "@/features/artifacts/hooks/useArtifactsProvider";
import { useCanvasProvider } from "@/features/canvas/hooks/useCanvasProvider";
import { useInternetProvider } from "@/features/research/hooks/useInternetProvider";
import { MCPClient } from "@/features/settings/lib/mcp";
import { useSkillBuilderProvider } from "@/features/skills/hooks/useSkillBuilderProvider";
import { LOCAL_WINGMAN_ID, localWingmanMcpUrl, useLocalWingman } from "@/features/tools/hooks/useLocalWingman";
import { getConfig } from "@/shared/config";
import type {
  AudioContent,
  FileContent,
  ImageContent,
  TextContent,
  ToolContext,
  ToolProvider,
} from "@/shared/types/chat";
import { ProviderState } from "@/shared/types/chat";
import { ToolsContext } from "./ToolsContext";

const MCP_CONNECT_MAX_RETRIES = 2;
const MCP_CONNECT_RETRY_DELAY_MS = 500;

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

  // Incremented whenever any MCP client reloads its tool list (e.g. tools/list_changed)
  const [toolsVersion, setToolsVersion] = useState(0);

  // Config MCP clients (created once)
  const [configMcpClients] = useState<MCPClient[]>(() =>
    (config.mcps || []).map((mcp) => new MCPClient(mcp.id, mcp.url, mcp.name, mcp.description, mcp.headers, mcp.icon)),
  );

  // Local Wingman auto-discovery
  const bridgeHost = config.bridge?.url;
  const { available: localWingmanAvailable } = useLocalWingman(bridgeHost);
  const [localWingmanEnabled, setLocalWingmanEnabled] = useState(true);
  const toggleLocalWingman = useCallback(() => setLocalWingmanEnabled((v) => !v), []);
  const [localWingmanClient] = useState<MCPClient | null>(() =>
    bridgeHost
      ? new MCPClient(
          LOCAL_WINGMAN_ID,
          localWingmanMcpUrl(bridgeHost),
          "Wingman (Local)",
          "Locally running Wingman application",
        )
      : null,
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
  const canvasProvider = useCanvasProvider();
  const artifactsProvider = useArtifactsProvider();
  const skillBuilderProvider = useSkillBuilderProvider();

  // All MCP clients & lookup set (include local wingman only when the app is detected)
  const allMcpClients = useMemo(
    () => [
      ...configMcpClients,
      ...(localWingmanAvailable && localWingmanClient ? [localWingmanClient] : []),
      ...agentMcpClients,
    ],
    [configMcpClients, localWingmanAvailable, localWingmanClient, agentMcpClients],
  );
  const mcpIds = useMemo(() => new Set(allMcpClients.map((c) => c.id)), [allMcpClients]);

  // Agent-required: built-in tools + assembled providers (repo, skills, memory, bridges)
  const agentRequired = useMemo(() => {
    const ids = new Set(agentTools);
    for (const p of agentProviders) ids.add(p.id);
    return ids;
  }, [agentTools, agentProviders]);

  // Model config wins by delta:
  // 1) start from user-selected tools
  // 2) add agent-required tools
  // 3) add model-forced enabled tools
  // 4) remove model-forced disabled tools (highest precedence)
  // 5) auto-add local wingman when available and user has not disabled it
  const desiredTools = useMemo(() => {
    const merged = new Set(userTools);
    for (const id of agentRequired) merged.add(id);
    for (const id of modelEnabledTools) merged.add(id);
    for (const id of modelDisabledTools) merged.delete(id);
    if (localWingmanAvailable && localWingmanEnabled) merged.add(LOCAL_WINGMAN_ID);
    return merged;
  }, [userTools, agentRequired, modelEnabledTools, modelDisabledTools, localWingmanAvailable, localWingmanEnabled]);

  // All available providers
  // biome-ignore lint/correctness/useExhaustiveDependencies: toolsVersion is a cache-bust trigger, not a real dependency
  const providers = useMemo<ToolProvider[]>(() => {
    const list: ToolProvider[] = [];
    if (canvasProvider) list.push(canvasProvider);
    if (internetProvider) list.push(internetProvider);
    if (artifactsProvider) list.push(artifactsProvider);
    list.push(skillBuilderProvider);
    list.push(...configMcpClients);
    if (localWingmanAvailable && localWingmanClient) list.push(localWingmanClient);
    list.push(...agentProviders);
    return list;
  }, [
    internetProvider,
    canvasProvider,
    artifactsProvider,
    skillBuilderProvider,
    configMcpClients,
    localWingmanAvailable,
    localWingmanClient,
    agentProviders,
    toolsVersion,
  ]);

  // State: MCP clients use lifecycle state, local providers derive from desiredTools
  const getProviderState = useCallback(
    (id: string): ProviderState => {
      if (id === LOCAL_WINGMAN_ID && !localWingmanEnabled) return ProviderState.Disconnected;
      if (mcpIds.has(id)) return mcpStates.get(id) ?? ProviderState.Disconnected;
      return desiredTools.has(id) ? ProviderState.Connected : ProviderState.Disconnected;
    },
    [mcpIds, mcpStates, desiredTools, localWingmanEnabled],
  );

  // Track in-flight connection promises so callers can await an already-running connect
  const connectPromisesRef = useRef<Map<string, Promise<void>>>(new Map());

  // Connect/disconnect an MCP client (idempotent — skips no-ops via state ref)
  const connectMcp = useCallback(
    async (id: string, enabled: boolean) => {
      const client = allMcpClients.find((c) => c.id === id);
      if (!client) return;

      const current = mcpStatesRef.current.get(id);

      if (enabled && current === ProviderState.Connected) return;
      // If already initializing/authenticating, wait for the in-flight connection
      // instead of returning immediately so callers get a connected client.
      if (enabled && (current === ProviderState.Initializing || current === ProviderState.Authenticating)) {
        const pending = connectPromisesRef.current.get(id);
        if (pending) await pending;
        return;
      }
      if (!enabled && (!current || current === ProviderState.Disconnected)) return;

      if (enabled) {
        setMcpStates((prev) => new Map(prev).set(id, ProviderState.Initializing));
        const promise = (async () => {
          try {
            let lastError: unknown;
            for (let attempt = 0; attempt <= MCP_CONNECT_MAX_RETRIES; attempt++) {
              try {
                await client.connect();
                setMcpStates((prev) => new Map(prev).set(id, ProviderState.Connected));
                return;
              } catch (error) {
                lastError = error;
                if (attempt < MCP_CONNECT_MAX_RETRIES) {
                  console.warn(`MCP ${id} connect attempt ${attempt + 1} failed, retrying...`, error);
                  await new Promise<void>((r) => window.setTimeout(r, MCP_CONNECT_RETRY_DELAY_MS * (attempt + 1)));
                }
              }
            }
            console.error(`Failed to connect MCP ${id}:`, lastError);
            setMcpStates((prev) => new Map(prev).set(id, ProviderState.Failed));
          } finally {
            connectPromisesRef.current.delete(id);
          }
        })();
        connectPromisesRef.current.set(id, promise);
        await promise;
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
      // eslint-disable-next-line react-hooks/immutability
      client.onToolsChanged = () => {
        setToolsVersion((v) => v + 1);
      };
      // eslint-disable-next-line react-hooks/immutability
      client.onElicitationComplete = null; // handled via activeToolContext; clear any stale reference
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
      // Local wingman has its own enable flag that gates desiredTools; toggling
      // userTools alone is not enough because desiredTools re-adds the id when
      // localWingmanEnabled is still true.
      if (id === LOCAL_WINGMAN_ID) {
        setLocalWingmanEnabled(enabled);
        await connectMcp(id, enabled);
        return;
      }

      // Update user tool set — this feeds into desiredTools which triggers the
      // reconciliation effect. The effect invokes connectMcp on the next frame,
      // the same codepath used for agent-enabled servers.
      setUserTools((prev) => {
        const next = new Set(prev);
        if (enabled) next.add(id);
        else next.delete(id);
        return next;
      });
    },
    [connectMcp],
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
      displayModeOptions?: import("@/features/settings/lib/mcp").DisplayModeOptions,
    ) => {
      const client = allMcpClients.find((c) => c.id === providerId);
      if (!client) {
        throw new Error(`Cannot restore tool UI: MCP client ${providerId} not found`);
      }

      // Restoring persisted app state needs a live MCP connection even when the
      // provider was just enabled in the current interaction.
      await connectMcp(providerId, true);
      if (!client.isConnected()) {
        throw new Error(`Cannot restore tool UI: MCP client ${providerId} not connected`);
      }

      await client.restoreToolUI(toolName, resourceUri, args, result, context, displayModeOptions);
    },
    [allMcpClients, connectMcp],
  );

  // Check whether a provider currently has an active app bridge (e.g. from a live tool call)
  const hasActiveBridge = useCallback(
    (providerId: string): boolean => {
      const client = allMcpClients.find((c) => c.id === providerId);
      return client?.hasActiveBridge() ?? false;
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
      for (const c of clients) c.disconnect().catch(console.error);
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
        localWingmanAvailable,
        localWingmanEnabled,
        toggleLocalWingman,
        restoreToolUI,
        hasActiveBridge,
      }}
    >
      {children}
    </ToolsContext.Provider>
  );
}
