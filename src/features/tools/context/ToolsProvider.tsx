import { useQuery } from "@tanstack/react-query";
import { Coffee } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAgentProviders } from "@/features/agent/hooks/useAgentProviders";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { useArtifactsProvider } from "@/features/artifacts/hooks/useArtifactsProvider";
import type { McpServerDefinition } from "@/features/settings/lib/mcpConfig";
import type { McpAppOptions } from "@/features/settings/lib/mcpAppSession";
import { useSkillBuilderProvider } from "@/features/skills/hooks/useSkillBuilderProvider";
import { useSkillsProvider } from "@/features/skills/hooks/useSkillsProvider";
import { SKILLS_PROVIDER_ID, type SkillSources } from "@/features/skills/lib/skillsProvider";
import { usePluginProviders } from "@/features/plugins/hooks/usePluginProviders";
import { PLUGIN_PROVIDER_PREFIX, pluginProviderId } from "@/features/plugins/lib/pluginProvider";
import { COMPANION_ID, companionMcpUrl, useCompanion } from "@/features/tools/hooks/useCompanion";
import { useMcpClients } from "@/features/tools/hooks/useMcpClients";
import { getConfig } from "@/shared/config";
import { queryClient } from "@/shared/lib/queryClient";
import type { ToolResultPart, UIResourcePart } from "@tanstack/ai";
import type { ToolProvider } from "@/shared/types/chat";
import { ProviderState } from "@/shared/types/chat";
import { ToolsContext } from "./ToolsContext";

// Persisted source selection for the Skills tool: "personal" exposes the user's
// own skills. Built-in capability skills are always available.
const SKILL_SOURCES_STORAGE_KEY = "app_skills";
const SKILL_SOURCE_IDS = ["personal"] as const;

// Persisted as a presence-array of enabled source ids (e.g. ["personal"]),
// mirroring app_tools — present means on, absent means off.
function loadSavedSkillSources(): SkillSources {
  try {
    const parsed = JSON.parse(localStorage.getItem(SKILL_SOURCES_STORAGE_KEY) ?? "[]");
    if (Array.isArray(parsed)) {
      const ids = new Set(parsed);
      return { personal: ids.has("personal") };
    }
    // Migration: the old format stored an object of booleans ({personal, catalog}).
    return { personal: parsed?.personal === true };
  } catch {
    return { personal: false };
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
    // Studio is now a built-in skill catalog, not a selectable tool.
    return Array.isArray(parsed)
      ? new Set(parsed.filter((id): id is string => typeof id === "string" && id !== "studio"))
      : new Set();
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

// The global companion enable flag, persisted so a user who turns the companion
// off keeps it off across reloads. This governs the companion only outside agent
// mode — an active agent's own config decides whether the companion is on.
const COMPANION_ENABLED_STORAGE_KEY = "app_companion_enabled";

function loadCompanionEnabled(): boolean {
  try {
    const raw = localStorage.getItem(COMPANION_ENABLED_STORAGE_KEY);
    // Default to on when nothing has been persisted yet.
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

function saveCompanionEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(COMPANION_ENABLED_STORAGE_KEY, String(enabled));
  } catch {
    // Silently handle localStorage errors (private mode, quota, etc.)
  }
}

export function ToolsProvider({ children }: { children: React.ReactNode }) {
  const config = getConfig();
  const { currentAgent } = useAgents();
  const [userTools, setUserTools] = useState(loadSavedTools);
  const [sessionTools, setSessionTools] = useState<Set<string>>(new Set());
  const [modelEnabledTools, setModelEnabledTools] = useState<Set<string>>(new Set());
  const [modelDisabledTools, setModelDisabledTools] = useState<Set<string>>(new Set());
  const [skillSources, setSkillSourcesState] = useState(loadSavedSkillSources);
  const setSkillSources = useCallback((sources: SkillSources) => {
    setSkillSourcesState(sources);
    try {
      localStorage.setItem(SKILL_SOURCES_STORAGE_KEY, JSON.stringify(SKILL_SOURCE_IDS.filter((id) => sources[id])));
    } catch {
      /* Storage may be unavailable. */
    }
  }, []);
  useEffect(() => {
    setSessionTools(new Set());
  }, [currentAgent?.id]);
  useEffect(() => {
    saveTools(userTools);
  }, [userTools]);
  const activeSelection = currentAgent ? sessionTools : userTools;

  const { data: availableMcpList, error: mcpListError } = useQuery(
    {
      queryKey: ["mcps"],
      queryFn: () => config.client.listMCPs(),
      enabled: config.mcps.some((server) => server.source === "gateway"),
    },
    queryClient,
  );
  useEffect(() => {
    if (mcpListError) console.error("error loading mcps", mcpListError);
  }, [mcpListError]);
  const visibleConfigServers = useMemo(
    () =>
      config.mcps.filter(
        (server) => server.source !== "gateway" || !availableMcpList || availableMcpList.includes(server.id),
      ),
    [config.mcps, availableMcpList],
  );

  const companionHost = config.companion?.url;
  const { available: companionAvailable } = useCompanion(companionHost);
  const [companionEnabled, setCompanionEnabled] = useState(loadCompanionEnabled);
  const toggleCompanion = useCallback(
    () =>
      setCompanionEnabled((previous) => {
        saveCompanionEnabled(!previous);
        return !previous;
      }),
    [],
  );

  const { providers: agentProviders, enabledTools: agentTools } = useAgentProviders(currentAgent);
  const {
    plugins: installedPlugins,
    isLoaded: pluginsLoaded,
    requiredIds: pluginRequiredIds,
    servers: pluginServers,
  } = usePluginProviders(currentAgent);
  const artifactsProvider = useArtifactsProvider();
  const skillBuilderProvider = useSkillBuilderProvider();
  const activePlugins = useMemo(
    () =>
      installedPlugins.filter((plugin) => {
        const id = pluginProviderId(plugin.id);
        return pluginRequiredIds.has(id) || activeSelection.has(id);
      }),
    [installedPlugins, pluginRequiredIds, activeSelection],
  );
  const { provider: skillsProvider, forSelection: getSkillsProvider } = useSkillsProvider(
    currentAgent,
    skillSources,
    activePlugins,
    installedPlugins,
  );

  // Only plugin parents are selectable. Remove old independently selected child
  // servers as well as selections for plugins that have been uninstalled.
  useEffect(() => {
    if (!pluginsLoaded) return;
    const liveIds = new Set(installedPlugins.map((plugin) => pluginProviderId(plugin.id)));
    const prune = (previous: Set<string>) => {
      const next = new Set([...previous].filter((id) => !id.startsWith(PLUGIN_PROVIDER_PREFIX) || liveIds.has(id)));
      return next.size === previous.size ? previous : next;
    };
    setUserTools(prune);
    setSessionTools(prune);
  }, [pluginsLoaded, installedPlugins]);

  const servers = useMemo<McpServerDefinition[]>(
    () => [
      ...visibleConfigServers,
      ...pluginServers,
      ...(companionAvailable && companionHost
        ? [
            {
              id: COMPANION_ID,
              source: "companion" as const,
              url: companionMcpUrl(companionHost),
              name: "Companion",
              description: "Locally running companion application",
              icon: Coffee,
            },
          ]
        : []),
    ],
    [visibleConfigServers, pluginServers, companionAvailable, companionHost],
  );
  const serverOwners = useMemo(
    () => new Map(servers.map((server) => [server.id, server.ownerId ?? server.id])),
    [servers],
  );
  const ownerOf = useCallback((id: string) => serverOwners.get(id) ?? id, [serverOwners]);
  const agentRequired = useMemo(
    () =>
      new Set([
        ...agentTools.map(ownerOf),
        ...agentProviders.map((provider) => ownerOf(provider.id)),
        ...pluginRequiredIds,
      ]),
    [agentTools, agentProviders, pluginRequiredIds, ownerOf],
  );

  // Selection is independent of connection status. Plugin children always inherit
  // their parent's selection; a stale child ID must never enable a plugin.
  const selected = useMemo(() => {
    const ids = new Set([...activeSelection].filter((id) => ownerOf(id) === id));
    for (const id of agentRequired) ids.add(id);
    for (const id of modelEnabledTools) ids.add(ownerOf(id));
    if (skillsProvider) ids.add(SKILLS_PROVIDER_ID);
    if (!currentAgent) {
      ids.delete(COMPANION_ID);
      if (companionAvailable && companionEnabled) ids.add(COMPANION_ID);
    }
    return ids;
  }, [
    activeSelection,
    agentRequired,
    modelEnabledTools,
    skillsProvider,
    currentAgent,
    companionAvailable,
    companionEnabled,
    ownerOf,
  ]);
  const isProviderEnabled = useCallback((id: string) => selected.has(ownerOf(id)), [selected, ownerOf]);
  const desiredMcpIds = useMemo(
    () => new Set(servers.filter((server) => selected.has(server.ownerId ?? server.id)).map((server) => server.id)),
    [servers, selected],
  );
  const { clients, getClient, getState, setConnected } = useMcpClients(servers, desiredMcpIds);

  const providers = useMemo<ToolProvider[]>(
    () => [
      ...(artifactsProvider ? [artifactsProvider] : []),
      ...(skillsProvider ? [skillsProvider] : []),
      ...agentProviders,
      ...clients,
    ],
    [artifactsProvider, skillsProvider, agentProviders, clients],
  );
  const coreProviders = useMemo<ToolProvider[]>(() => [skillBuilderProvider], [skillBuilderProvider]);

  const getProviderState = useCallback(
    (id: string): ProviderState => {
      if (!isProviderEnabled(id)) return ProviderState.Disconnected;
      if (serverOwners.has(id)) return getState(id);
      if (id.startsWith(PLUGIN_PROVIDER_PREFIX)) {
        const states = servers.filter((server) => server.ownerId === id).map((server) => getState(server.id));
        for (const state of [
          ProviderState.Unauthorized,
          ProviderState.Authenticating,
          ProviderState.Initializing,
          ProviderState.Failed,
          ProviderState.Disconnected,
        ]) {
          if (states.includes(state)) return state;
        }
      }
      return modelDisabledTools.has(id) ? ProviderState.Disconnected : ProviderState.Connected;
    },
    [isProviderEnabled, serverOwners, servers, getState, modelDisabledTools],
  );

  const setProviderEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      const ownerId = ownerOf(id);
      if (currentAgent && !enabled && agentRequired.has(ownerId)) return;
      if (ownerId === COMPANION_ID && !currentAgent) {
        setCompanionEnabled(enabled);
        saveCompanionEnabled(enabled);
      } else {
        const setSelection = currentAgent ? setSessionTools : setUserTools;
        setSelection((previous) => {
          const next = new Set(previous);
          if (enabled) next.add(ownerId);
          else next.delete(ownerId);
          return next;
        });
      }
      await Promise.all(
        servers
          .filter((server) => (server.ownerId ?? server.id) === ownerId)
          .map((server) => setConnected(server.id, enabled, enabled)),
      );
    },
    [ownerOf, currentAgent, agentRequired, servers, setConnected],
  );
  const getProviderPolicy = useCallback(
    (id: string): "required" | "optional" => (currentAgent && agentRequired.has(ownerOf(id)) ? "required" : "optional"),
    [currentAgent, agentRequired, ownerOf],
  );

  const restoreToolUI = useCallback(
    async (app: UIResourcePart, args: Record<string, unknown>, result: ToolResultPart, options: McpAppOptions) => {
      const id = app.serverId;
      if (!id) throw new Error("Cannot restore tool UI: missing MCP server ID");
      const client = getClient(id);
      if (!client) throw new Error("This app’s MCP server is no longer available");
      if (!isProviderEnabled(id)) throw new Error(`Enable ${client.name} to open this app`);
      options.signal?.throwIfAborted();
      await setConnected(id, true);
      options.signal?.throwIfAborted();
      if (!client.isConnected()) {
        if (client.isAuthBlocked()) throw new Error(`Sign in required for ${client.name}`);
        throw new Error(`Could not connect to ${client.name}`);
      }
      return client.restoreToolUI(app, args, result, options);
    },
    [getClient, isProviderEnabled, setConnected],
  );
  const setModelOverrides = useCallback((enabled: string[], disabled: string[]) => {
    setModelEnabledTools(new Set(enabled));
    setModelDisabledTools(new Set(disabled));
  }, []);

  return (
    <ToolsContext
      value={{
        providers,
        coreProviders,
        isProviderEnabled,
        getProviderState,
        getProviderPolicy,
        setProviderEnabled,
        setModelOverrides,
        skillSources,
        setSkillSources,
        getSkillsProvider,
        companionAvailable,
        companionEnabled,
        toggleCompanion,
        restoreToolUI,
      }}
    >
      {children}
    </ToolsContext>
  );
}
