import { Puzzle, Settings2, Sparkles, ToggleLeft, ToggleRight } from "lucide-react";

import { useMemo } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import type { Agent } from "@/features/agent/types/agent";
import { usePlugins } from "@/features/plugins/hooks/usePlugins";
import { useSkills } from "@/features/skills/hooks/useSkills";
import { Tooltip } from "@/shared/ui/Tooltip";
import { Section } from "./Section";

interface SkillsSectionProps {
  agent: Agent;
}

export function SkillsSection({ agent }: SkillsSectionProps) {
  const { updateAgent } = useAgents();
  const { skills: allSkills, openSkillCatalog } = useSkills();
  const { plugins: allPlugins } = usePlugins();

  const agentSkillIds = useMemo(() => new Set(agent.skills || []), [agent.skills]);
  const agentPluginIds = useMemo(() => new Set(agent.plugins || []), [agent.plugins]);

  const skillsEnabled = agentSkillIds.size > 0;

  const toggleSkills = () => {
    if (skillsEnabled) {
      updateAgent(agent.id, { skills: [] });
    } else {
      updateAgent(agent.id, { skills: allSkills.map((s) => s.name) });
    }
  };

  const togglePlugin = (pluginId: string) => {
    const current = agent.plugins || [];
    const next = current.includes(pluginId) ? current.filter((id) => id !== pluginId) : [...current, pluginId];
    updateAgent(agent.id, { plugins: next });
  };

  return (
    <Section
      title="Skills & Plugins"
      isOpen={true}
      collapsible={false}
      headerAction={
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
          onClick={() => openSkillCatalog()}
        >
          <Settings2 size={12} /> Manage
        </button>
      }
    >
      <div className="divide-y divide-neutral-200/40 dark:divide-neutral-700/40">
        <div className="flex items-center gap-2 py-1.5">
          <button
            type="button"
            onClick={() => openSkillCatalog(undefined, false, "skills")}
            className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
          >
            <Tooltip
              content={
                skillsEnabled
                  ? `${agentSkillIds.size} skill${agentSkillIds.size === 1 ? "" : "s"} active — click to manage`
                  : `${allSkills.length} skill${allSkills.length === 1 ? "" : "s"} available — click to add`
              }
              side="left"
              className="inline-flex items-center gap-2 min-w-0"
            >
              <div className={`shrink-0 w-5 h-5 flex items-center justify-center text-neutral-600 dark:text-neutral-400 ${!skillsEnabled ? "opacity-40" : ""}`}>
                <Sparkles size={13} />
              </div>
              <span className={`min-w-0 text-xs truncate ${skillsEnabled ? "text-neutral-900 dark:text-neutral-100 font-medium" : "text-neutral-500 dark:text-neutral-400"}`}>
                My Skills
                {skillsEnabled && (
                  <span className="ml-1 text-neutral-400 dark:text-neutral-500 font-normal">
                    ({agentSkillIds.size})
                  </span>
                )}
              </span>
            </Tooltip>
          </button>
          <button
            type="button"
            onClick={toggleSkills}
            className={`shrink-0 ${skillsEnabled ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400 dark:text-neutral-500"}`}
          >
            {skillsEnabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
          </button>
        </div>

        {allPlugins.map((plugin) => {
          const enabled = agentPluginIds.has(plugin.id);
          return (
            <div key={plugin.id} className="flex items-center gap-2 py-1.5">
              <button
                type="button"
                onClick={() => togglePlugin(plugin.id)}
                className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
              >
                <Tooltip
                  content={plugin.description ?? plugin.title ?? plugin.id}
                  side="left"
                  className="inline-flex items-center gap-2 min-w-0"
                >
                  <div className={`shrink-0 w-5 h-5 flex items-center justify-center text-neutral-600 dark:text-neutral-400 ${!enabled ? "opacity-40" : ""}`}>
                    {plugin.icon
                      ? <img src={plugin.icon} alt="" className="h-4 w-4 rounded object-contain" />
                      : <Puzzle size={13} />}
                  </div>
                  <span className={`min-w-0 text-xs truncate ${enabled ? "text-neutral-900 dark:text-neutral-100 font-medium" : "text-neutral-500 dark:text-neutral-400"}`}>
                    {plugin.title || plugin.id}
                  </span>
                </Tooltip>
              </button>
              <button
                type="button"
                onClick={() => togglePlugin(plugin.id)}
                className={`shrink-0 ${enabled ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400 dark:text-neutral-500"}`}
              >
                {enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
              </button>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
