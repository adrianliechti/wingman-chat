import { useState, useEffect, useCallback } from 'react';
import { BrainCircuit, ToggleLeft, ToggleRight } from 'lucide-react';
import { useAgents } from '@/features/agent/hooks/useAgents';
import * as opfs from '@/shared/lib/opfs';
import type { Agent } from '@/features/agent/types/agent';
import { Section } from './Section';
import { Markdown } from '@/shared/ui/Markdown';

interface MemorySectionProps {
  agent: Agent;
  isOpen: boolean;
  onToggle: () => void;
}

export function MemorySection({ agent, isOpen, onToggle }: MemorySectionProps) {
  const { updateAgent } = useAgents();
  const [content, setContent] = useState<string | undefined>();

  const loadMemory = useCallback(async () => {
    if (!agent.memory) {
      setContent(undefined);
      return;
    }
    const text = await opfs.readText(`agents/${agent.id}/MEMORY.md`);
    setContent(text || '');
  }, [agent.id, agent.memory]);

  useEffect(() => {
    if (isOpen) { loadMemory(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, agent.memory]);

  // Live-update when the agent writes memory
  useEffect(() => {
    if (!isOpen || !agent.memory) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.agentId === agent.id) loadMemory();
    };
    window.addEventListener('memory-updated', handler);
    return () => window.removeEventListener('memory-updated', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, agent.memory, agent.id]);

  const toggleMemory = () => {
    updateAgent(agent.id, { memory: !agent.memory });
  };

  return (
    <Section
      title="Memory"
      icon={<BrainCircuit size={16} />}
      isOpen={isOpen}
      onOpenToggle={onToggle}
      headerAction={
        <button
          type="button"
          onClick={toggleMemory}
          className={`shrink-0 ${agent.memory ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-400 dark:text-neutral-500'}`}
          title={agent.memory ? 'Memory enabled (click to disable)' : 'Memory disabled (click to enable)'}
        >
          {agent.memory ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
        </button>
      }
    >
      <div className="space-y-2">
        {/* Content */}
        {agent.memory && (
          <div className="text-sm bg-white/30 dark:bg-neutral-900/60 rounded-lg border border-neutral-200/40 dark:border-neutral-700/40 backdrop-blur-lg overflow-hidden">
            {content ? (
              <div className="p-3 max-h-64 overflow-auto">
                <div style={{ transform: 'scale(0.8)', transformOrigin: 'top left', width: '125%' }}>
                  <Markdown>{content}</Markdown>
                </div>
              </div>
            ) : (
              <p className="p-3 text-xs text-neutral-400 dark:text-neutral-500 text-center italic">
                No memories yet. The agent will write here as you chat.
              </p>
            )}
          </div>
        )}

        {!agent.memory && (
          <p className="text-[10px] text-neutral-400 dark:text-neutral-500">
            Enable to let this agent remember context across conversations.
          </p>
        )}
      </div>
    </Section>
  );
}
