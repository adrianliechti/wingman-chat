import { useState, Fragment } from 'react';
import { PenLine, Edit } from 'lucide-react';
import { Dialog, Transition } from '@headlessui/react';
import { useAgents } from '@/features/agent/hooks/useAgents';
import type { Agent } from '@/features/agent/types/agent';
import { Section } from './Section';

interface InstructionsSectionProps {
  agent: Agent;
  isOpen: boolean;
  onToggle: () => void;
}

export function InstructionsSection({ agent, isOpen, onToggle }: InstructionsSectionProps) {
  const { updateAgent } = useAgents();
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState('');

  const startEditing = () => {
    setValue(agent.instructions || '');
    setIsEditing(true);
  };

  const save = () => {
    updateAgent(agent.id, { instructions: value.trim() || undefined });
    setIsEditing(false);
  };

  const cancel = () => {
    setIsEditing(false);
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  };

  return (
    <>
      {/* Edit Dialog */}
      <Transition appear show={isEditing} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={cancel}>
          <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-black/25 backdrop-blur-sm" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100" leave="ease-in duration-200" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95">
                <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-white dark:bg-neutral-800 p-6 text-left align-middle shadow-xl transition-all">
                  <div className="space-y-4">
                    <p className="text-sm text-neutral-600 dark:text-neutral-400">
                      Instructions help the AI understand how to behave and what context to use for this agent.
                    </p>
                    <textarea
                      value={value}
                      onChange={e => setValue(e.target.value)}
                      onKeyDown={handleKeyDown}
                      rows={12}
                      className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-md bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 focus:ring-2 focus:ring-slate-500 focus:border-transparent resize-y min-h-50"
                      placeholder="Enter instructions for this agent..."
                      autoFocus
                    />
                    <div className="flex gap-3 justify-end pt-2">
                      <button type="button" onClick={cancel} className="px-4 py-2 text-sm bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-700 dark:text-neutral-300 rounded-md transition-colors">
                        Cancel
                      </button>
                      <button type="button" onClick={save} className="px-4 py-2 text-sm bg-slate-600 hover:bg-slate-700 text-white rounded-md transition-colors">
                        Save Instructions
                      </button>
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      <Section
        title="Instructions"
        icon={<PenLine size={16} />}
        isOpen={isOpen}
        onOpenToggle={onToggle}
      >
        <div
          onClick={startEditing}
          className="text-sm text-neutral-500 dark:text-neutral-400 bg-white/30 dark:bg-neutral-900/60 p-3 rounded-lg border-2 border-dashed border-neutral-300 dark:border-neutral-600 cursor-pointer hover:border-slate-400 dark:hover:border-slate-500 hover:bg-white/40 dark:hover:bg-neutral-900/80 transition-colors backdrop-blur-lg"
        >
          {agent.instructions?.trim() ? (
            <p className="line-clamp-3 text-neutral-700 dark:text-neutral-300">{agent.instructions}</p>
          ) : (
            <div className="flex items-center justify-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
              <Edit size={12} /> Add instructions
            </div>
          )}
        </div>
      </Section>
    </>
  );
}
