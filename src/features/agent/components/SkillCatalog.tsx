import { Dialog, Transition } from "@headlessui/react";
import JSZip from "jszip";
import {
  ArrowLeft,
  Check,
  Code,
  Copy,
  Download,
  Eye,
  FileText,
  Filter,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Replace,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useSkills } from "@/features/skills/hooks/useSkills";
import { useSkillTemplates } from "@/features/skills/hooks/useSkillTemplates";
import type { ParsedSkill, Skill, SkillResource } from "@/features/skills/lib/skillParser";
import { downloadSkill, parseSkillFile, validateSkillName } from "@/features/skills/lib/skillParser";
import type { SkillTemplate } from "@/features/skills/lib/templates";
import { getConfig } from "@/shared/config";
import { cn } from "@/shared/lib/cn";
import { confirm } from "@/shared/lib/confirm";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";
import { Markdown } from "@/shared/ui/Markdown";
import { SkillResourcesEditor } from "./SkillResourcesEditor";

interface SkillCatalogProps {
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

export function SkillCatalog({
  isOpen,
  onClose,
  onToggle,
  enabledSkillNames = NO_ENABLED_SKILLS,
  onSkillSaved,
  onImported,
  initialView = "list",
  initialSkillName,
}: SkillCatalogProps) {
  const { skills: allSkills, addSkill, updateSkill, removeSkill } = useSkills();
  const { templates, loadTemplate } = useSkillTemplates();
  const editorNameInputId = useId();
  const editorDescriptionInputId = useId();
  const editorContentInputId = useId();
  const editorNameInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [stableOrder, setStableOrder] = useState<string[]>([]);

  // Tabs: user's own skills vs. shipped templates
  const [tab, setTab] = useState<"mine" | "templates">("mine");
  const [templateCategory, setTemplateCategory] = useState<string>("");
  const [selectedTemplate, setSelectedTemplate] = useState<SkillTemplate | null>(null);
  const [templateContent, setTemplateContent] = useState<ParsedSkill | null>(null);
  const [templateLoading, setTemplateLoading] = useState(false);

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
      setSearch("");
      setTab("mine");
      setTemplateCategory("");
      setSelectedTemplate(null);
      setTemplateContent(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialView, initialSkillName, openEditor, allSkills]);

  useEffect(() => {
    if (!isOpen) return;
    if (editMode) {
      editorNameInputRef.current?.focus();
      return;
    }
    if (initialView !== "new") {
      searchInputRef.current?.focus();
    }
  }, [editMode, initialView, isOpen]);

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

  const openPreview = useCallback(
    (skill: Skill) => {
      discardAndRun(() => {
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
    return sorted.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  }, [allSkills, search, stableOrder]);

  const existingNames = useMemo(() => new Set(allSkills.map((s) => s.name)), [allSkills]);

  const templateCategories = useMemo(
    () => Array.from(new Set(templates.map((t) => t.category).filter(Boolean))).sort(),
    [templates],
  );

  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates
      .filter((t) => !templateCategory || t.category === templateCategory)
      .filter((t) => !q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }, [templates, search, templateCategory]);

  // Group filtered templates by category (preserving the sorted order) for headed sections.
  const groupedTemplates = useMemo(() => {
    const groups: { category: string; items: SkillTemplate[] }[] = [];
    for (const t of filteredTemplates) {
      const last = groups[groups.length - 1];
      if (last && last.category === t.category) last.items.push(t);
      else groups.push({ category: t.category, items: [t] });
    }
    return groups;
  }, [filteredTemplates]);

  const switchTab = useCallback(
    (next: "mine" | "templates") => {
      discardAndRun(() => {
        setTab(next);
        setSearch("");
        setTemplateCategory("");
        setSelectedSkill(null);
        setEditMode(false);
        setSelectedTemplate(null);
        setTemplateContent(null);
      });
    },
    [discardAndRun],
  );

  const openTemplate = useCallback(
    (template: SkillTemplate) => {
      setSelectedTemplate(template);
      setTemplateContent(null);
      setTemplateLoading(true);
      loadTemplate(template.path)
        .then((parsed) => setTemplateContent(parsed))
        .finally(() => setTemplateLoading(false));
    },
    [loadTemplate],
  );

  // Copy a template into the user's library. Stays in place (no tab switch / no
  // close) so several can be added in a row. addSkill de-dupes by name, so an
  // existing skill of the same name is replaced.
  const addTemplate = async (template: SkillTemplate) => {
    const parsed = await loadTemplate(template.path);
    if (!parsed) return;
    const added = addSkill(parsed);
    onSkillSaved(added, !existingNames.has(parsed.name));
  };

  const handleDeleteConfirm = (skill: Skill) => {
    removeSkill(skill.id);
    if (enabledSkillNames.has(skill.name)) {
      onToggle?.(skill.name);
    }
    setSelectedSkill(null);
    setEditMode(false);
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
      <Dialog as="div" className="relative z-80" onClose={() => discardAndRun(onClose)}>
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
                className="relative flex h-[90dvh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-neutral-200/50 bg-white/95 shadow-xl backdrop-blur-xl sm:h-[75dvh] dark:border-neutral-700/50 dark:bg-neutral-900/95"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
              >
                {isDragOver && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-slate-400 bg-slate-100/80 backdrop-blur-sm dark:border-slate-500 dark:bg-slate-800/80">
                    <div className="text-center">
                      <Plus size={24} className="mx-auto mb-1 text-neutral-600 dark:text-neutral-400" />
                      <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                        Drop skills to import
                      </p>
                    </div>
                  </div>
                )}

                {/* ── Full-width top bar ── */}
                <div className="flex shrink-0 items-center justify-between border-b border-neutral-200/60 px-4 py-3 dark:border-neutral-800/60">
                  <Dialog.Title className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    Skill Catalog
                  </Dialog.Title>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                  >
                    <X size={15} />
                  </button>
                </div>

                {/* ── Two-column body ── */}
                <div className="flex min-h-0 flex-1 sm:flex-row flex-col">
                  {/* ── Left panel: skill list ── */}
                  <div
                    className={`${selectedSkill || editMode || selectedTemplate ? "hidden sm:flex" : "flex"} w-full shrink-0 flex-col border-b border-neutral-200/60 sm:w-64 sm:border-b-0 sm:border-r dark:border-neutral-800/60`}
                  >
                    {/* Tabs: my skills vs. templates */}
                    <div className="flex shrink-0 items-center gap-1 border-b border-neutral-200/40 px-2 py-1.5 dark:border-neutral-800/40">
                      {[
                        { id: "mine" as const, label: "My Skills" },
                        { id: "templates" as const, label: "Templates" },
                      ].map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => switchTab(t.id)}
                          className={cn(
                            "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                            tab === t.id
                              ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                              : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200",
                          )}
                        >
                          {t.label}
                          {t.id === "templates" && templates.length > 0 && (
                            <span className="ml-1 text-[10px] text-neutral-400 dark:text-neutral-500">
                              {templates.length}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Search (+ category filter on the templates tab) */}
                    <div className="flex items-center gap-2 border-b border-neutral-200/40 px-3 py-2 dark:border-neutral-800/40">
                      <Search size={12} className="shrink-0 text-neutral-400" />
                      <input
                        ref={searchInputRef}
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search…"
                        className="flex-1 bg-transparent text-xs text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
                      />
                      {search && (
                        <button
                          type="button"
                          onClick={() => setSearch("")}
                          className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                        >
                          <X size={11} />
                        </button>
                      )}
                      {tab === "templates" && templateCategories.length > 0 && (
                        <DropdownMenu
                          anchor="bottom end"
                          panelClassName="min-w-44 max-h-80 overflow-y-auto"
                          trigger={
                            <MenuButton
                              title={
                                templateCategory
                                  ? `Category: ${templateCategory.replace(/-/g, " ")}`
                                  : "Filter by category"
                              }
                              className={cn(
                                "relative flex shrink-0 items-center rounded-md p-0.5 transition-colors",
                                templateCategory
                                  ? "text-neutral-900 dark:text-neutral-100"
                                  : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300",
                              )}
                            >
                              <Filter size={13} className="shrink-0" />
                              {templateCategory && (
                                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-neutral-800 dark:bg-neutral-200" />
                              )}
                            </MenuButton>
                          }
                        >
                          <DropdownMenuItem selected={!templateCategory} onClick={() => setTemplateCategory("")}>
                            All categories
                          </DropdownMenuItem>
                          {templateCategories.map((c) => (
                            <DropdownMenuItem
                              key={c}
                              selected={templateCategory === c}
                              onClick={() => setTemplateCategory(c)}
                            >
                              <span className="capitalize">{c.replace(/-/g, " ")}</span>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenu>
                      )}
                    </div>

                    {/* Skill list */}
                    <div className="flex-1 overflow-y-auto py-1">
                      {tab === "templates" ? (
                        templates.length === 0 ? (
                          <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
                            <Copy size={28} className="text-neutral-300 dark:text-neutral-600" />
                            <div>
                              <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                                No templates available
                              </p>
                              <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">
                                Default skills shipped with this deployment appear here
                              </p>
                            </div>
                          </div>
                        ) : filteredTemplates.length === 0 ? (
                          <p className="py-6 text-center text-xs text-neutral-400 dark:text-neutral-500">
                            No templates match your search.
                          </p>
                        ) : (
                          groupedTemplates.map((group) => (
                            <div key={group.category || "_"}>
                              {group.category && (
                                <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                                  {group.category.replace(/-/g, " ")}
                                </p>
                              )}
                              {group.items.map((template) => {
                                const added = existingNames.has(template.name);
                                const isSelected = selectedTemplate?.name === template.name;
                                return (
                                  <button
                                    key={template.path}
                                    type="button"
                                    onClick={() => openTemplate(template)}
                                    className={`group flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                                      isSelected
                                        ? "bg-neutral-100 dark:bg-neutral-800/70"
                                        : "hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                                    }`}
                                  >
                                    <div className="min-w-0 flex-1">
                                      <span className="block truncate text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                                        {template.name}
                                      </span>
                                      {template.description && (
                                        <span className="mt-0.5 block truncate text-[11px] leading-tight text-neutral-400 dark:text-neutral-500">
                                          {template.description}
                                        </span>
                                      )}
                                    </div>
                                    {added && (
                                      <span
                                        title="Already in your skills"
                                        className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-medium text-neutral-400 dark:text-neutral-500"
                                      >
                                        <Check size={11} />
                                        Added
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          ))
                        )
                      ) : allSkills.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
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
                      ) : filteredSkills.length === 0 ? (
                        <p className="py-6 text-center text-xs text-neutral-400 dark:text-neutral-500">
                          No skills match your search.
                        </p>
                      ) : (
                        filteredSkills.map((skill) => {
                          const enabled = enabledSkillNames.has(skill.name);
                          const isSelected = selectedSkill?.id === skill.id;

                          return (
                            <div
                              key={skill.id}
                              className={`group flex items-center gap-2 px-3 py-2 transition-colors cursor-pointer ${
                                isSelected
                                  ? "bg-neutral-100 dark:bg-neutral-800/70"
                                  : "hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                              }`}
                            >
                              {onToggle && (
                                <button
                                  type="button"
                                  onClick={() => onToggle(skill.name)}
                                  className="shrink-0 flex items-center justify-center rounded transition-colors"
                                  title={enabled ? "Remove from agent" : "Add to agent"}
                                >
                                  <span
                                    className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                                      enabled
                                        ? "border-neutral-700 bg-neutral-800 dark:border-neutral-300 dark:bg-neutral-300"
                                        : "border-neutral-300 bg-white dark:border-neutral-600 dark:bg-neutral-800"
                                    }`}
                                  >
                                    {enabled && (
                                      <svg viewBox="0 0 10 8" className="h-2.5 w-2.5" fill="none" aria-hidden="true">
                                        <path
                                          d="M1 4l3 3 5-6"
                                          stroke="currentColor"
                                          strokeWidth="1.5"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          className="text-white dark:text-neutral-900"
                                        />
                                      </svg>
                                    )}
                                  </span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openPreview(skill)}
                                className="min-w-0 flex-1 text-left"
                              >
                                <span className="block truncate text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                                  {skill.name}
                                </span>
                                {skill.description && (
                                  <span className="mt-0.5 block truncate text-[11px] leading-tight text-neutral-400 dark:text-neutral-500">
                                    {skill.description}
                                  </span>
                                )}
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* List footer actions */}
                    {tab === "mine" && (
                      <div className="flex items-center gap-1.5 border-t border-neutral-200/60 px-3 py-3 dark:border-neutral-800/60">
                        <button
                          type="button"
                          onClick={() => openEditor("new")}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-neutral-300/50 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100/50 dark:border-neutral-600/50 dark:text-neutral-400 dark:hover:bg-neutral-800/50"
                        >
                          <Plus size={11} />
                          New
                        </button>
                        <button
                          type="button"
                          onClick={handleImport}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-neutral-300/50 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100/50 dark:border-neutral-600/50 dark:text-neutral-400 dark:hover:bg-neutral-800/50"
                        >
                          <Upload size={11} />
                          Import
                        </button>
                      </div>
                    )}
                  </div>

                  {/* ── Right panel ── */}
                  <div
                    className={`${!selectedSkill && !editMode && !selectedTemplate ? "hidden sm:flex" : "flex"} min-w-0 flex-1 flex-col`}
                  >
                    {selectedTemplate ? (
                      /* ── Template preview ── */
                      <>
                        <div className="flex items-center gap-2 border-b border-neutral-200/60 px-5 py-3.5 dark:border-neutral-800/60">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedTemplate(null);
                              setTemplateContent(null);
                            }}
                            className="-ml-1 shrink-0 rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 sm:hidden dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                          >
                            <ArrowLeft size={16} />
                          </button>
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                              {selectedTemplate.name}
                            </span>
                            <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                              Template
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => addTemplate(selectedTemplate)}
                            disabled={templateLoading || !templateContent}
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-200 dark:text-neutral-900"
                          >
                            {existingNames.has(selectedTemplate.name) ? <Replace size={13} /> : <Plus size={13} />}
                            {existingNames.has(selectedTemplate.name) ? "Replace" : "Add to my skills"}
                          </button>
                        </div>

                        <div className="flex-1 overflow-y-auto px-5 py-4">
                          {templateLoading ? (
                            <div className="flex h-full items-center justify-center">
                              <Loader2 size={20} className="animate-spin text-neutral-300 dark:text-neutral-600" />
                            </div>
                          ) : !templateContent ? (
                            <p className="py-6 text-center text-xs text-neutral-400 dark:text-neutral-500">
                              Failed to load this template.
                            </p>
                          ) : (
                            <>
                              {templateContent.description && (
                                <div className="mb-4">
                                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                                    Description
                                  </p>
                                  <p className="text-sm text-neutral-700 dark:text-neutral-300">
                                    {templateContent.description}
                                  </p>
                                </div>
                              )}
                              <div>
                                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                                  Instructions
                                </p>
                                <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-sm">
                                  <Markdown>{templateContent.content}</Markdown>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </>
                    ) : editMode ? (
                      /* ── Editor ── */
                      <>
                        <div className="flex min-h-0 flex-1">
                          <div className="flex-1 min-w-0 space-y-5 overflow-y-auto px-5 py-5">
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
                          <div className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-neutral-200/60 px-4 py-4 dark:border-neutral-800/60">
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
                              onClick={() => discardAndRun(() => setEditMode(false))}
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
                      </>
                    ) : selectedSkill ? (
                      /* ── Preview ── */
                      <>
                        <div className="flex items-center gap-2 border-b border-neutral-200/60 px-5 py-3.5 dark:border-neutral-800/60">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedSkill(null);
                              setEditMode(false);
                            }}
                            className="-ml-1 shrink-0 rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 sm:hidden dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                          >
                            <ArrowLeft size={16} />
                          </button>
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                              {selectedSkill.name}
                            </span>
                            {onToggle && enabledSkillNames.has(selectedSkill.name) && (
                              <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                                Active
                              </span>
                            )}
                          </div>
                          {onToggle && (
                            <button
                              type="button"
                              role="switch"
                              aria-checked={enabledSkillNames.has(selectedSkill.name)}
                              onClick={() => onToggle(selectedSkill.name)}
                              title={enabledSkillNames.has(selectedSkill.name) ? "Remove from agent" : "Add to agent"}
                              className={`relative shrink-0 inline-flex h-5 w-9 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                                enabledSkillNames.has(selectedSkill.name)
                                  ? "bg-neutral-800 dark:bg-neutral-300"
                                  : "bg-neutral-200 dark:bg-neutral-700"
                              }`}
                            >
                              <span
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 dark:bg-neutral-900 ${
                                  enabledSkillNames.has(selectedSkill.name) ? "translate-x-4" : "translate-x-0"
                                }`}
                              />
                            </button>
                          )}
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
                              onClick={() => downloadSkill(selectedSkill)}
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
                      </>
                    ) : (
                      /* ── Empty right panel ── */
                      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                        <FileText size={32} className="text-neutral-200 dark:text-neutral-700" />
                        <div>
                          <p className="text-sm font-medium text-neutral-400 dark:text-neutral-500">
                            Select a skill to view
                          </p>
                          <p className="mt-0.5 text-xs text-neutral-300 dark:text-neutral-600">
                            Or create a new one to get started
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {/* end two-column body */}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
