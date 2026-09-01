import { useEffect, useMemo, useRef, useState } from "react";
import type { Agent } from "@/features/agent/types/agent";
import { pluginMcpClientId, pluginProviderId } from "@/features/plugins/lib/pluginProvider";
import type { InstalledPlugin } from "@/features/plugins/lib/types";
import { usePlugins } from "@/features/plugins/hooks/usePlugins";
import { MCPClient } from "@/features/settings/lib/mcp";

export interface PluginProviders {
  /** All installed plugins, for assembling skill entries. */
  plugins: InstalledPlugin[];
  /** Provider ids for plugins the active agent requires (locked on), from `agent.plugins`. */
  requiredIds: Set<string>;
  /** MCP clients for plugin-bundled servers (url-type only). */
  mcpClients: MCPClient[];
  /** Maps plugin provider id → its MCP client ids, for connection lifecycle. */
  mcpClientsByProvider: Map<string, string[]>;
}

export function usePluginProviders(agent: Agent | null): PluginProviders {
  const { plugins } = usePlugins();

  const [mcpClients, setMcpClients] = useState<MCPClient[]>([]);
  const clientsRef = useRef<MCPClient[]>([]);

  useEffect(() => {
    const desired = new Map<string, { url: string; name: string; description: string }>();
    for (const plugin of plugins) {
      for (const server of plugin.mcpServers ?? []) {
        if (!server.url) continue;
        desired.set(pluginMcpClientId(plugin.id, server.name), {
          url: server.url,
          name: server.name,
          description: plugin.description ?? plugin.title ?? plugin.id,
        });
      }
    }

    const existingIds = new Set(clientsRef.current.map((c) => c.id));
    const desiredIds = new Set(desired.keys());
    const needsUpdate =
      existingIds.size !== desiredIds.size || clientsRef.current.some((c) => !desiredIds.has(c.id));

    if (!needsUpdate) return;

    const removed = clientsRef.current.filter((c) => !desiredIds.has(c.id));
    removed.forEach((c) => c.disconnect().catch(console.error));

    const next = [...desired.entries()].map(([id, { url, name, description }]) => {
      const existing = clientsRef.current.find((c) => c.id === id);
      return existing ?? new MCPClient(id, url, name, description);
    });

    clientsRef.current = next;
    setMcpClients(next);
  }, [plugins]);

  useEffect(() => {
    const clients = clientsRef;
    return () => {
      clients.current.forEach((c) => c.disconnect().catch(console.error));
    };
  }, []);

  return useMemo(() => {
    const installedIds = new Set(plugins.map((p) => p.id));
    const requiredIds = new Set(
      (agent?.plugins ?? []).filter((id) => installedIds.has(id)).map((id) => pluginProviderId(id)),
    );

    const mcpClientsByProvider = new Map<string, string[]>();
    for (const plugin of plugins) {
      const clientIds = (plugin.mcpServers ?? [])
        .filter((s) => s.url)
        .map((s) => pluginMcpClientId(plugin.id, s.name));
      if (clientIds.length) mcpClientsByProvider.set(pluginProviderId(plugin.id), clientIds);
    }

    return { plugins, requiredIds, mcpClients, mcpClientsByProvider };
  }, [plugins, agent, mcpClients]);
}
