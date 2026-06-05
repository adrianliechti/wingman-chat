import { Dialog, Transition } from "@headlessui/react";
import { Edit, Pencil, X } from "lucide-react";
import { Fragment, useState } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import type { Agent } from "@/features/agent/types/agent";
import { Markdown } from "@/shared/ui/Markdown";
import { Section } from "./Section";
import { SectionEmptyState } from "./SectionEmptyState";

interface InstructionsSectionProps {
  agent: Agent;
}

export function InstructionsSection({ agent }: InstructionsSectionProps) {
  const { updateAgent } = useAgents();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState("");

  const openDialog = (editMode = false) => {
    const existing = agent.instructions || "";
    setIsDialogOpen(true);
    if (editMode || !existing.trim()) {
      setValue(existing);
      setIsEditing(true);
    } else {
      setIsEditing(false);
      setValue("");
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
                          // biome-ignore lint/a11y/noAutofocus: intentional focus when editing
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
                  <div className="flex items-center justify-between px-5 py-3 border-t border-neutral-200/60 dark:border-neutral-800/60 bg-neutral-50/50 dark:bg-neutral-900/30">
                    {isEditing ? (
                      <>
                        <span />
                        <div className="flex items-center gap-2.5">
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
                        </div>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={startEditing}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors"
                        >
                          <Pencil size={13} /> Edit
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

      <Section
        title="Instructions"
        isOpen={true}
        collapsible={false}
        headerAction={
          agent.instructions?.trim() ? (
            <button
              type="button"
              onClick={() => openDialog(true)}
              className="flex items-center gap-1 text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
            >
              <Edit size={12} /> Edit
            </button>
          ) : null
        }
      >
        <div>
          {agent.instructions?.trim() ? (
            <div
              className="relative rounded-xl border border-neutral-200/70 dark:border-neutral-700/50 bg-neutral-50/60 dark:bg-neutral-800/30 overflow-hidden cursor-pointer"
              onClick={() => openDialog(false)}
            >
              <div className="relative px-3.5 pt-3 pb-3">
                <div className="prose prose-xs dark:prose-invert max-w-none text-xs [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 line-clamp-4 text-neutral-600 dark:text-neutral-400">
                  <Markdown>{agent.instructions}</Markdown>
                </div>
                <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-neutral-50/80 dark:from-transparent to-transparent pointer-events-none" />
              </div>
            </div>
          ) : (
            <SectionEmptyState
              icon={<Edit size={12} />}
              label="Add instructions"
              description="Guide how this agent behaves"
              onClick={openDialog}
            />
          )}
        </div>
      </Section>
    </>
  );
}
