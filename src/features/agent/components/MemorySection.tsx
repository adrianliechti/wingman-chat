import { Dialog, Transition } from "@headlessui/react";
import { ChevronLeft, ExternalLink, Pencil, Plus, ToggleLeft, ToggleRight, Trash2, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { slugifyMemoryPath } from "@/features/agent/lib/memoryParser";
import type { Agent } from "@/features/agent/types/agent";
import { cn } from "@/shared/lib/cn";
import { confirm } from "@/shared/lib/confirm";
import * as opfs from "@/shared/lib/opfs";
import { Markdown } from "@/shared/ui/Markdown";
import { Section } from "./Section";
import { SectionEmptyState } from "./SectionEmptyState";

const ENTRIES_VISIBLE_DEFAULT = 4;

interface MemorySectionProps {
  agent: Agent;
}

type DialogView = "detail" | "edit";

function notifyMemoryUpdated(agentId: string) {
  window.dispatchEvent(new CustomEvent("memory-updated", { detail: { agentId } }));
}

export function MemorySection({ agent }: MemorySectionProps) {
  const { updateAgent } = useAgents();
  const [entries, setEntries] = useState<opfs.MemoryEntry[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [view, setView] = useState<DialogView>("detail");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<opfs.MemoryDoc | null>(null);

  const [editType, setEditType] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editBody, setEditBody] = useState("");

  const loadEntries = useCallback(async () => {
    if (!agent.memory) {
      setEntries([]);
      return;
    }
    await opfs.ensureMemoryMigrated(agent.id);
    setEntries(await opfs.listMemoryEntries(agent.id));
  }, [agent.memory, agent.id]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  // Live-update when the agent writes/deletes memory mid-conversation
  useEffect(() => {
    if (!agent.memory) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.agentId === agent.id) void loadEntries();
    };
    window.addEventListener("memory-updated", handler);
    return () => window.removeEventListener("memory-updated", handler);
  }, [agent.memory, agent.id, loadEntries]);

  const toggleMemory = () => updateAgent(agent.id, { memory: !agent.memory });

  const openEntry = async (path: string) => {
    const doc = await opfs.readMemoryDoc(agent.id, path);
    if (!doc) return;
    setSelectedPath(path);
    setSelectedDoc(doc);
    setView("detail");
    setIsDialogOpen(true);
  };

  const openCreate = () => {
    setSelectedPath(null);
    setSelectedDoc(null);
    setEditType("");
    setEditTitle("");
    setEditDescription("");
    setEditTags("");
    setEditBody("");
    setView("edit");
    setIsDialogOpen(true);
  };

  const startEdit = () => {
    if (!selectedDoc) return;
    setEditType(selectedDoc.frontmatter.type);
    setEditTitle(selectedDoc.frontmatter.title);
    setEditDescription(selectedDoc.frontmatter.description || "");
    setEditTags((selectedDoc.frontmatter.tags || []).join(", "));
    setEditBody(selectedDoc.body);
    setView("edit");
  };

  const cancelEdit = () => {
    if (selectedPath) setView("detail");
    else closeDialog();
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setSelectedPath(null);
    setSelectedDoc(null);
  };

  const save = async () => {
    const title = editTitle.trim();
    if (!title) return;
    const type = editType.trim() || "Reference";
    const tags = editTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const description = editDescription.trim() || undefined;
    const body = editBody.trim();

    let path = selectedPath;
    if (!path) {
      const existing = new Set(entries.map((e) => e.path));
      const slug = slugifyMemoryPath(title);
      path = `${slug}.md`;
      let n = 2;
      while (existing.has(path)) path = `${slug}-${n++}.md`;
    }

    await opfs.writeMemoryDoc(agent.id, path, { type, title, description, tags: tags.length ? tags : undefined }, body);
    notifyMemoryUpdated(agent.id);
    await openEntry(path);
  };

  const handleDelete = async (path: string, fromDialog: boolean) => {
    const entry = entries.find((e) => e.path === path);
    if (
      !(await confirm({
        title: "Delete memory entry?",
        message: `"${entry?.title || path}" will be permanently removed and can't be recovered.`,
        danger: true,
      }))
    )
      return;

    await opfs.deleteMemoryDoc(agent.id, path);
    notifyMemoryUpdated(agent.id);
    if (fromDialog && selectedPath === path) closeDialog();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (view === "edit" && selectedPath) setView("detail");
      else closeDialog();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && view === "edit") {
      e.preventDefault();
      void save();
    }
  };

  const inputClass =
    "mt-1 w-full px-3 py-1.5 text-sm rounded-md bg-white/50 dark:bg-neutral-800/50 border border-neutral-300/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-neutral-500/60 focus:border-transparent text-neutral-900 dark:text-neutral-100 backdrop-blur-sm transition-colors";
  const labelClass = "text-xs font-medium text-neutral-500 dark:text-neutral-400";

  const visibleEntries = showAll ? entries : entries.slice(0, ENTRIES_VISIBLE_DEFAULT);

  return (
    <>
      {/* Entry Dialog — view or edit a single entry */}
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
                <Dialog.Panel
                  className="w-full max-w-2xl transform overflow-hidden rounded-xl bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl shadow-xl transition-all"
                  onKeyDown={handleKeyDown}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-200/60 dark:border-neutral-800/60">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {view === "edit" && selectedPath && (
                        <button
                          type="button"
                          onClick={() => setView("detail")}
                          className="p-1 -ml-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors shrink-0"
                        >
                          <ChevronLeft size={16} />
                        </button>
                      )}
                      <Dialog.Title className="text-base font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                        {view === "detail"
                          ? selectedDoc?.frontmatter.title || "Entry"
                          : selectedPath
                            ? "Edit Entry"
                            : "New Entry"}
                      </Dialog.Title>
                    </div>
                    <button
                      type="button"
                      onClick={closeDialog}
                      className="p-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors shrink-0"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {/* Content */}
                  <div className="px-5 py-3.5 max-h-96 overflow-auto">
                    {view === "detail" && selectedDoc && (
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5 mb-3">
                          <span className="text-[10px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                            {selectedDoc.frontmatter.type}
                          </span>
                          {selectedDoc.frontmatter.tags?.map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                        {selectedDoc.frontmatter.resource && (
                          <a
                            href={selectedDoc.frontmatter.resource}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 mb-3 text-xs text-blue-600 dark:text-blue-400 hover:underline break-all"
                          >
                            <ExternalLink size={12} className="shrink-0" />
                            {selectedDoc.frontmatter.resource}
                          </a>
                        )}
                        <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                          <Markdown>{selectedDoc.body}</Markdown>
                        </div>
                      </div>
                    )}

                    {view === "edit" && (
                      <div className="space-y-3">
                        <div>
                          <label className={labelClass}>Title</label>
                          <input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className={inputClass}
                            placeholder="Short title"
                            autoFocus
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className={labelClass}>Type</label>
                            <input
                              value={editType}
                              onChange={(e) => setEditType(e.target.value)}
                              className={inputClass}
                              placeholder="Project Context"
                            />
                          </div>
                          <div>
                            <label className={labelClass}>Tags</label>
                            <input
                              value={editTags}
                              onChange={(e) => setEditTags(e.target.value)}
                              className={inputClass}
                              placeholder="comma, separated"
                            />
                          </div>
                        </div>
                        <div>
                          <label className={labelClass}>Description</label>
                          <input
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            className={inputClass}
                            placeholder="One-line summary"
                          />
                        </div>
                        <div>
                          <label className={labelClass}>Body</label>
                          <textarea
                            value={editBody}
                            onChange={(e) => setEditBody(e.target.value)}
                            rows={10}
                            className={cn(inputClass, "resize-y min-h-40")}
                            placeholder="Markdown content"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between px-5 py-3 border-t border-neutral-200/60 dark:border-neutral-800/60 bg-neutral-50/50 dark:bg-neutral-900/30">
                    {view === "detail" && selectedPath && (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleDelete(selectedPath, true)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-red-300/60 dark:border-red-800/60 text-red-600 dark:text-red-400 hover:bg-red-50/50 dark:hover:bg-red-950/30 transition-colors"
                        >
                          <Trash2 size={13} /> Delete
                        </button>
                        <button
                          type="button"
                          onClick={startEdit}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 hover:opacity-90 transition-colors"
                        >
                          <Pencil size={13} /> Edit
                        </button>
                      </>
                    )}
                    {view === "edit" && (
                      <>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="px-3 py-1.5 text-xs font-medium rounded-md text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void save()}
                          disabled={!editTitle.trim()}
                          className="px-3 py-1.5 text-xs font-medium rounded-md bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          Save
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
        count={entries.length}
        isOpen={true}
        collapsible={false}
        headerAction={
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
        }
      >
        {agent.memory ? (
          entries.length > 0 ? (
            <div className="space-y-0.5">
              {visibleEntries.map((e) => (
                <div
                  key={e.path}
                  className="group flex items-center gap-2 rounded-lg px-1 hover:bg-neutral-100/60 dark:hover:bg-neutral-800/40 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => void openEntry(e.path)}
                    className="flex-1 min-w-0 text-left py-1.5"
                    title={e.description || e.type}
                  >
                    <span className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 truncate">
                      {e.title || e.description}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(e.path, false)}
                    className="shrink-0 p-1 rounded text-neutral-400 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Delete entry"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              {entries.length > ENTRIES_VISIBLE_DEFAULT && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="w-full text-left px-1 py-1 text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
                >
                  {showAll ? "Show less" : `+${entries.length - ENTRIES_VISIBLE_DEFAULT} more`}
                </button>
              )}
            </div>
          ) : (
            <SectionEmptyState
              icon={<Plus size={12} />}
              label="No memories yet"
              description="The agent will write here as you chat, or add one yourself"
              onClick={openCreate}
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
