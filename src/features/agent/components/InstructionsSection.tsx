import { Dialog, Transition } from "@headlessui/react";
import { Edit, X } from "lucide-react";
import { Fragment, useState } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import type { Agent } from "@/features/agent/types/agent";
import { Markdown } from "@/shared/ui/Markdown";
import { Section } from "./Section";

interface InstructionsSectionProps {
  agent: Agent;
}

export function InstructionsSection({ agent }: InstructionsSectionProps) {
  const { updateAgent } = useAgents();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState("");

  const openDialog = () => {
    const existing = agent.instructions || "";
    setIsDialogOpen(true);
    if (existing.trim()) {
      setIsEditing(false);
      setValue("");
    } else {
      setValue("");
      setIsEditing(true);
    }
  };

  const startEditing = () => {
    setValue(agent.instructions || "");
    setIsEditing(true);
  };

  const save = () => {
    const trimmed = value.trim();
    updateAgent(agent.id, { instructions: trimmed || undefined });
    setIsEditing(false);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setIsEditing(false);
    setValue("");
  };

  const cancelEditing = () => {
    if (agent.instructions?.trim()) {
      setIsEditing(false);
      setValue("");
    } else {
      closeDialog();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (isEditing) cancelEditing();
      else closeDialog();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  };

  return (
    <>
      {/* Edit Dialog */}
      <Transition appear show={isDialogOpen} as={Fragment}>
        <Dialog as="div" className="relative z-80" onClose={closeDialog}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/40 dark:bg-black/60" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-lg transform overflow-hidden rounded-xl bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl shadow-xl transition-all">
                  {/* Header */}
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-200/60 dark:border-neutral-800/60">
                    <Dialog.Title className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                      Instructions
                    </Dialog.Title>
                    <button
                      type="button"
                      onClick={closeDialog}
                      className="p-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {/* Content */}
                  <div className="px-5 py-3.5">
                    {isEditing ? (
                      <>
                        <textarea
                          value={value}
                          onChange={(e) => setValue(e.target.value)}
                          onKeyDown={handleKeyDown}
                          rows={12}
                          className="w-full px-3 py-2 text-sm rounded-md bg-white/50 dark:bg-neutral-800/50 border border-neutral-300/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-neutral-500/60 focus:border-transparent text-neutral-900 dark:text-neutral-100 resize-y min-h-50 backdrop-blur-sm transition-colors"
                          placeholder="Enter instructions for this agent..."
                          autoFocus
                        />
                        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                          Instructions help the AI understand how to behave and what context to use.
                        </p>
                      </>
                    ) : (
                      <div className="max-h-96 overflow-auto">
                        {agent.instructions?.trim() ? (
                          <div className="prose prose-sm dark:prose-invert max-w-none text-sm [&>*:first-child]:mt-0">
                            <Markdown>{agent.instructions}</Markdown>
                          </div>
                        ) : (
                          <p className="text-sm text-neutral-400 dark:text-neutral-500 italic text-center py-8">
                            No instructions yet.
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-end gap-2.5 px-5 py-3 border-t border-neutral-200/60 dark:border-neutral-800/60 bg-neutral-50/50 dark:bg-neutral-900/30">
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={cancelEditing}
                          className="px-3 py-1.5 text-xs font-medium rounded-md text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={save}
                          className="px-3 py-1.5 text-xs font-medium rounded-md bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 hover:opacity-90 transition-colors"
                        >
                          Save
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={startEditing}
                          className="px-3 py-1.5 text-xs font-medium rounded-md text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={closeDialog}
                          className="px-3 py-1.5 text-xs font-medium rounded-md text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors"
                        >
                          Close
                        </button>
                      </>
                    )}
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      <Section title="Instructions" isOpen={true} collapsible={false}>
        <div className="space-y-2">
          {agent.instructions?.trim() && (
            <div className="relative rounded-lg border border-neutral-200/60 dark:border-neutral-700/60 bg-white/40 dark:bg-neutral-900/30 backdrop-blur-sm p-2 overflow-hidden">
              <button
                type="button"
                onClick={openDialog}
                className="absolute top-1.5 right-1.5 z-10 p-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100/70 dark:hover:bg-neutral-800/70 transition-colors"
                title="Edit instructions"
                aria-label="Edit instructions"
              >
                <Edit size={11} />
              </button>
              <div className="max-h-24 overflow-hidden">
                <div className="origin-top-left scale-[0.8] w-[125%] pr-6">
                  <div className="prose prose-sm dark:prose-invert max-w-none text-xs text-neutral-700 dark:text-neutral-300 [&>*:first-child]:mt-0">
                    <Markdown>{agent.instructions}</Markdown>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!agent.instructions?.trim() && (
            <div className="relative rounded-lg border border-neutral-200/60 dark:border-neutral-700/60 bg-white/30 dark:bg-neutral-900/20 backdrop-blur-sm p-2 min-h-10">
              <button
                type="button"
                onClick={openDialog}
                className="absolute top-1.5 right-1.5 p-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100/70 dark:hover:bg-neutral-800/70 transition-colors"
                title="Edit instructions"
                aria-label="Edit instructions"
              >
                <Edit size={11} />
              </button>
              <p className="text-[10px] text-neutral-400 dark:text-neutral-500">No instructions yet.</p>
            </div>
          )}
        </div>
      </Section>
    </>
  );
}
