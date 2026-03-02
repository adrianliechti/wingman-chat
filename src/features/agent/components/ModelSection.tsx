import { useState } from 'react';
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
  const [isOpen, setIsOpen] = useState(true);

  const selectedModel = models.find(m => m.id === agent.model);

  const handleSelect = (modelId: string | null) => {
    updateAgent(agent.id, { model: modelId || undefined });
  };

  return (
    <Section
      title="Model"
      icon={<Cpu size={16} />}
      isOpen={isOpen}
      onOpenToggle={() => setIsOpen(!isOpen)}
    >
      <div className="relative">
        <select
          value={agent.model || ''}
          onChange={e => handleSelect(e.target.value || null)}
          className="w-full appearance-none rounded-lg bg-white/40 dark:bg-neutral-900/60 py-2 pl-3 pr-8 text-sm text-neutral-900 dark:text-neutral-100 border border-neutral-200/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-slate-500/50 dark:focus:ring-slate-400/50 hover:border-neutral-300/80 dark:hover:border-neutral-600/80 transition-colors backdrop-blur-lg cursor-pointer"
        >
          <option value="">Default</option>
          {models.map(m => (
            <option key={m.id} value={m.id}>
              {m.name ?? m.id}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
      </div>
      {selectedModel?.description && (
        <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          {selectedModel.description}
        </p>
      )}
    </Section>
  );
}
