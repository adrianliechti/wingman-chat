import { useMemo } from "react";
import type { Agent } from "@/features/agent/types/agent";
import { createPluginProvider, pluginProviderId } from "@/features/plugins/lib/pluginProvider";
import { usePlugins } from "@/features/plugins/hooks/usePlugins";
import type { ToolProvider } from "@/shared/types/chat";

export interface PluginProviders {
  /** One ToolProvider per installed plugin — always assembled; enablement is decided by the caller. */
  providers: ToolProvider[];
  /** Provider ids for plugins the active agent requires (locked on), from `agent.plugins`. */
  requiredIds: Set<string>;
}

/**
 * Assembles a ToolProvider for every installed plugin. Unlike the personal
 * Skills tool (one shared `read_skill` surface), each plugin is fully
 * independent — its own tools, its own instructions, no cross-plugin
 * deduplication — so multiple plugins can be enabled at once without
 * colliding.
 */
export function usePluginProviders(agent: Agent | null): PluginProviders {
  const { plugins } = usePlugins();

  return useMemo(() => {
    const providers = plugins.map(createPluginProvider);
    const installedIds = new Set(plugins.map((p) => p.id));
    const requiredIds = new Set(
      (agent?.plugins ?? []).filter((id) => installedIds.has(id)).map((id) => pluginProviderId(id)),
    );
    return { providers, requiredIds };
  }, [plugins, agent]);
}
