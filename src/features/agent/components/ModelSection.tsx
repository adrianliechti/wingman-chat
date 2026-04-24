import { ChevronDown } from "lucide-react";
import { useEffect } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import type { Agent } from "@/features/agent/types/agent";
import { useChat } from "@/features/chat/hooks/useChat";
import { Section } from "./Section";

interface ModelSectionProps {
  agent: Agent;
}

export function ModelSection({ agent }: ModelSectionProps) {
  const { updateAgent } = useAgents();
  const { models } = useChat();

  const isRealtimeAgent = agent.model === "realtime";

  // Auto-select first model if agent has no model or an invalid one
  useEffect(() => {
    if (isRealtimeAgent) return;
    if (models.length === 0) return;
    const valid = agent.model && models.some((m) => m.id === agent.model);
    if (!valid) {
      updateAgent(agent.id, { model: models[0].id });
    }
  }, [isRealtimeAgent, agent.id, agent.model, models, updateAgent]);

  const handleSelect = (modelId: string) => {
    updateAgent(agent.id, { model: modelId });
  };

  const effectiveModel = agent.model && models.some((m) => m.id === agent.model) ? agent.model : (models[0]?.id ?? "");

  if (isRealtimeAgent) {
    return (
      <Section title="Model" isOpen={true} collapsible={false}>
        <div className="relative">
          <input
            type="text"
            value="Real-time Voice"
            disabled
            className="w-full rounded-lg bg-neutral-100/60 dark:bg-neutral-800/40 py-2 pl-3 pr-3 text-sm text-neutral-400 dark:text-neutral-500 border border-neutral-200/60 dark:border-neutral-700/60 cursor-not-allowed"
          />
        </div>
      </Section>
    );
  }

  return (
    <Section title="Model" isOpen={true} collapsible={false}>
      <div className="relative">
        <select
          value={effectiveModel}
          onChange={(e) => handleSelect(e.target.value)}
          className="w-full appearance-none rounded-lg bg-white/40 dark:bg-neutral-900/60 py-2 pl-3 pr-8 text-sm text-neutral-900 dark:text-neutral-100 border border-neutral-200/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-slate-500/50 dark:focus:ring-slate-400/50 hover:border-neutral-300/80 dark:hover:border-neutral-600/80 transition-colors backdrop-blur-lg cursor-pointer"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name ?? m.id}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
        />
      </div>
    </Section>
  );
}
