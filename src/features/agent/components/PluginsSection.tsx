import { Puzzle, Settings2, X } from "lucide-react";
import { useMemo } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import type { Agent } from "@/features/agent/types/agent";
import { usePlugins } from "@/features/plugins/hooks/usePlugins";
import { useSkills } from "@/features/skills/hooks/useSkills";
import { Section } from "./Section";
import { SectionEmptyState } from "./SectionEmptyState";

interface PluginsSectionProps {
  agent: Agent;
}

export function PluginsSection({ agent }: PluginsSectionProps) {
  const { updateAgent } = useAgents();
  const { plugins: allPlugins } = usePlugins();
  const { openSkillCatalog } = useSkills();

  const openManager = () => openSkillCatalog(undefined, false, "plugins");

  const agentPluginIds = useMemo(() => new Set(agent.plugins || []), [agent.plugins]);

  const enabledPlugins = useMemo(
    () =>
      allPlugins
        .filter((p) => agentPluginIds.has(p.id))
        .sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id)),
    [allPlugins, agentPluginIds],
  );

  const togglePlugin = (pluginId: string) => {
    const current = agent.plugins || [];
    const next = current.includes(pluginId)
      ? current.filter((id) => id !== pluginId)
      : [...current, pluginId];
    updateAgent(agent.id, { plugins: next });
  };

  return (
    <Section
      title="Plugins"
      count={enabledPlugins.length}
      isOpen={true}
      collapsible={false}
      headerAction={
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
          onClick={openManager}
        >
          <Settings2 size={12} /> Manage plugins
        </button>
      }
    >
      {enabledPlugins.length === 0 && (
        <SectionEmptyState
          icon={<Puzzle size={13} />}
          label="No plugins attached"
          description={
            allPlugins.length === 0
              ? "Browse the plugin store to install one"
              : "Attach installed plugins to extend this agent"
          }
          onClick={allPlugins.length === 0 ? openManager : undefined}
        />
      )}

      {enabledPlugins.length > 0 && (
        <div className="divide-y divide-neutral-200/40 dark:divide-neutral-700/40">
          {enabledPlugins.map((plugin) => (
            <div key={plugin.id} className="flex items-center gap-2 py-1.5">
              <div className="shrink-0 w-5 h-5 rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 flex items-center justify-center text-neutral-500 dark:text-neutral-400">
                <Puzzle size={11} />
              </div>
              <span
                className="flex-1 min-w-0 text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate"
                title={plugin.description}
              >
                {plugin.title || plugin.id}
              </span>
              <button
                type="button"
                onClick={() => togglePlugin(plugin.id)}
                className="shrink-0 p-1 rounded text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
                title="Remove plugin"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {allPlugins.length > enabledPlugins.length && (
        <div className="mt-1 flex flex-wrap gap-1">
          {allPlugins
            .filter((p) => !agentPluginIds.has(p.id))
            .map((plugin) => (
              <button
                key={plugin.id}
                type="button"
                onClick={() => togglePlugin(plugin.id)}
                className="inline-flex items-center gap-1 rounded-full border border-neutral-200/70 dark:border-neutral-700/50 px-2 py-0.5 text-[11px] text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100/60 dark:hover:bg-neutral-800/60 transition-colors"
              >
                <Puzzle size={10} />
                {plugin.title || plugin.id}
              </button>
            ))}
        </div>
      )}
    </Section>
  );
}
