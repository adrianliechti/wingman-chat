import { ToggleLeft, ToggleRight, Wrench } from "lucide-react";
import { type Dispatch, useMemo } from "react";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import type { WizardAction } from "../AgentWizard";
import { StepHeader } from "../StepHeader";

interface ToolsStepProps {
  selectedTools: string[];
  dispatch: Dispatch<WizardAction>;
}

const AGENT_INTERNAL_IDS = new Set(["artifacts", "repository", "skills", "memory"]);

export function ToolsStep({ selectedTools, dispatch }: ToolsStepProps) {
  const { providers } = useToolsContext();

  const selectedSet = useMemo(() => new Set(selectedTools), [selectedTools]);

  const availableTools = useMemo(
    () =>
      providers
        .filter((p) => !AGENT_INTERNAL_IDS.has(p.id))
        .map((p) => ({ id: p.id, label: p.name, description: p.description, Icon: p.icon })),
    [providers],
  );

  return (
    <div className="space-y-3">
      <StepHeader
        title="Enable tools"
        description="Enable optional tools such as web search and connected services. Document, data and design skills are available by default. You can change these choices later."
      />

      <div className="space-y-0.5">
        {availableTools.map((tool) => {
          const isEnabled = selectedSet.has(tool.id);
          return (
            <div key={tool.id} className="flex items-center gap-2 py-1.5">
              <span className="text-neutral-600 dark:text-neutral-400">
                {!tool.Icon ? (
                  <Wrench size={16} />
                ) : typeof tool.Icon === "string" ? (
                  <img src={tool.Icon} alt="" className="w-4 h-4 object-contain" />
                ) : (
                  <tool.Icon width={16} height={16} />
                )}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate">{tool.label}</div>
                {tool.description && (
                  <div className="text-xs text-neutral-500 dark:text-neutral-400 line-clamp-1">{tool.description}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => dispatch({ type: "TOGGLE_TOOL", id: tool.id })}
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
