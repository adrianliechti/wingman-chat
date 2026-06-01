import { Dialog, Transition } from "@headlessui/react";
import { Edit, ScrollText, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
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
  const [isOverflowing, setIsOverflowing] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const check = () => setIsOverflowing(el.scrollHeight > el.clientHeight);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [agent.instructions]);

  const openDialog = () => {
    setIsDialogOpen(true);
    setIsEditing(false);
    setValue("");
  };

  const openDialogInEditMode = () => {
    setValue(agent.instructions || "");
    setIsEditing(true);
    setIsDialogOpen(true);
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
                          className="w-full h-96 px-3 py-2 text-sm rounded-md bg-white/50 dark:bg-neutral-800/50 border border-neutral-300/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-neutral-500/60 focus:border-transparent text-neutral-900 dark:text-neutral-100 resize-none backdrop-blur-sm transition-colors"
                          placeholder="Enter instructions for this agent..."
                          autoFocus
                        />
                        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                          Instructions help the AI understand how to behave and what context to use.
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="h-96 overflow-auto">
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
                        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 invisible">
                          Instructions help the AI understand how to behave and what context to use.
                        </p>
                      </>
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

      <Section
        title="Instructions"
        icon={<ScrollText size={12} />}
        isOpen={true}
        collapsible={false}
        headerAction={
          <button
            type="button"
            onClick={openDialogInEditMode}
            className="p-0.5 rounded text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
            title="Edit instructions"
            aria-label="Edit instructions"
          >
            <Edit size={13} />
          </button>
        }
      >
        {agent.instructions?.trim() ? (
          <>
            <div ref={previewRef} className="max-h-24 overflow-hidden">
              <div className="prose prose-sm dark:prose-invert max-w-none text-xs text-neutral-700 dark:text-neutral-300 [&>*:first-child]:mt-0">
                <Markdown>{agent.instructions}</Markdown>
              </div>
            </div>
            {isOverflowing && (
              <button
                type="button"
                onClick={openDialog}
                className="mt-1 text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
              >
                Show more
              </button>
            )}
          </>
        ) : (
          <p className="text-xs text-neutral-400 dark:text-neutral-500">No instructions yet.</p>
        )}
      </Section>
    </>
  );
}
