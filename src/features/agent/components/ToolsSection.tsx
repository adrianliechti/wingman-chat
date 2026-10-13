import { ToggleLeft, ToggleRight, Wrench } from "lucide-react";
import { useMemo } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import type { Agent } from "@/features/agent/types/agent";
import { PLUGIN_PROVIDER_PREFIX } from "@/features/plugins/lib/pluginProvider";
import { useToolsContext } from "@/features/tools/hooks/useToolsContext";
import { McpProviderIcon } from "@/shared/ui/McpProviderIcon";
import { Tooltip } from "@/shared/ui/Tooltip";
import { Section } from "./Section";

interface ToolsSectionProps {
  agent: Agent;
}

const AGENT_INTERNAL_IDS = new Set(["repository", "skills", "memory", "artifacts"]);

export function ToolsSection({ agent }: ToolsSectionProps) {
  const { updateAgent } = useAgents();
  const { providers } = useToolsContext();

  const availableTools = useMemo(() => {
    return providers
      .filter((p) => !AGENT_INTERNAL_IDS.has(p.id) && !p.id.startsWith(PLUGIN_PROVIDER_PREFIX))
      .map((p) => ({ id: p.id, label: p.name, description: p.description, Icon: p.icon }));
  }, [providers]);

  const agentToolIds = useMemo(() => new Set(agent.tools || []), [agent.tools]);

  const toggleTool = (toolId: string) => {
    const current = agent.tools || [];
    const next = current.includes(toolId) ? current.filter((id) => id !== toolId) : [...current, toolId];
    updateAgent(agent.id, { tools: next });
  };

  return (
    <Section title="Tools" isOpen={true} collapsible={false}>
      <div className="divide-y divide-neutral-200/40 dark:divide-neutral-700/40">
        {availableTools.map((tool) => {
          const enabled = agentToolIds.has(tool.id);
          return (
            <div key={tool.id} className="flex items-center gap-2 py-1.5">
              <button
                type="button"
                onClick={() => toggleTool(tool.id)}
                className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
              >
                <Tooltip
                  content={tool.description ?? tool.label}
                  side="left"
                  className="inline-flex items-center gap-2 min-w-0"
                >
                  <div
                    className={`shrink-0 w-5 h-5 flex items-center justify-center text-neutral-600 dark:text-neutral-400 ${!enabled ? "opacity-40" : ""}`}
                  >
                    {!tool.Icon ? (
                      <Wrench size={13} />
                    ) : typeof tool.Icon === "string" ? (
                      <McpProviderIcon src={tool.Icon} size={13} />
                    ) : (
                      <tool.Icon width={13} height={13} />
                    )}
                  </div>
                  <span
                    className={`min-w-0 text-xs truncate ${enabled ? "text-neutral-900 dark:text-neutral-100 font-medium" : "text-neutral-500 dark:text-neutral-400"}`}
                  >
                    {tool.label}
                  </span>
                </Tooltip>
              </button>
              <button
                type="button"
                onClick={() => toggleTool(tool.id)}
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
