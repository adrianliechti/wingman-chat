import { Coffee } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgentProviders } from "@/features/agent/hooks/useAgentProviders";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { useArtifactsProvider } from "@/features/artifacts/hooks/useArtifactsProvider";
import { useInternetProvider } from "@/features/research/hooks/useInternetProvider";
import { MCPClient } from "@/features/settings/lib/mcp";
import { useSkillBuilderProvider } from "@/features/skills/hooks/useSkillBuilderProvider";
import { useSkillsProvider } from "@/features/skills/hooks/useSkillsProvider";
import { SKILLS_PROVIDER_ID, type SkillSources } from "@/features/skills/lib/skillsProvider";
import { STUDIO_PROVIDER_ID, useStudioProvider } from "@/features/studio/hooks/useStudioProvider";
import { COMPANION_ID, companionMcpUrl, useCompanion } from "@/features/tools/hooks/useCompanion";
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

// Persisted source selection for the Skills tool: "personal" exposes the user's
// own skills, "catalog" the shipped templates. Either, both, or neither may be on.
// The Studio skill pack is not a persisted source — it's slaved to the Studio
// capability and passed to useSkillsProvider as a separate flag.
const SKILL_SOURCES_STORAGE_KEY = "app_skills";
const SKILL_SOURCE_IDS = ["personal", "catalog"] as const;

// Persisted as a presence-array of enabled source ids (e.g. ["personal"]),
// mirroring app_tools — present means on, absent means off.
function loadSavedSkillSources(): SkillSources {
  try {
    const parsed = JSON.parse(localStorage.getItem(SKILL_SOURCES_STORAGE_KEY) ?? "[]");
    if (Array.isArray(parsed)) {
      const ids = new Set(parsed);
      return { personal: ids.has("personal"), catalog: ids.has("catalog") };
    }
    // Migration: the old format stored an object of booleans ({personal, catalog}).
    return { personal: parsed?.personal === true, catalog: parsed?.catalog === true };
  } catch {
    return { personal: false, catalog: false };
  }
}

// Persisted tool selections (built-in tools and MCP servers) so they stick
// across new chats and reloads. Applied only outside agent mode — an active
// agent's own config governs its tools. Persisted MCP servers reconnect on
// load; an OAuth server that needs fresh auth surfaces that as usual (and only
// in no-agent mode, since agent mode ignores these selections).
const TOOLS_STORAGE_KEY = "app_tools";

function loadSavedTools(): Set<string> {
  try {
    const raw = localStorage.getItem(TOOLS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((id): id is string => typeof id === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function saveTools(ids: Set<string>): void {
  try {
    localStorage.setItem(TOOLS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Silently handle localStorage errors (private mode, quota, etc.)
  }
}

export function ToolsProvider({ children }: { children: React.ReactNode }) {
  const config = getConfig();

  // User-selected tools. Sticky: selections are restored from storage and
  // persist across chats/reloads (see persist effect below). Applied only
  // outside agent mode — an active agent's own config governs its tools.
  const [userTools, setUserTools] = useState<Set<string>>(() => loadSavedTools());
  const [modelEnabledTools, setModelEnabledTools] = useState<Set<string>>(new Set());
  const [modelDisabledTools, setModelDisabledTools] = useState<Set<string>>(new Set());

  // Optional tools the user turns on for the current agent chat. Reset whenever
  // the active agent changes (see effect below) — selecting an agent starts from
  // its required tools, not the global selection — and never persisted.
  const [sessionTools, setSessionTools] = useState<Set<string>>(new Set());

  // Source selection for the global Skills tool (persisted). The tool is enabled
  // whenever at least one source is on — see mcpConnectionDesired below.
  const [skillSources, setSkillSourcesState] = useState<SkillSources>(() => loadSavedSkillSources());
  const setSkillSources = useCallback((sources: SkillSources) => {
    setSkillSourcesState(sources);
    try {
      const enabled = SKILL_SOURCE_IDS.filter((id) => sources[id]);
      localStorage.setItem(SKILL_SOURCES_STORAGE_KEY, JSON.stringify(enabled));
    } catch {
      // Silently handle localStorage errors (private mode, quota, etc.)
    }
  }, []);

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

  // Relative MCPs are proxied through `/api/v1/mcp/{id}` and gated by backend
  // RBAC; only these are filtered against the availability list. MCPs with an
  // explicit url point elsewhere and are always shown.
  const relativeMcpIds = useMemo(() => {
    const base = new URL("/api/v1/mcp/", window.location.origin).toString();
    return new Set((config.mcps || []).filter((mcp) => mcp.url.startsWith(base)).map((mcp) => mcp.id));
  }, [config.mcps]);

  // MCP ids the backend reports as available (RBAC-filtered), mirroring how
  // useModels filters config models against /v1/models. null = not yet loaded
  // or the endpoint is unavailable → fall back to showing all configured MCPs.
  const [availableMcpIds, setAvailableMcpIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    let cancelled = false;
    config.client
      .listMCPs()
      .then((ids) => {
        if (!cancelled) setAvailableMcpIds(new Set(ids));
      })
      .catch((error) => console.error("error loading mcps", error));
    return () => {
      cancelled = true;
    };
  }, [config.client]);

  // Config MCP clients visible to the user: relative ones are hidden unless the
  // backend lists them as available.
  const visibleConfigMcpClients = useMemo(
    () =>
      configMcpClients.filter(
        (client) => !relativeMcpIds.has(client.id) || !availableMcpIds || availableMcpIds.has(client.id),
      ),
    [configMcpClients, relativeMcpIds, availableMcpIds],
  );

  // Local Wingman auto-discovery
  const bridgeHost = config.bridge?.url;
  const { available: companionAvailable } = useCompanion(bridgeHost);
  const [companionEnabled, setCompanionEnabled] = useState(true);
  const toggleCompanion = useCallback(() => setCompanionEnabled((v) => !v), []);
  const [companionClient] = useState<MCPClient | null>(() =>
    bridgeHost
      ? new MCPClient(
          COMPANION_ID,
          companionMcpUrl(bridgeHost),
          "Companion",
          "Locally running companion application",
          undefined,
          Coffee,
        )
      : null,
  );

  // Agent
  const { currentAgent } = useAgents();

  // Reset the session optionals whenever the active agent changes (select / switch
  // / deselect) — an agent chat starts from the agent's required tools only.
  useEffect(() => {
    setSessionTools(new Set());
  }, [currentAgent?.id]);

  // The user's editable tool selection: in agent mode the session optionals (the
  // agent's required tools are added separately as the floor); otherwise the sticky
  // global userTools.
  const activeSelection = currentAgent ? sessionTools : userTools;

  // Studio's skill pack must surface when the capability is on — a required tool
  // (currentAgent.tools), a session addition, or the global userTools selection.
  const studioEnabled = activeSelection.has(STUDIO_PROVIDER_ID) || !!currentAgent?.tools?.includes(STUDIO_PROVIDER_ID);

  const {
    providers: agentProviders,
    enabledTools: agentTools,
    mcpClients: agentMcpClients,
  } = useAgentProviders(currentAgent);

  // Built-in providers
  const internetProvider = useInternetProvider();
  const artifactsProvider = useArtifactsProvider();
  const skillsProvider = useSkillsProvider(currentAgent, skillSources, studioEnabled);
  const studioProvider = useStudioProvider();
  const skillBuilderProvider = useSkillBuilderProvider();

  // All MCP clients & lookup set (include local wingman only when the app is detected)
  const allMcpClients = useMemo(
    () => [
      ...visibleConfigMcpClients,
      ...(companionAvailable && companionClient ? [companionClient] : []),
      ...agentMcpClients,
    ],
    [visibleConfigMcpClients, companionAvailable, companionClient, agentMcpClients],
  );
  const mcpIds = useMemo(() => new Set(allMcpClients.map((c) => c.id)), [allMcpClients]);

  // Persist tool selections (built-in + MCP) so they stick across chats/reloads.
  useEffect(() => {
    saveTools(userTools);
  }, [userTools]);

  // Agent-required: built-in tools + assembled providers (repo, skills, memory, bridges)
  const agentRequired = useMemo(() => {
    const ids = new Set(agentTools);
    for (const p of agentProviders) ids.add(p.id);
    return ids;
  }, [agentTools, agentProviders]);

  // What the user + agent + companion want connected (ignores model overrides intentionally).
  // Used by the reconciliation effect to control MCP lifecycle — model-level tool filtering
  // (enabled/disabled lists) is applied later in chatTools(), not here. Disconnecting an
  // MCP server because the current model has it in tools.disabled would clear this.client
  // and break any in-flight tool call.
  const mcpConnectionDesired = useMemo(() => {
    // Baseline is the user's editable selection: outside agent mode the sticky
    // userTools; in agent mode the session additions only (optionals reset to off
    // on agent select — the global selection does not carry in). The agent's own
    // tools are then unioned via agentRequired as the enforced floor.
    const merged = new Set<string>(activeSelection);
    // The Skills tool's connection tracks the assembled provider: it's non-null
    // exactly when some source, the Studio pack, or an agent's curated set has
    // skills to expose — so no source/agent branching is needed here.
    if (skillsProvider) merged.add(SKILLS_PROVIDER_ID);
    for (const id of agentRequired) merged.add(id);
    for (const id of modelEnabledTools) merged.add(id);
    if (companionAvailable && companionEnabled) merged.add(COMPANION_ID);
    return merged;
  }, [activeSelection, skillsProvider, agentRequired, modelEnabledTools, companionAvailable, companionEnabled]);

  // Full desired set including model overrides — used by getProviderState for non-MCP
  // built-in providers (internet, canvas, …) which have no lifecycle to manage.
  const desiredTools = useMemo(() => {
    const merged = new Set(mcpConnectionDesired);
    for (const id of modelDisabledTools) merged.delete(id);
    return merged;
  }, [mcpConnectionDesired, modelDisabledTools]);

  // All available providers. `toolsVersion` is a deliberate cache-bust dep: it
  // bumps when an MCP client mutates its tool list in place, forcing this memo
  // to rebuild even though the client references are unchanged.
  const providers = useMemo<ToolProvider[]>(() => {
    const list: ToolProvider[] = [];
    if (internetProvider) list.push(internetProvider);
    // The unified "Studio" capability (documents, visuals & images). Always
    // available — it's a session capability that layers on top of an agent too —
    // and its create_image tool is present only when a renderer is configured.
    list.push(studioProvider);
    if (artifactsProvider) list.push(artifactsProvider);
    // The single Skills tool (one read_skill surface): an agent's curated subset
    // under an agent, the selected global sources otherwise, plus the Studio pack
    // when the capability is on. Assembled by useSkillsProvider; null when empty.
    if (skillsProvider) list.push(skillsProvider);
    list.push(skillBuilderProvider);
    list.push(...visibleConfigMcpClients);
    if (companionAvailable && companionClient) list.push(companionClient);
    list.push(...agentProviders);
    return list;
  }, [
    internetProvider,
    studioProvider,
    artifactsProvider,
    skillsProvider,
    skillBuilderProvider,
    visibleConfigMcpClients,
    companionAvailable,
    companionClient,
    agentProviders,
    toolsVersion,
  ]);

  // State: MCP clients use lifecycle state, local providers derive from desiredTools
  const getProviderState = useCallback(
    (id: string): ProviderState => {
      if (id === COMPANION_ID && !companionEnabled) return ProviderState.Disconnected;
      if (mcpIds.has(id)) return mcpStates.get(id) ?? ProviderState.Disconnected;
      return desiredTools.has(id) ? ProviderState.Connected : ProviderState.Disconnected;
    },
    [mcpIds, mcpStates, desiredTools, companionEnabled],
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
        // Skip failed providers — they must be retried explicitly by the user.
        // Without this, toggling any other provider would re-trigger a connection
        // attempt for every previously-failed MCP.
        if (mcpStatesRef.current.get(id) === ProviderState.Failed) continue;
        connectMcp(id, mcpConnectionDesired.has(id)).catch(console.error);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [mcpConnectionDesired, mcpIds, connectMcp]);

  // User-facing toggle
  const setProviderEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      // Companion has its own enable flag that gates desiredTools; toggling
      // userTools alone is not enough because desiredTools re-adds the id when
      // companionEnabled is still true.
      if (id === COMPANION_ID) {
        setCompanionEnabled(enabled);
        await connectMcp(id, enabled);
        return;
      }

      // Agent mode: the agent's required tools are locked on — a disable is a
      // no-op so we neither drop it nor disconnect its server.
      if (currentAgent && !enabled && agentRequired.has(id)) return;

      // Edit the active selection: session-local optionals in agent mode (reset on
      // agent change), or the sticky global set otherwise. This feeds desiredTools
      // which triggers the reconciliation effect as a safety net, but for MCP tools
      // we also connect immediately so the tool is ready before the next message.
      const setSelection = currentAgent ? setSessionTools : setUserTools;
      setSelection((prev) => {
        const next = new Set(prev);
        if (enabled) next.add(id);
        else next.delete(id);
        return next;
      });
      if (mcpIds.has(id)) await connectMcp(id, enabled);
    },
    [mcpIds, connectMcp, currentAgent, agentRequired],
  );

  // Tool policy for the active agent: "required" = locked on (the agent's tools +
  // its always-on providers); "optional" = the user toggles it freely. Everything
  // is "optional" with no agent.
  const getProviderPolicy = useCallback(
    (id: string): "required" | "optional" => (currentAgent && agentRequired.has(id) ? "required" : "optional"),
    [currentAgent, agentRequired],
  );

  // Restore an MCP app UI from persisted chat data
  const restoreToolUI = useCallback(
    async (
      providerId: string,
      toolName: string,
      resourceUri: string,
      args: Record<string, unknown>,
      result: (TextContent | ImageContent | AudioContent | FileContent)[],
      content: Record<string, unknown> | undefined,
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

      await client.restoreToolUI(toolName, resourceUri, args, result, content, context, displayModeOptions);
    },
    [allMcpClients, connectMcp],
  );

  const setDisplayMode = useCallback(
    (providerId: string, mode: import("@/features/settings/lib/mcp").DisplayMode) => {
      allMcpClients.find((c) => c.id === providerId)?.applyAppDisplayMode(mode);
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
    <ToolsContext
      value={{
        providers,
        getProviderState,
        getProviderPolicy,
        setProviderEnabled,
        setModelOverrides,
        skillSources,
        setSkillSources,
        companionAvailable: companionAvailable,
        companionEnabled: companionEnabled,
        toggleCompanion: toggleCompanion,
        restoreToolUI,
        setDisplayMode,
      }}
    >
      {children}
    </ToolsContext>
  );
}
