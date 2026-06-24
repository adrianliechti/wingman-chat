import { ChevronDown } from "lucide-react";
import { useEffect } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import type { Agent } from "@/features/agent/types/agent";
import { useChat } from "@/features/chat/hooks/useChat";
import { cn } from "@/shared/lib/cn";
import { ModelDropdown } from "@/shared/ui/ModelDropdown";
import { Section } from "./Section";

interface ModelSectionProps {
  agent: Agent;
}

export function ModelSection({ agent }: ModelSectionProps) {
  const { updateAgent } = useAgents();
  const { models } = useChat();

  const isRealtimeAgent = agent.model === "realtime";

  // Auto-select first non-hidden model if agent has no model or an invalid one
  useEffect(() => {
    if (isRealtimeAgent) return;
    if (models.length === 0) return;
    const valid = agent.model && models.some((m) => m.id === agent.model);
    if (!valid) {
      const firstVisible = models.find((m) => !m.hidden) ?? models[0];
      updateAgent(agent.id, { model: firstVisible.id });
    }
  }, [isRealtimeAgent, agent.id, agent.model, models, updateAgent]);

  const effectiveModel =
    agent.model === "realtime"
      ? "realtime"
      : agent.model && models.some((m) => m.id === agent.model)
        ? agent.model
        : (models.find((m) => !m.hidden)?.id ?? models[0]?.id ?? "");
  const effectiveModelName =
    effectiveModel === "realtime"
      ? "Real-time Voice"
      : (models.find((m) => m.id === effectiveModel)?.name ?? effectiveModel);

  return (
    <Section title="Model" isOpen={true} collapsible={false} overflowVisible headerClassName="pt-2" key={agent.id}>
      <ModelDropdown
        models={models}
        value={effectiveModel}
        onChange={(modelId) => updateAgent(agent.id, { model: modelId })}
        includeRealtime
        trigger={({ getProps }) => (
          <button
            type="button"
            {...getProps()}
            className="w-full flex items-center justify-between rounded-lg bg-white/40 dark:bg-neutral-900/60 py-2 pl-3 pr-8 text-sm text-neutral-900 dark:text-neutral-100 border border-neutral-200/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-slate-500/50 dark:focus:ring-slate-400/50 hover:border-neutral-300/80 dark:hover:border-neutral-600/80 transition-colors backdrop-blur-lg cursor-pointer text-left"
          >
            <span className="truncate">{effectiveModelName}</span>
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
