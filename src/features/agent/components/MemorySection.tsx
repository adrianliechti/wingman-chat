import { useState, useEffect, useCallback, Fragment } from "react";
import { ToggleLeft, ToggleRight, Edit, Trash2, Pencil, X } from "lucide-react";
import { Dialog, Transition } from "@headlessui/react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import * as opfs from "@/shared/lib/opfs";
import type { Agent } from "@/features/agent/types/agent";
import { Section } from "./Section";
import { Markdown } from "@/shared/ui/Markdown";

interface MemorySectionProps {
  agent: Agent;
}

export function MemorySection({ agent }: MemorySectionProps) {
  const { updateAgent } = useAgents();
  const [content, setContent] = useState<string | undefined>();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");

  const memoryPath = `agents/${agent.id}/MEMORY.md`;

  const loadMemory = useCallback(async () => {
    if (!agent.memory) {
      setContent(undefined);
      return;
    }
    const text = await opfs.readText(memoryPath);
    setContent(text || "");
  }, [agent.memory, memoryPath]);

  useEffect(() => {
    loadMemory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.memory]);

  // Live-update when the agent writes memory
  useEffect(() => {
    if (!agent.memory) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.agentId === agent.id) loadMemory();
    };
    window.addEventListener("memory-updated", handler);
    return () => window.removeEventListener("memory-updated", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.memory, agent.id]);

  const toggleMemory = () => {
    updateAgent(agent.id, { memory: !agent.memory });
  };

  const openDialog = () => {
    setIsEditing(false);
    setIsDialogOpen(true);
  };

  const startEditing = () => {
    setEditValue(content || "");
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditValue("");
  };

  const save = async () => {
    const trimmed = editValue.trim();
    if (trimmed) {
      await opfs.writeText(memoryPath, trimmed);
    } else {
      await opfs.deleteFile(memoryPath);
    }
    setContent(trimmed);
    setIsEditing(false);
  };

  const clearMemory = async () => {
    await opfs.deleteFile(memoryPath);
    setContent("");
    setEditValue("");
    setIsEditing(false);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setIsEditing(false);
    setEditValue("");
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
      {/* Memory Dialog */}
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
                <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-xl bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl shadow-xl transition-all">
                  {/* Header */}
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-200/60 dark:border-neutral-800/60">
                    <Dialog.Title className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                      Memory
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
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={handleKeyDown}
                          rows={14}
                          className="w-full px-3 py-2 text-sm rounded-md bg-white/50 dark:bg-neutral-800/50 border border-neutral-300/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-blue-500/60 focus:border-transparent text-neutral-900 dark:text-neutral-100 resize-y min-h-50 backdrop-blur-sm transition-colors"
                          placeholder="No memories yet. The agent will write here as you chat."
                          autoFocus
                        />
                        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                          Memory is written by the agent during conversations. You can also edit it manually.
                        </p>
                      </>
                    ) : (
                      <div className="max-h-96 overflow-auto">
                        {content?.trim() ? (
                          <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                            <Markdown>{content}</Markdown>
                          </div>
                        ) : (
                          <p className="text-sm text-neutral-400 dark:text-neutral-500 italic text-center py-8">
                            No memories yet. The agent will write here as you chat.
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between px-5 py-3 border-t border-neutral-200/60 dark:border-neutral-800/60 bg-neutral-50/50 dark:bg-neutral-900/30">
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={clearMemory}
                          disabled={!editValue.trim()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-red-300/60 dark:border-red-800/60 text-red-600 dark:text-red-400 hover:bg-red-50/50 dark:hover:bg-red-950/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          <Trash2 size={13} /> Clear
                        </button>
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
                            className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600/90 text-white hover:bg-blue-600 transition-colors"
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
        title="Memory"
        isOpen={true}
        collapsible={false}
        headerAction={
          <button
            type="button"
            onClick={toggleMemory}
            className={`shrink-0 ${agent.memory ? "text-blue-600 dark:text-blue-400" : "text-neutral-400 dark:text-neutral-500"}`}
            title={agent.memory ? "Memory enabled (click to disable)" : "Memory disabled (click to enable)"}
          >
            {agent.memory ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
          </button>
        }
      >
        {agent.memory ? (
          <div className="space-y-2">
            {content?.trim() && (
              <div className="relative rounded-lg border border-neutral-200/60 dark:border-neutral-700/60 bg-white/40 dark:bg-neutral-900/30 backdrop-blur-sm p-2 overflow-hidden">
                <button
                  type="button"
                  onClick={openDialog}
                  className="absolute top-1.5 right-1.5 z-10 p-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100/70 dark:hover:bg-neutral-800/70 transition-colors"
                  title="Edit memory"
                  aria-label="Edit memory"
                >
                  <Edit size={11} />
                </button>
                <div className="max-h-24 overflow-hidden">
                  <div className="origin-top-left scale-[0.8] w-[125%] pr-6">
                    <div className="prose prose-sm dark:prose-invert max-w-none text-xs text-neutral-700 dark:text-neutral-300 [&>*:first-child]:mt-0">
                      <Markdown>{content}</Markdown>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!content?.trim() && (
              <div className="relative rounded-lg border border-neutral-200/60 dark:border-neutral-700/60 bg-white/30 dark:bg-neutral-900/20 backdrop-blur-sm p-2 min-h-10">
                <button
                  type="button"
                  onClick={openDialog}
                  className="absolute top-1.5 right-1.5 p-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100/70 dark:hover:bg-neutral-800/70 transition-colors"
                  title="Edit memory"
                  aria-label="Edit memory"
                >
                  <Edit size={11} />
                </button>
                <p className="text-[10px] text-neutral-400 dark:text-neutral-500">No memories yet.</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[10px] text-neutral-400 dark:text-neutral-500">
            Enable to let this agent remember context across conversations.
          </p>
        )}
      </Section>
    </>
  );
}
