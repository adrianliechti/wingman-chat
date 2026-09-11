import { Puzzle, Settings2, ToggleLeft, ToggleRight } from "lucide-react";
import { type Dispatch, useMemo } from "react";
import { usePlugins } from "@/features/plugins/hooks/usePlugins";
import { useSkills } from "@/features/skills/hooks/useSkills";
import type { WizardAction } from "../AgentWizard";
import { StepHeader } from "../StepHeader";

interface PluginsStepProps {
  selectedPlugins: string[];
  dispatch: Dispatch<WizardAction>;
}

export function PluginsStep({ selectedPlugins, dispatch }: PluginsStepProps) {
  const { plugins } = usePlugins();
  const { openSkillCatalog } = useSkills();

  const selectedSet = useMemo(() => new Set(selectedPlugins), [selectedPlugins]);

  return (
    <div className="space-y-3">
      <StepHeader
        title="Activate plugins"
        description="Plugins bundle skills and MCP servers installed from a hub. Toggle on the ones this agent should use, or skip this and attach plugins later."
      />

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => openSkillCatalog(undefined, false, "plugins")}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100/60 dark:hover:bg-neutral-800/50 transition-colors"
        >
          <Settings2 size={11} /> Manage plugins
        </button>
      </div>

      <div className="space-y-0.5">
        {plugins.map((plugin) => {
          const isEnabled = selectedSet.has(plugin.id);
          return (
            <div key={plugin.id} className="flex items-center gap-2 py-1.5">
              <span className="text-neutral-600 dark:text-neutral-400">
                {plugin.icon ? (
                  <img src={plugin.icon} alt="" className="w-4 h-4 rounded object-contain" />
                ) : (
                  <Puzzle size={16} />
                )}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate">
                  {plugin.title || plugin.id}
                </div>
                {plugin.description && (
                  <div className="text-xs text-neutral-500 dark:text-neutral-400 line-clamp-1">
                    {plugin.description}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => dispatch({ type: "TOGGLE_PLUGIN", id: plugin.id })}
                className={`shrink-0 ${isEnabled ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400 dark:text-neutral-500"}`}
              >
                {isEnabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
