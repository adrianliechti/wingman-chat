import {
  ArrowLeft,
  Code,
  Download,
  Eye,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useSkills } from "@/features/skills/hooks/useSkills";
import type { Skill, SkillResource } from "@/features/skills/lib/skillParser";
import {
  downloadSkill,
  downloadSkillsAsZip,
  parseSkillFile,
  parseSkillsFromZip,
  validateSkillName,
} from "@/features/skills/lib/skillParser";
import { getConfig } from "@/shared/config";
import { cn } from "@/shared/lib/cn";
import { confirm } from "@/shared/lib/confirm";
import { notify } from "@/shared/lib/notify";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";
import { Markdown } from "@/shared/ui/Markdown";
import { SkillResourcesEditor } from "./SkillResourcesEditor";

export interface SkillCatalogActions {
  onNew: () => void;
  onImport: () => void;
  onExportAll: () => void;
  canExport: boolean;
}

export interface SkillCatalogPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Per-skill activation handler. When provided, the catalog shows add/remove
   * toggles to enable each skill on the active agent. Omit it (along with
   * `enabledSkillNames`) for a view/edit-only catalog with no agent context —
   * creating, editing, deleting, and importing skills still work either way.
   */
  onToggle?: (skillName: string) => void;
  /** Skills currently enabled on the agent. Only meaningful alongside `onToggle`. */
  enabledSkillNames?: ReadonlySet<string>;
  onSkillSaved: (skill: Skill, isNew: boolean, oldName?: string) => void;
  onImported: (names: string[]) => void;
  initialView?: "list" | "new";
  /** When set, pre-selects this skill in preview (read-only) mode on open. */
  initialSkillName?: string;
  /** Search query managed by the parent (dialog top bar). */
  search?: string;
  /** Notifies the parent of the current view kind so it can hide the search bar when drilled in. */
  onViewKindChange?: (kind: "list" | "skill-detail" | "skill-edit") => void;
  /** Publishes the list-view actions so the parent can render them in its top bar. */
  onActionsChange?: (actions: SkillCatalogActions | null) => void;
}

const NO_ENABLED_SKILLS: ReadonlySet<string> = new Set();

/** Order-independent fingerprint of a resource set, for change detection. */
function resourcesKey(resources: SkillResource[] = []): string {
  return resources
    .map((r) => `${r.path}:${r.content.length}`)
    .sort()
    .join("|");
}

// Soft filled-field style shared by the editor inputs — matches the agent
// config's card aesthetic (faint border, subtle fill, gentle focus ring).
const FIELD_BASE =
  "w-full rounded-lg border bg-neutral-50/50 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 transition-colors focus:bg-white focus:outline-none focus:ring-2 dark:bg-neutral-800/30 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:bg-neutral-800/60";
const FIELD_NEUTRAL =
  "border-neutral-200/70 focus:border-neutral-300 focus:ring-neutral-500/15 dark:border-neutral-700/50 dark:focus:border-neutral-600";
const FIELD_ERROR = "border-red-400/60 focus:border-red-400 focus:ring-red-500/15";

export function SkillCatalogPanel({
  isOpen,
  onClose: _onClose,
  onToggle,
  enabledSkillNames = NO_ENABLED_SKILLS,
  onSkillSaved,
  onImported,
  initialView = "list",
  initialSkillName,
  search = "",
  onViewKindChange,
  onActionsChange,
}: SkillCatalogPanelProps) {
  const { skills: allSkills, addSkill, updateSkill, removeSkill } = useSkills();
  const editorNameInputId = useId();
  const editorDescriptionInputId = useId();
  const editorContentInputId = useId();
  const editorNameInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [stableOrder, setStableOrder] = useState<string[]>([]);

  // Two-panel state
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [previewTab, setPreviewTab] = useState<"edit" | "preview">("edit");
  const previewSliderRef = useRef<HTMLDivElement>(null);
  const [previewSliderStyle, setPreviewSliderStyle] = useState({ left: 0, width: 0 });

  // Editor fields
  const [edName, setEdName] = useState("");
  const [edDescription, setEdDescription] = useState("");
  const [edContent, setEdContent] = useState("");
  const [edResources, setEdResources] = useState<SkillResource[]>([]);
  const [isOptimizing, setIsOptimizing] = useState(false);

  useEffect(() => {
    return () => {
      if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
    };
  }, []);

  // editMode is a deliberate extra dep: it triggers remeasurement when the switcher mounts.
  useEffect(() => {
    const measure = () => {
      const container = previewSliderRef.current;
      if (!container) return;
      const active = container.querySelector<HTMLElement>(`[data-view="${previewTab}"]`);
      if (!active) return;
      const cr = container.getBoundingClientRect();
      const br = active.getBoundingClientRect();
      setPreviewSliderStyle({ left: br.left - cr.left, width: br.width });
    };
    measure();
    const id = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(id);
  }, [previewTab, editMode]);

  const openEditor = useCallback((skill: Skill | "new") => {
    if (skill === "new") {
      setSelectedSkill(null);
      setEdName("");
      setEdDescription("");
      setEdContent("");
      setEdResources([]);
    } else {
      setSelectedSkill(skill);
      setEdName(skill.name);
      setEdDescription(skill.description);
      setEdContent(skill.content);
      setEdResources(skill.resources ?? []);
    }
    setPreviewTab("edit");
    setEditMode(true);
  }, []);

  // Capture order only on open so toggling doesn't re-sort.
  useEffect(() => {
    if (!isOpen) return;
    setStableOrder(
      [...allSkills]
        .sort((a, b) => {
          const aEnabled = enabledSkillNames.has(a.name) ? 0 : 1;
          const bEnabled = enabledSkillNames.has(b.name) ? 0 : 1;
          if (aEnabled !== bEnabled) return aEnabled - bEnabled;
          return a.name.localeCompare(b.name);
        })
        .map((s) => s.id),
    );
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      if (initialView === "new") {
        openEditor("new");
      } else if (initialSkillName) {
        const target = allSkills.find((s) => s.name === initialSkillName);
        setSelectedSkill(target ?? null);
        setEditMode(false);
      } else {
        setSelectedSkill(null);
        setEditMode(false);
      }
    } else {
      setSelectedSkill(null);
      setEditMode(false);
    }
    // setters are stable and intentionally omitted from the deps
  }, [isOpen, initialView, initialSkillName, openEditor, allSkills]);

  useEffect(() => {
    if (!isOpen) return;
    if (editMode) {
      editorNameInputRef.current?.focus();
    }
  }, [editMode, isOpen]);

  const nameError = useMemo(() => {
    if (!edName || edName.endsWith("-")) return null;
    const validation = validateSkillName(edName);
    return validation.valid ? null : validation.error || null;
  }, [edName]);

  const editorIsValid = edName && !nameError && edDescription.trim() && edContent.trim();

  const hasUnsavedChanges = useMemo(() => {
    if (!editMode) return false;
    const resourcesChanged = resourcesKey(edResources) !== resourcesKey(selectedSkill?.resources);
    if (!selectedSkill)
      return (
        edName.trim() !== "" ||
        edDescription.trim() !== "" ||
        edContent.trim() !== "" ||
        resourcesChanged
      );
    return (
      edName !== selectedSkill.name ||
      edDescription.trim() !== selectedSkill.description.trim() ||
      edContent.trim() !== selectedSkill.content.trim() ||
      resourcesChanged
    );
  }, [editMode, selectedSkill, edName, edDescription, edContent, edResources]);

  const discardAndRun = useCallback(
    async (action: () => void) => {
      if (
        hasUnsavedChanges &&
        !(await confirm({
          title: "Discard changes?",
          message: "Your unsaved edits to this skill will be lost.",
          danger: true,
        }))
      )
        return;
      action();
    },
    [hasUnsavedChanges],
  );

  const openPreview = useCallback(
    (skill: Skill) => {
      void discardAndRun(() => {
        setSelectedSkill(skill);
        setEditMode(false);
      });
    },
    [discardAndRun],
  );

  const handleEditorSave = () => {
    const validation = validateSkillName(edName);
    if (!validation.valid || !edDescription.trim() || !edContent.trim()) return;

    const data = {
      name: edName,
      description: edDescription.trim(),
      content: edContent.trim(),
      resources: edResources,
    };

    if (selectedSkill) {
      updateSkill(selectedSkill.id, data);
      const oldName = selectedSkill.name !== data.name ? selectedSkill.name : undefined;
      const updated = { ...selectedSkill, ...data };
      onSkillSaved(updated, false, oldName);
      setSelectedSkill(updated);
    } else {
      const newSkill = addSkill(data);
      onSkillSaved(newSkill, true);
      setSelectedSkill(newSkill);
    }
    setEditMode(false);
  };

  const handleOptimize = async () => {
    if (isOptimizing) return;
    setIsOptimizing(true);
    try {
      const config = getConfig();
      const result = await config.client.optimizeSkill(
        config.chat?.optimizer || "",
        edName,
        edDescription,
        edContent,
      );
      if (!selectedSkill) {
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

  const canOptimize =
    (edDescription.trim().length > 0 || edContent.trim().length > 0) && !isOptimizing;

  const filteredSkills = useMemo(() => {
    const sorted = [...allSkills].sort((a, b) => {
      const ai = stableOrder.indexOf(a.id);
      const bi = stableOrder.indexOf(b.id);
      // Known skills keep stable order; newly added skills go to the end
      const aPos = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
      const bPos = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
      if (aPos !== bPos) return aPos - bPos;
      return a.name.localeCompare(b.name);
    });
    if (!search.trim()) return sorted;
    const q = search.toLowerCase();
    return sorted.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [allSkills, search, stableOrder]);

  const handleDeleteConfirm = (skill: Skill) => {
    removeSkill(skill.id);
    if (enabledSkillNames.has(skill.name)) {
      onToggle?.(skill.name);
    }
    setSelectedSkill(null);
    setEditMode(false);
  };

  const importSkillFiles = useCallback(
    async (files: File[]) => {
      const newNames: string[] = [];
      for (const file of files) {
        try {
          if (file.name.endsWith(".zip")) {
            const JSZip = (await import("jszip")).default;
            const zip = await JSZip.loadAsync(file);
            for (const parsed of await parseSkillsFromZip(zip)) {
              const s = addSkill(parsed);
              newNames.push(s.name);
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
    },
    [addSkill, onImported],
  );

  const handleImport = useCallback(() => {
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
  }, [importSkillFiles]);

  const handleExportAll = useCallback(() => {
    void downloadSkillsAsZip(allSkills).catch((error) =>
      notify.error("Failed to export skills", error),
    );
  }, [allSkills]);

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

  const viewKind: "list" | "skill-detail" | "skill-edit" = editMode
    ? "skill-edit"
    : selectedSkill
      ? "skill-detail"
      : "list";

  useEffect(() => {
    onViewKindChange?.(viewKind);
  }, [viewKind, onViewKindChange]);

  useEffect(() => {
    if (!onActionsChange) return;
    if (viewKind !== "list") {
      onActionsChange(null);
      return;
    }
    onActionsChange({
      onNew: () => openEditor("new"),
      onImport: handleImport,
      onExportAll: handleExportAll,
      canExport: allSkills.length > 0,
    });
  }, [
    viewKind,
    onActionsChange,
    openEditor,
    handleImport,
    handleExportAll,
    allSkills.length,
  ]);

  useEffect(() => {
    return () => onActionsChange?.(null);
  }, [onActionsChange]);

  if (viewKind === "skill-edit") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* ── Editor header ── */}
        <div className="flex items-center gap-2 border-b border-neutral-200/60 px-4 py-3 dark:border-neutral-800/60">
          <button
            type="button"
            onClick={() => void discardAndRun(() => setEditMode(false))}
            className="-ml-1 rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          >
            <ArrowLeft size={16} />
          </button>
          <span className="flex-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {selectedSkill ? selectedSkill.name : "New Skill"}
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row overflow-y-auto sm:overflow-y-visible">
          <div className="flex-1 min-w-0 space-y-5 sm:overflow-y-auto px-5 py-5">
            {/* Name */}
            <div>
              <label
                htmlFor={editorNameInputId}
                className="mb-1.5 block text-xs font-medium text-neutral-700 dark:text-neutral-300"
              >
                Name
              </label>
              <input
                ref={editorNameInputRef}
                id={editorNameInputId}
                type="text"
                value={edName}
                onChange={(e) => setEdName(e.target.value.toLowerCase())}
                className={cn(FIELD_BASE, nameError ? FIELD_ERROR : FIELD_NEUTRAL)}
                placeholder="my-skill-name"
              />
              {nameError ? (
                <p className="mt-1 text-xs text-red-500">{nameError}</p>
              ) : (
                <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                  Lowercase alphanumeric characters and hyphens only.
                </p>
              )}
            </div>

            {/* Description */}
            <div>
              <label
                htmlFor={editorDescriptionInputId}
                className="mb-1.5 block text-xs font-medium text-neutral-700 dark:text-neutral-300"
              >
                Description
              </label>
              <textarea
                id={editorDescriptionInputId}
                value={edDescription}
                onChange={(e) => setEdDescription(e.target.value)}
                className={cn(FIELD_BASE, FIELD_NEUTRAL, "resize-none")}
                rows={2}
                placeholder="Describe what this skill does and when to use it…"
              />
            </div>

            {/* Instructions with Edit/Preview tabs */}
            <div className="flex flex-col">
              <div className="mb-1.5 flex items-center justify-between">
                <label
                  htmlFor={editorContentInputId}
                  className="text-xs font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Instructions
                </label>
                <div
                  ref={previewSliderRef}
                  className="relative flex items-center gap-0.5 bg-neutral-200/50 dark:bg-neutral-800/50 backdrop-blur-sm rounded-full p-0.5 ring-1 ring-black/5 dark:ring-white/5 shrink-0"
                >
                  {previewSliderStyle.width > 0 && (
                    <div
                      className="absolute bg-white dark:bg-neutral-950 rounded-full shadow-sm ring-1 ring-black/5 dark:ring-white/10 transition-[left,width] duration-300 ease-out"
                      style={{
                        left: `${previewSliderStyle.left}px`,
                        width: `${previewSliderStyle.width}px`,
                        height: "calc(100% - 4px)",
                        top: "2px",
                      }}
                    />
                  )}
                  <button
                    type="button"
                    data-view="edit"
                    onClick={() => setPreviewTab("edit")}
                    title="Edit"
                    className={cn(
                      "relative z-10 flex items-center justify-center w-5 h-5 rounded-full transition-colors duration-200 text-xs",
                      previewTab === "edit"
                        ? "text-neutral-900 dark:text-neutral-50"
                        : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200",
                    )}
                  >
                    <Code size={11} strokeWidth={2.25} />
                  </button>
                  <button
                    type="button"
                    data-view="preview"
                    onClick={() => setPreviewTab("preview")}
                    title="Preview"
                    className={cn(
                      "relative z-10 flex items-center justify-center w-5 h-5 rounded-full transition-colors duration-200 text-xs",
                      previewTab === "preview"
                        ? "text-neutral-900 dark:text-neutral-50"
                        : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200",
                    )}
                  >
                    <Eye size={11} strokeWidth={2.25} />
                  </button>
                </div>
              </div>

              {previewTab === "edit" ? (
                <textarea
                  id={editorContentInputId}
                  value={edContent}
                  onChange={(e) => setEdContent(e.target.value)}
                  className={cn(FIELD_BASE, FIELD_NEUTRAL, "resize-none font-mono")}
                  rows={9}
                  placeholder={"# Skill Instructions\n\nDetailed instructions for the agent…"}
                />
              ) : (
                <div className="h-49.5 overflow-y-auto rounded-lg border border-neutral-200/70 bg-neutral-50/50 px-3 py-2 text-sm dark:border-neutral-700/50 dark:bg-neutral-800/30">
                  {edContent.trim() ? (
                    <Markdown>{edContent}</Markdown>
                  ) : (
                    <p className="text-xs italic text-neutral-400 dark:text-neutral-500">
                      Nothing to preview yet.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Resources sidebar */}
          <div className="flex w-full sm:w-72 shrink-0 flex-col overflow-y-auto border-t sm:border-t-0 sm:border-l border-neutral-200/60 px-4 py-4 dark:border-neutral-800/60">
            <SkillResourcesEditor resources={edResources} onChange={setEdResources} />
          </div>
        </div>

        {/* Editor footer */}
        <div className="flex items-center justify-between border-t border-neutral-200/60 bg-neutral-50/50 px-5 py-3 dark:border-neutral-800/60 dark:bg-neutral-900/30">
          <button
            type="button"
            onClick={handleOptimize}
            disabled={!canOptimize}
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300/60 px-2.5 py-1.5 text-xs font-medium text-neutral-500 transition-colors hover:border-amber-300/60 hover:bg-amber-50/40 hover:text-amber-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700/60 dark:text-neutral-400 dark:hover:border-amber-700/60 dark:hover:bg-amber-950/20 dark:hover:text-amber-400"
          >
            {isOptimizing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {isOptimizing ? "Optimizing…" : "Optimize"}
          </button>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => void discardAndRun(() => setEditMode(false))}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-800/60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleEditorSave}
              disabled={!editorIsValid}
              className="rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-200 dark:text-neutral-900"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (viewKind === "skill-detail" && selectedSkill) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-neutral-200/60 px-4 py-3 dark:border-neutral-800/60">
          <button
            type="button"
            onClick={() => {
              setSelectedSkill(null);
              setEditMode(false);
            }}
            className="-ml-1 rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {selectedSkill.name}
            </span>
          </div>
          <button
            type="button"
            onClick={() => openEditor(selectedSkill)}
            title="Edit skill"
            className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          >
            <Pencil size={15} />
          </button>
          <DropdownMenu
            anchor="bottom end"
            trigger={
              <MenuButton className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300">
                <MoreVertical size={15} />
              </MenuButton>
            }
          >
            <DropdownMenuItem
              icon={<Download size={13} />}
              onClick={() => {
                void downloadSkill(selectedSkill).catch((error) =>
                  notify.error("Failed to export skill", error),
                );
              }}
            >
              Export
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<Trash2 size={13} />}
              destructive
              onClick={async () => {
                if (
                  await confirm({
                    title: "Delete skill?",
                    message: `"${selectedSkill.name}" will be permanently removed. This can't be undone.`,
                    danger: true,
                  })
                ) {
                  handleDeleteConfirm(selectedSkill);
                }
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenu>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {selectedSkill.description && (
            <div className="mb-4">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                Description
              </p>
              <p className="text-sm text-neutral-700 dark:text-neutral-300">
                {selectedSkill.description}
              </p>
            </div>
          )}
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              Instructions
            </p>
            <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-sm">
              <Markdown>{selectedSkill.content}</Markdown>
            </div>
          </div>
          {selectedSkill.resources && selectedSkill.resources.length > 0 && (
            <div className="mt-4">
              <SkillResourcesEditor resources={selectedSkill.resources} />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── List view ──────────────────────────────────────────────────────────────
  const isEmpty = allSkills.length === 0;
  const noSkillsMatch = allSkills.length > 0 && filteredSkills.length === 0;

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {isDragOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-slate-400 bg-slate-100/80 backdrop-blur-sm dark:border-slate-500 dark:bg-slate-800/80">
          <div className="text-center">
            <Plus size={24} className="mx-auto mb-1 text-neutral-600 dark:text-neutral-400" />
            <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
              Drop skills to import
            </p>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto py-1">
          {isEmpty && !search ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
              <Sparkles size={28} className="text-neutral-300 dark:text-neutral-600" />
              <div>
                <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                  No skills yet
                </p>
                <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">
                  Skills extend what your agents can do
                </p>
              </div>
              <button
                type="button"
                onClick={() => openEditor("new")}
                className="inline-flex items-center gap-1.5 rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90 dark:bg-neutral-200 dark:text-neutral-900"
              >
                <Plus size={11} />
                Create your first skill
              </button>
            </div>
          ) : (
            <ul>
              {noSkillsMatch && (
                <li className="px-5 py-2 text-xs text-neutral-400 dark:text-neutral-500">
                  No skills match your search.
                </li>
              )}
              {filteredSkills.map((skill) => {
                const enabled = enabledSkillNames.has(skill.name);
                const isSelected = selectedSkill?.id === skill.id;
                return (
                  <li
                    key={skill.id}
                    className={`group border-t border-neutral-200/40 first:border-t-0 dark:border-neutral-800/40 ${
                      isSelected ? "bg-neutral-100 dark:bg-neutral-800/70" : ""
                    }`}
                  >
                    <div className="flex w-full items-center gap-3 pl-5 pr-2 py-3">
                      <button
                        type="button"
                        onClick={() => openPreview(skill)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left transition-colors hover:opacity-80"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                          <Sparkles size={16} className="text-neutral-400 dark:text-neutral-500" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-1.5">
                            <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                              {skill.name}
                            </span>
                          </div>
                          {skill.description && (
                            <span className="mt-0.5 block truncate text-xs text-neutral-400 dark:text-neutral-500">
                              {skill.description}
                            </span>
                          )}
                        </div>
                      </button>
                      <DropdownMenu
                        anchor="bottom end"
                        trigger={
                          <MenuButton className="shrink-0 rounded p-1.5 text-neutral-300 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300">
                            <MoreVertical size={14} />
                          </MenuButton>
                        }
                      >
                        <DropdownMenuItem
                          icon={<Pencil size={13} />}
                          onClick={() => openEditor(skill)}
                        >
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          icon={<Download size={13} />}
                          onClick={() => {
                            void downloadSkill(skill).catch((error) =>
                              notify.error("Failed to export skill", error),
                            );
                          }}
                        >
                          Export
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          icon={<Trash2 size={13} />}
                          destructive
                          onClick={async () => {
                            if (
                              await confirm({
                                title: "Delete skill?",
                                message: `"${skill.name}" will be permanently removed. This can't be undone.`,
                                danger: true,
                              })
                            ) {
                              handleDeleteConfirm(skill);
                            }
                          }}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenu>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
