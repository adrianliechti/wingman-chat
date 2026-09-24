import { ChevronDown } from "lucide-react";
import { useEffect } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import type { Agent } from "@/features/agent/types/agent";
import { useChatModel } from "@/features/chat/hooks/useChat";
import { getSavedModelId } from "@/features/chat/hooks/useModels";
import { cn } from "@/shared/lib/cn";
import { defaultModelId } from "@/shared/lib/models";
import { EFFORT_LABEL, ModelDropdown } from "@/shared/ui/ModelDropdown";
import { Section } from "./Section";

interface ModelSectionProps {
  agent: Agent;
}

export function ModelSection({ agent }: ModelSectionProps) {
  const { updateAgent } = useAgents();
  const { models } = useChatModel();

  const isRealtimeAgent = agent.model === "realtime";

  // Auto-select first non-hidden model if agent has no model or an invalid one
  useEffect(() => {
    if (isRealtimeAgent) return;
    if (models.length === 0) return;
    const valid = agent.model && models.some((m) => m.id === agent.model);
    if (!valid) {
      updateAgent(agent.id, { model: defaultModelId(models, getSavedModelId()) });
    }
  }, [isRealtimeAgent, agent.id, agent.model, models, updateAgent]);

  const effectiveModel =
    agent.model === "realtime"
      ? "realtime"
      : agent.model && models.some((m) => m.id === agent.model)
        ? agent.model
        : defaultModelId(models, getSavedModelId());
  const selectedModel = models.find((m) => m.id === effectiveModel);
  const effectiveModelName =
    effectiveModel === "realtime" ? "Real-time Voice" : (selectedModel?.name ?? effectiveModel);

  const efforts = selectedModel?.supportedEfforts ?? [];
  // Keep the agent's effort only while the chosen model still supports it.
  const selectModel = (modelId: string) => {
    const next = models.find((m) => m.id === modelId);
    const keepEffort = agent.effort && next?.supportedEfforts?.includes(agent.effort);
    updateAgent(agent.id, { model: modelId, effort: keepEffort ? agent.effort : undefined });
  };

  return (
    <Section title="Model" isOpen={true} collapsible={false} overflowVisible headerClassName="pt-2" key={agent.id}>
      <ModelDropdown
        models={models}
        value={effectiveModel}
        onChange={selectModel}
        includeRealtime
        effort={
          efforts.length
            ? {
                options: efforts,
                value: agent.effort ?? null,
                defaultValue: selectedModel?.defaultEffort,
                onChange: (effort) => updateAgent(agent.id, { effort }),
              }
            : undefined
        }
        verbosity={
          isRealtimeAgent
            ? undefined
            : {
                value: agent.verbosity ?? null,
                defaultValue: selectedModel?.verbosity,
                onChange: (verbosity) => updateAgent(agent.id, { verbosity: verbosity ?? undefined }),
              }
        }
        trigger={({ getProps }) => (
          <button
            type="button"
            {...getProps()}
            className="w-full flex items-center justify-between rounded-lg bg-white/40 dark:bg-neutral-900/60 py-2 pl-3 pr-8 text-sm text-neutral-900 dark:text-neutral-100 border border-neutral-200/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-slate-500/50 dark:focus:ring-slate-400/50 hover:border-neutral-300/80 dark:hover:border-neutral-600/80 transition-colors backdrop-blur-lg cursor-pointer text-left"
          >
            <span className="truncate">
              {effectiveModelName}
              {agent.effort && efforts.includes(agent.effort) && (
                <span className="text-neutral-500 dark:text-neutral-400"> {EFFORT_LABEL[agent.effort]}</span>
              )}
            </span>
            <ChevronDown
              size={14}
              className={cn(
                "pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 transition-transform",
              )}
            />
          </button>
        )}
      />
    </Section>
  );
}
