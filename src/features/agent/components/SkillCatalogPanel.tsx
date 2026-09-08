import { Code, Download, Eye, Loader2, MoreVertical, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
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
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";
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
  /** Called after a skill has been deleted. */
  onDeleted?: () => void;
  initialView?: "list" | "new";
  /** When set, pre-selects this skill in preview (read-only) mode on open. */
  initialSkillName?: string;
  /** Search query managed by the parent (dialog top bar). */
  search?: string;
  /** When set, navigates to this skill's detail view. Changes to this value (even same name) trigger navigation. */
  requestedSkillName?: string;
  /** Notifies the parent of the current view kind so it can hide the search bar when drilled in. */
  onViewKindChange?: (kind: "list" | "skill-detail" | "skill-edit") => void;
  /** Publishes the list-view actions so the parent can render them in its top bar. */
  onActionsChange?: (actions: SkillCatalogActions | null) => void;
  /** Expose the current back-navigation handler so the parent can invoke it on Escape. */
  onNavigateBackChange?: (fn: (() => void) | null) => void;
  /** Registers a guard the parent must call before navigating away. Resolves true = safe to proceed. */
  onConfirmDiscardChange?: (fn: (() => Promise<boolean>) | null) => void;
}

const NO_ENABLED_SKILLS: ReadonlySet<string> = new Set();

const RESOURCES_WIDTH_DEFAULT = 224;
const RESOURCES_WIDTH_MIN = 180;
const RESOURCES_WIDTH_MAX = 480;

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
  onDeleted,
  initialView = "list",
  initialSkillName,
  search: _search = "",
  requestedSkillName,
  onViewKindChange,
  onActionsChange,
  onNavigateBackChange,
  onConfirmDiscardChange,
}: SkillCatalogPanelProps) {
  const { skills: allSkills, addSkill, updateSkill, removeSkill } = useSkills();
  const isDesktop = useMediaQuery("(min-width: 640px)");
  const editorNameInputId = useId();
  const editorDescriptionInputId = useId();
  const editorContentInputId = useId();
  const editorNameInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Resources sidebar width — shared by the edit and detail panels, resizable via drag handle.
  const [resourcesWidth, setResourcesWidth] = useState(RESOURCES_WIDTH_DEFAULT);
  const [isResizingResources, setIsResizingResources] = useState(false);

  const handleResourcesResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = resourcesWidth;
      setIsResizingResources(true);
      document.body.classList.add("resizing");

      const onMove = (ev: PointerEvent) => {
        const next = startWidth + (startX - ev.clientX);
        setResourcesWidth(Math.min(RESOURCES_WIDTH_MAX, Math.max(RESOURCES_WIDTH_MIN, next)));
      };
      const onUp = () => {
        setIsResizingResources(false);
        document.body.classList.remove("resizing");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [resourcesWidth],
  );

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

  useEffect(() => {
    if (!isOpen) return;
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
    // Runs once per dialog open (and when the requested initial view/skill
    // changes) — allSkills is read only to resolve initialSkillName at that
    // moment, not to keep re-syncing while the dialog stays open and skills
    // are edited/saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialView, initialSkillName]);

  // Sidebar navigation: jump to a skill detail without closing/reopening the dialog.
  useEffect(() => {
    if (!requestedSkillName || !isOpen) return;
    const target = allSkills.find((s) => s.name === requestedSkillName);
    if (target) {
      setSelectedSkill(target);
      setEditMode(false);
    }
    // allSkills intentionally omitted — resolves at the moment the request changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedSkillName, isOpen]);

  useEffect(() => {
    if (isOpen) return;
    setSelectedSkill(null);
    setEditMode(false);
  }, [isOpen]);

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
      return edName.trim() !== "" || edDescription.trim() !== "" || edContent.trim() !== "" || resourcesChanged;
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
      const result = await config.client.optimizeSkill(config.chat?.optimizer || "", edName, edDescription, edContent);
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

  const canOptimize = (edDescription.trim().length > 0 || edContent.trim().length > 0) && !isOptimizing;

  const handleDeleteConfirm = (skill: Skill) => {
    removeSkill(skill.id);
    if (enabledSkillNames.has(skill.name)) {
      onToggle?.(skill.name);
    }
    setSelectedSkill(null);
    setEditMode(false);
    onDeleted?.();
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
    void downloadSkillsAsZip(allSkills).catch((error) => notify.error("Failed to export skills", error));
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
    onActionsChange({
      onNew: () => openEditor("new"),
      onImport: handleImport,
      onExportAll: handleExportAll,
      canExport: allSkills.length > 0,
    });
  }, [viewKind, onActionsChange, openEditor, handleImport, handleExportAll, allSkills.length]);

  useEffect(() => {
    return () => onActionsChange?.(null);
  }, [onActionsChange]);

  // Publish the back-navigation function for the parent's Escape handler.
  useEffect(() => {
    if (!onNavigateBackChange) return;
    if (viewKind === "skill-edit") {
      // When editing an existing skill go to detail; when creating new go to list.
      onNavigateBackChange(() => void discardAndRun(() => setEditMode(false)));
    } else if (viewKind === "skill-detail") {
      onNavigateBackChange(() => {
        setSelectedSkill(null);
        setEditMode(false);
      });
    } else {
      onNavigateBackChange(null);
    }
  }, [viewKind, onNavigateBackChange, discardAndRun]);

  useEffect(() => {
    return () => onNavigateBackChange?.(null);
  }, [onNavigateBackChange]);

  useEffect(() => {
    if (!onConfirmDiscardChange) return;
    if (!hasUnsavedChanges) {
      onConfirmDiscardChange(null);
      return;
    }
    onConfirmDiscardChange(() =>
      confirm({
        title: "Discard changes?",
        message: "Your unsaved edits to this skill will be lost.",
        danger: true,
      }),
    );
  }, [hasUnsavedChanges, onConfirmDiscardChange]);

  useEffect(() => {
    return () => onConfirmDiscardChange?.(null);
  }, [onConfirmDiscardChange]);

  if (viewKind === "skill-edit") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* ── Editor header ── */}
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-neutral-200/60 px-4 dark:border-neutral-800/60">
          <span className="ml-1 flex-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
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
                    <p className="text-xs italic text-neutral-400 dark:text-neutral-500">Nothing to preview yet.</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Resources sidebar */}
          <div
            className="relative flex w-full sm:w-auto shrink-0 flex-col overflow-y-auto border-t sm:border-t-0 sm:border-l border-neutral-200/60 px-4 py-4 dark:border-neutral-800/60"
            style={isDesktop ? { width: resourcesWidth } : undefined}
          >
            {isDesktop && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize resources panel"
                onPointerDown={handleResourcesResizeStart}
                className={cn("absolute -left-1 top-0 bottom-0 w-2 cursor-col-resize touch-none z-10 group/handle")}
              >
                <div
                  className={cn(
                    "absolute inset-y-0 left-1/2 -translate-x-1/2 w-px transition-colors",
                    isResizingResources
                      ? "bg-neutral-950 dark:bg-neutral-100"
                      : "bg-transparent group-hover/handle:bg-neutral-800 dark:group-hover/handle:bg-neutral-300",
                  )}
                />
              </div>
            )}
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
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-neutral-200/60 px-4 dark:border-neutral-800/60">
          <div className="ml-1 flex min-w-0 flex-1 items-center gap-2">
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
                void downloadSkill(selectedSkill).catch((error) => notify.error("Failed to export skill", error));
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

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row overflow-y-auto sm:overflow-y-visible">
          <div className="flex-1 min-w-0 sm:overflow-y-auto px-5 py-4">
            {selectedSkill.description && (
              <div className="mb-4">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                  Description
                </p>
                <p className="text-sm text-neutral-700 dark:text-neutral-300">{selectedSkill.description}</p>
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
          </div>

          {/* Resources sidebar */}
          <div
            className="relative flex w-full sm:w-auto shrink-0 flex-col overflow-y-auto border-t sm:border-t-0 sm:border-l border-neutral-200/60 px-4 py-4 dark:border-neutral-800/60"
            style={isDesktop ? { width: resourcesWidth } : undefined}
          >
            {isDesktop && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize resources panel"
                onPointerDown={handleResourcesResizeStart}
                className="absolute -left-1 top-0 bottom-0 w-2 cursor-col-resize touch-none z-10 group/handle"
              >
                <div
                  className={cn(
                    "absolute inset-y-0 left-1/2 -translate-x-1/2 w-px transition-colors",
                    isResizingResources
                      ? "bg-neutral-950 dark:bg-neutral-100"
                      : "bg-transparent group-hover/handle:bg-neutral-800 dark:group-hover/handle:bg-neutral-300",
                  )}
                />
              </div>
            )}
            <SkillResourcesEditor resources={selectedSkill.resources ?? []} />
          </div>
        </div>
      </div>
    );
  }

  // ── Empty state (sidebar owns the list) ──────────────────────────────────
  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col items-center justify-center"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {isDragOver ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-slate-400 bg-slate-100/80 backdrop-blur-sm dark:border-slate-500 dark:bg-slate-800/80">
          <div className="text-center">
            <Plus size={24} className="mx-auto mb-1 text-neutral-600 dark:text-neutral-400" />
            <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Drop skills to import</p>
          </div>
        </div>
      ) : allSkills.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-5 text-center">
          <Sparkles size={28} className="text-neutral-300 dark:text-neutral-600" />
          <div>
            <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">No skills yet</p>
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
        <p className="text-xs text-neutral-400 dark:text-neutral-500">Select a skill from the sidebar</p>
      )}
    </div>
  );
}
