import { useEffect } from 'react';
import { Cpu, ChevronDown } from 'lucide-react';
import { useAgents } from '@/features/agent/hooks/useAgents';
import { useChat } from '@/features/chat/hooks/useChat';
import type { Agent } from '@/features/agent/types/agent';
import { Section } from './Section';

interface ModelSectionProps {
  agent: Agent;
}

export function ModelSection({ agent }: ModelSectionProps) {
  const { updateAgent } = useAgents();
  const { models } = useChat();

  // Auto-select first model if agent has no model or an invalid one
  useEffect(() => {
    if (models.length === 0) return;
    const valid = agent.model && models.some(m => m.id === agent.model);
    if (!valid) {
      updateAgent(agent.id, { model: models[0].id });
    }
  }, [agent.id, agent.model, models, updateAgent]);

  const handleSelect = (modelId: string) => {
    updateAgent(agent.id, { model: modelId });
  };

  const effectiveModel = agent.model && models.some(m => m.id === agent.model)
    ? agent.model
    : models[0]?.id ?? '';

  return (
    <Section
      title="Model"
      icon={<Cpu size={16} />}
      isOpen={true}
      collapsible={false}
    >
      <div className="relative">
        <select
          value={effectiveModel}
          onChange={e => handleSelect(e.target.value)}
          className="w-full appearance-none rounded-lg bg-white/40 dark:bg-neutral-900/60 py-2 pl-3 pr-8 text-sm text-neutral-900 dark:text-neutral-100 border border-neutral-200/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-slate-500/50 dark:focus:ring-slate-400/50 hover:border-neutral-300/80 dark:hover:border-neutral-600/80 transition-colors backdrop-blur-lg cursor-pointer"
        >
          {models.map(m => (
            <option key={m.id} value={m.id}>
              {m.name ?? m.id}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
      </div>
    </Section>
  );
}
