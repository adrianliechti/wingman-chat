import { useState, useMemo, Fragment, useRef, useEffect } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { X, Search, Plus, Minus, Download, Pencil, Trash2, ArrowLeft, Sparkles, Loader2 } from "lucide-react";
import { useSkills } from "@/features/skills/hooks/useSkills";
import { parseSkillFile, downloadSkill, validateSkillName } from "@/features/skills/lib/skillParser";
import type { Skill } from "@/features/skills/lib/skillParser";
import { getConfig } from "@/shared/config";
import JSZip from "jszip";

interface SkillCatalogProps {
  isOpen: boolean;
  onClose: () => void;
  enabledSkillNames: Set<string>;
  onToggle: (skillName: string) => void;
  onSkillSaved: (skill: Skill, isNew: boolean, oldName?: string) => void;
  onImported: (names: string[]) => void;
  initialView?: "list" | "new";
}

export function SkillCatalog({
  isOpen,
  onClose,
  enabledSkillNames,
  onToggle,
  onSkillSaved,
  onImported,
  initialView = "list",
}: SkillCatalogProps) {
  const { skills: allSkills, addSkill, updateSkill, removeSkill } = useSkills();
  const [search, setSearch] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Editor state
  const [editing, setEditing] = useState<Skill | "new" | null>(null);
  const [edName, setEdName] = useState("");
  const [edDescription, setEdDescription] = useState("");
  const [edContent, setEdContent] = useState("");
  const [isOptimizing, setIsOptimizing] = useState(false);

  useEffect(() => {
    return () => {
      if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
    };
  }, []);

  // Reset editor when catalog opens/closes
  useEffect(() => {
    if (isOpen) {
      if (initialView === "new") {
        openEditor("new");
      }
    } else {
      setEditing(null);
      setSearch("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialView]);

  const openEditor = (skill: Skill | "new") => {
    if (skill === "new") {
      setEdName("");
      setEdDescription("");
      setEdContent("");
    } else {
      setEdName(skill.name);
      setEdDescription(skill.description);
      setEdContent(skill.content);
    }
    setEditing(skill);
  };

  const nameError = useMemo(() => {
    if (!edName || edName.endsWith("-")) return null;
    const validation = validateSkillName(edName);
    return validation.valid ? null : validation.error || null;
  }, [edName]);

  const editorIsValid = edName && !nameError && edDescription.trim() && edContent.trim();

  const handleEditorSave = () => {
    const validation = validateSkillName(edName);
    if (!validation.valid || !edDescription.trim() || !edContent.trim()) return;

    const data = { name: edName, description: edDescription.trim(), content: edContent.trim() };

    if (editing && editing !== "new") {
      updateSkill(editing.id, data);
      const oldName = editing.name !== data.name ? editing.name : undefined;
      onSkillSaved({ ...editing, ...data }, false, oldName);
    } else {
      const newSkill = addSkill(data);
      onSkillSaved(newSkill, true);
    }
    setEditing(null);
  };

  const handleOptimize = async () => {
    if (isOptimizing) return;
    setIsOptimizing(true);
    try {
      const config = getConfig();
      const result = await config.client.optimizeSkill(config.chat?.optimizer || "", edName, edDescription, edContent);
      if (editing === "new") {
        setEdName(result.name);
      }
      setEdDescription(result.description);
      setEdContent(result.content);
    } catch (error) {
      console.error("Failed to optimize skill:", error);
    } finally {
      setIsOptimizing(false);
    }
  };

  const canOptimize = (edDescription.trim().length > 0 || edContent.trim().length > 0) && !isOptimizing;

  const filteredSkills = useMemo(() => {
    const sorted = [...allSkills].sort((a, b) => a.name.localeCompare(b.name));
    if (!search.trim()) return sorted;
    const q = search.toLowerCase();
    return sorted.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  }, [allSkills, search]);

  const handleDelete = (skill: Skill) => {
    if (window.confirm(`Delete the skill "${skill.name}"?`)) {
      removeSkill(skill.id);
      if (enabledSkillNames.has(skill.name)) {
        onToggle(skill.name);
      }
    }
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,.md";
    input.multiple = true;
    input.onchange = async (event) => {
      const files = (event.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;
      await importSkillFiles(Array.from(files));
    };
    input.click();
  };

  const importSkillFiles = async (files: File[]) => {
    const newNames: string[] = [];
    for (const file of files) {
      try {
        if (file.name.endsWith(".zip")) {
          const zip = await JSZip.loadAsync(file);
          for (const [filename, zipEntry] of Object.entries(zip.files)) {
            if (zipEntry.dir || !filename.endsWith(".md")) continue;
            try {
              const content = await zipEntry.async("string");
              const result = parseSkillFile(content);
              if (result.success) {
                const s = addSkill(result.skill);
                newNames.push(s.name);
              }
            } catch {
              /* skip */
            }
          }
        } else {
          const content = await file.text();
          const result = parseSkillFile(content);
          if (result.success) {
            const s = addSkill(result.skill);
            newNames.push(s.name);
          }
        }
      } catch {
        /* skip */
      }
    }
    if (newNames.length > 0) {
      onImported(newNames);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (dragTimeoutRef.current) {
      clearTimeout(dragTimeoutRef.current);
      dragTimeoutRef.current = null;
    }
    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      (f) => f.name.endsWith(".md") || f.name.endsWith(".zip"),
    );
    if (droppedFiles.length > 0) {
      await importSkillFiles(droppedFiles);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragOver) setIsDragOver(true);
    if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
    dragTimeoutRef.current = setTimeout(() => {
      setIsDragOver(false);
      dragTimeoutRef.current = null;
    }, 100);
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-80" onClose={onClose}>
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
                className="relative w-full max-w-lg rounded-xl bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl shadow-xl border border-neutral-200/50 dark:border-neutral-700/50"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
              >
                {/* Drag overlay */}
                {isDragOver && (
                  <div className="absolute inset-0 z-10 bg-slate-100/80 dark:bg-slate-800/80 backdrop-blur-sm border-2 border-dashed border-slate-400 dark:border-slate-500 rounded-xl flex items-center justify-center">
                    <div className="text-center">
                      <Plus size={24} className="mx-auto text-neutral-600 dark:text-neutral-400 mb-1" />
                      <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                        Drop skills to import
                      </p>
                    </div>
                  </div>
                )}

                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-200/60 dark:border-neutral-800/60">
                  <div className="flex items-center gap-2">
                    {editing && initialView !== "new" && (
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="p-1 -ml-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                      >
                        <ArrowLeft size={16} />
                      </button>
                    )}
                    <Dialog.Title className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      {editing ? (editing === "new" ? "New Skill" : "Edit Skill") : "Skill Catalog"}
                    </Dialog.Title>
                  </div>
                  {(!editing || initialView === "new") && (
                    <button
                      type="button"
                      onClick={onClose}
                      className="p-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>

                {editing ? (
                  /* Editor view */
                  <>
                    <div className="px-5 py-3.5 space-y-3.5">
                      <div>
                        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                          Name{" "}
                        </label>
                        <input
                          type="text"
                          value={edName}
                          onChange={(e) => setEdName(e.target.value.toLowerCase())}
                          className={`w-full px-3 py-2 text-sm rounded-md bg-white/50 dark:bg-neutral-800/50 backdrop-blur-sm border ${
                            nameError
                              ? "border-red-400/70 focus:ring-red-500/60"
                              : "border-neutral-300/60 dark:border-neutral-700/60 focus:ring-neutral-500/60"
                          } focus:ring-2 focus:border-transparent text-neutral-900 dark:text-neutral-100 transition-colors`}
                          placeholder="my-skill-name"
                          autoFocus={editing === "new"}
                        />
                        {nameError && <p className="mt-1 text-xs text-red-500">{nameError}</p>}
                        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                          Lowercase alphanumeric characters and hyphens only.
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                          Description{" "}
                        </label>
                        <textarea
                          value={edDescription}
                          onChange={(e) => setEdDescription(e.target.value)}
                          className="w-full px-3 py-2 text-sm rounded-md bg-white/50 dark:bg-neutral-800/50 backdrop-blur-sm border border-neutral-300/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-neutral-500/60 focus:border-transparent text-neutral-900 dark:text-neutral-100 resize-none transition-colors"
                          rows={2}
                          placeholder="Describe what this skill does and when to use it..."
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
                          Instructions
                        </label>
                        <textarea
                          value={edContent}
                          onChange={(e) => setEdContent(e.target.value)}
                          className="w-full px-3 py-2 text-sm rounded-md bg-white/50 dark:bg-neutral-800/50 backdrop-blur-sm border border-neutral-300/60 dark:border-neutral-700/60 focus:ring-2 focus:ring-neutral-500/60 focus:border-transparent text-neutral-900 dark:text-neutral-100 font-mono resize-none transition-colors"
                          rows={10}
                          placeholder={"# Skill Instructions\n\nDetailed instructions for the agent..."}
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between px-5 py-3 border-t border-neutral-200/60 dark:border-neutral-800/60 bg-neutral-50/50 dark:bg-neutral-900/30 rounded-b-xl">
                      <button
                        type="button"
                        onClick={handleOptimize}
                        disabled={!canOptimize}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md border border-neutral-300/60 dark:border-neutral-700/60 text-neutral-500 dark:text-neutral-400 hover:text-amber-600 dark:hover:text-amber-400 hover:border-amber-300/60 dark:hover:border-amber-700/60 hover:bg-amber-50/40 dark:hover:bg-amber-950/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {isOptimizing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                        {isOptimizing ? "Optimizing\u2026" : "Optimize"}
                      </button>
                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => (initialView === "new" ? onClose() : setEditing(null))}
                          className="px-3 py-1.5 text-xs font-medium rounded-md text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleEditorSave}
                          disabled={!editorIsValid}
                          className="px-3 py-1.5 text-xs font-medium rounded-md bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  /* List view */
                  <>
                    {/* Search + actions bar */}
                    <div className="flex items-center gap-2 pl-6 pr-5 py-2.5 border-b border-neutral-200/40 dark:border-neutral-800/40">
                      <Search size={13} className="shrink-0 text-neutral-400" />
                      <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search skills…"
                        className="flex-1 bg-transparent text-xs text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 outline-none"
                        autoFocus
                      />
                      {search && (
                        <button
                          type="button"
                          onClick={() => setSearch("")}
                          className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                        >
                          <X size={12} />
                        </button>
                      )}
                      <div className="w-px h-3.5 bg-neutral-200 dark:bg-neutral-700 mx-1 shrink-0" />
                      <button
                        type="button"
                        onClick={() => openEditor("new")}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md border border-neutral-300/50 dark:border-neutral-600/50 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 transition-colors shrink-0"
                        title="Create new skill"
                      >
                        <Plus size={11} />
                        New
                      </button>
                      <button
                        type="button"
                        onClick={handleImport}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md border border-neutral-300/50 dark:border-neutral-600/50 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 transition-colors shrink-0"
                        title="Import skill files"
                      >
                        <Download size={11} />
                        Import
                      </button>
                    </div>

                    {/* Skill list */}
                    <div className="h-80 overflow-y-auto py-1">
                      {filteredSkills.length > 0 ? (
                        filteredSkills.map((skill) => {
                          const enabled = enabledSkillNames.has(skill.name);
                          return (
                            <div
                              key={skill.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => onToggle(skill.name)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  onToggle(skill.name);
                                }
                              }}
                              className="flex items-center gap-2.5 px-5 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800/40 transition-colors group cursor-pointer select-none"
                            >
                              <span
                                className={`shrink-0 rounded p-0.5 flex items-center justify-center transition-colors ${enabled ? "text-neutral-800 dark:text-neutral-200" : "text-neutral-400 dark:text-neutral-500"}`}
                              >
                                {enabled ? <Minus size={14} strokeWidth={3} /> : <Plus size={14} strokeWidth={3} />}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate">
                                  {skill.name}
                                </div>
                                <div className="text-[10px] text-neutral-500 dark:text-neutral-400 line-clamp-1">
                                  {skill.description}
                                </div>
                              </div>
                              <div className="w-0 overflow-hidden group-hover:w-16 flex items-center gap-0.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openEditor(skill);
                                  }}
                                  className="p-1 rounded text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
                                  title="Edit skill"
                                >
                                  <Pencil size={12} />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    downloadSkill(skill);
                                  }}
                                  className="p-1 rounded text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
                                  title="Export skill"
                                >
                                  <Download size={12} />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(skill);
                                  }}
                                  className="p-1 rounded text-neutral-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                                  title="Delete skill"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <p className="text-xs text-neutral-400 text-center py-6">
                          {allSkills.length === 0
                            ? "No skills yet. Create or import one to get started."
                            : "No skills match your search."}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
