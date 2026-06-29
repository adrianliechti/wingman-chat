import { Dialog, Transition } from "@headlessui/react";
import { Edit, Pencil, ToggleLeft, ToggleRight, Trash2, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import type { Agent } from "@/features/agent/types/agent";
import { cn } from "@/shared/lib/cn";
import { confirm } from "@/shared/lib/confirm";
import * as opfs from "@/shared/lib/opfs";
import { Markdown } from "@/shared/ui/Markdown";
import { Section } from "./Section";
import { SectionEmptyState } from "./SectionEmptyState";

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
    void loadMemory();
  }, [loadMemory]);

  // Live-update when the agent writes memory
  useEffect(() => {
    if (!agent.memory) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.agentId === agent.id) {
        void loadMemory();
      }
    };
    window.addEventListener("memory-updated", handler);
    return () => window.removeEventListener("memory-updated", handler);
  }, [agent.memory, agent.id, loadMemory]);

  const toggleMemory = () => {
    updateAgent(agent.id, { memory: !agent.memory });
  };

  const openDialog = (editMode = false) => {
    setIsDialogOpen(true);
    if (editMode || !content?.trim()) {
      setEditValue(content || "");
      setIsEditing(true);
    } else {
      setIsEditing(false);
      setEditValue("");
    }
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
    if (
      !(await confirm({
        title: "Clear agent memory?",
        message: "All stored memory for this agent will be permanently erased and can't be recovered.",
        danger: true,
      }))
    )
      return;
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
                      {content && (
                        <span className="ml-2 text-xs font-normal text-neutral-400">
                          {(new TextEncoder().encode(content).length / 1024).toFixed(1)}KB
                        </span>
                      )}
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
                          className="w-full px-3 py-2 text-sm rounded-md bg-white/50 dark:bg-neutral-800/50 border border-neutral-300/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-neutral-500/60 focus:border-transparent text-neutral-900 dark:text-neutral-100 resize-y min-h-50 backdrop-blur-sm transition-colors"
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
        title="Memory"
        isOpen={true}
        collapsible={false}
        headerAction={
          <div className="flex items-center gap-2">
            {agent.memory && content?.trim() && (
              <button
                type="button"
                onClick={() => openDialog(true)}
                className="flex items-center gap-1 text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
              >
                <Edit size={12} /> Edit
              </button>
            )}
            <button
              type="button"
              onClick={toggleMemory}
              className={cn(
                "shrink-0",
                agent.memory ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400 dark:text-neutral-500",
              )}
              title={agent.memory ? "Memory enabled (click to disable)" : "Memory disabled (click to enable)"}
            >
              {agent.memory ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
            </button>
          </div>
        }
      >
        {agent.memory ? (
          content?.trim() ? (
            <button
              type="button"
              className="relative rounded-xl border border-neutral-200/70 dark:border-neutral-700/50 bg-neutral-50/60 dark:bg-neutral-800/30 overflow-hidden cursor-pointer w-full text-left"
              onClick={() => openDialog(false)}
            >
              <div className="relative px-3.5 pt-3 pb-3">
                <div className="prose prose-xs dark:prose-invert max-w-none text-xs [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 line-clamp-4 text-neutral-600 dark:text-neutral-400">
                  <Markdown compact>{content}</Markdown>
                </div>
                <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-neutral-50/80 dark:from-transparent to-transparent pointer-events-none" />
              </div>
            </button>
          ) : (
            <SectionEmptyState
              icon={<Edit size={12} />}
              label="No memories yet"
              description="The agent will write here as you chat"
              onClick={openDialog}
            />
          )
        ) : (
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            Enable to let this agent remember context across conversations.
          </p>
        )}
      </Section>
    </>
  );
}
