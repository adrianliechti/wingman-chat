import { useMemo } from "react";
import type { Agent } from "@/features/agent/types/agent";
import { pluginMcpClientId, pluginProviderId } from "@/features/plugins/lib/pluginProvider";
import { usePlugins } from "@/features/plugins/hooks/usePlugins";
import { normalizeMcpServer, type McpServerDefinition } from "@/features/settings/lib/mcpConfig";

/** Plugin inventory and declarations; useMcpClients owns all live connections. */
export function usePluginProviders(agent: Agent | null) {
  const { plugins, isLoaded } = usePlugins();
  return useMemo(() => {
    const installedIds = new Set(plugins.map((p) => p.id));
    const requiredIds = new Set((agent?.plugins ?? []).filter((id) => installedIds.has(id)).map(pluginProviderId));
    const servers: McpServerDefinition[] = [];
    for (const plugin of plugins) {
      for (const server of plugin.mcpServers ?? []) {
        if (!server.url || server.type === "stdio") continue;
        const normalized = normalizeMcpServer({
          id: pluginMcpClientId(plugin.id, server.name),
          source: "plugin",
          ownerId: pluginProviderId(plugin.id),
          url: server.url,
          name: server.name,
          description: plugin.description ?? plugin.title ?? plugin.id,
          headers: server.headers,
          approval: server.approval,
        });
        if (normalized) servers.push(normalized);
      }
    }
    return { plugins, isLoaded, requiredIds, servers };
  }, [plugins, isLoaded, agent]);
}

export type PluginProviders = ReturnType<typeof usePluginProviders>;
