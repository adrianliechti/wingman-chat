import { Dialog, Transition } from "@headlessui/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Download,
  Plus,
  Puzzle,
  Search,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePlugins } from "@/features/plugins/hooks/usePlugins";
import { downloadPluginsAsZip } from "@/features/plugins/lib/pluginExport";
import { useSkills } from "@/features/skills/hooks/useSkills";
import { getConfig } from "@/shared/config";
import { cn } from "@/shared/lib/cn";
import { notify } from "@/shared/lib/notify";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";
import type { SkillCatalogActions, SkillCatalogPanelProps } from "./SkillCatalogPanel";
import { SkillCatalogPanel } from "./SkillCatalogPanel";
import { PluginsManagerPanel } from "./PluginsManagerPanel";

export type LibrarySection = "skills" | "plugins";

export interface LibraryDialogProps extends SkillCatalogPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialSection?: LibrarySection;
  enabledPluginIds?: ReadonlySet<string>;
  onTogglePlugin?: (pluginId: string) => void;
}

export function LibraryDialog({
  isOpen,
  onClose,
  initialSection = "skills",
  onToggle,
  enabledSkillNames,
  enabledPluginIds,
  onTogglePlugin,
  onSkillSaved,
  onImported,
  initialView,
  initialSkillName,
}: LibraryDialogProps) {
  const { plugins } = usePlugins();
  const { skills } = useSkills();
  const hubUrl = getConfig().plugins?.url;
  const showPlugins = plugins.length > 0 || Boolean(hubUrl);

  const [search, setSearch] = useState("");
  const [section, setSection] = useState<LibrarySection>(initialSection);
  const [overview, setOverview] = useState(false);
  const [skillViewKind, setSkillViewKind] = useState<string>("list");
  const [pluginViewKind, setPluginViewKind] = useState<string>("list");
  const [skillActions, setSkillActions] = useState<SkillCatalogActions | null>(null);
  const [requestedSkillName, setRequestedSkillName] = useState<string | undefined>(undefined);
  const [requestedPluginId, setRequestedPluginId] = useState<string | undefined>(undefined);
  const [hasMoreSkillsBelow, setHasMoreSkillsBelow] = useState(false);
  const [hasMorePluginsBelow, setHasMorePluginsBelow] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const skillListRef = useRef<HTMLUListElement>(null);
  const pluginListRef = useRef<HTMLUListElement>(null);
  const skillBackRef = useRef<(() => void) | null>(null);
  const pluginBackRef = useRef<((destination?: "parent" | "overview") => void) | null>(null);
  const pendingNewSkillRef = useRef(false);
  const confirmSkillDiscardRef = useRef<(() => Promise<boolean>) | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSection(initialSection === "plugins" ? "plugins" : "skills");
      setSearch("");
      // Open directly into the requested list. An explicitly requested skill
      // or editor still opens straight into its detail view.
      setOverview(
        initialSection === "plugins" ? false : !initialSkillName && initialView !== "new",
      );
      if (initialSection !== "plugins" && initialSkillName) {
        setRequestedSkillName(initialSkillName);
      }
    } else {
      setSearch("");
      setOverview(true);
      setSkillViewKind("list");
      setPluginViewKind("list");
      setRequestedSkillName(undefined);
      setRequestedPluginId(undefined);
      pendingNewSkillRef.current = false;
    }
  }, [isOpen, initialSection, initialSkillName, initialView]);

  const updatePluginScrollHint = useCallback(() => {
    const list = pluginListRef.current;
    if (!list) return;
    const isScrollable = list.scrollHeight > list.clientHeight;
    setHasMorePluginsBelow(
      isScrollable && list.scrollTop + list.clientHeight < list.scrollHeight - 2,
    );
  }, []);

  const updateSkillScrollHint = useCallback(() => {
    const list = skillListRef.current;
    if (!list) return;
    setHasMoreSkillsBelow(
      list.scrollHeight > list.clientHeight &&
        list.scrollTop + list.clientHeight < list.scrollHeight - 2,
    );
  }, []);

  const scrollSkillListToBottom = useCallback(() => {
    const list = skillListRef.current;
    list?.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, []);

  const scrollPluginListToBottom = useCallback(() => {
    const list = pluginListRef.current;
    list?.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (pendingNewSkillRef.current && skillActions) {
      pendingNewSkillRef.current = false;
      skillActions.onNew();
    }
  }, [skillActions]);

  const skillIsDrilledIn = skillViewKind !== "list";
  const pluginIsDrilledIn = pluginViewKind !== "list";
  const isDrilledIn = section === "skills" ? skillIsDrilledIn : pluginIsDrilledIn;
  const q = search.trim().toLowerCase();
  const showOverview = section === "skills" && (overview || q !== "");
  const skillsSectionActive = showOverview;
  const pluginsSectionActive = section === "plugins" && pluginViewKind === "list";
  const hasDetailBreadcrumb =
    section === "skills"
      ? !showOverview && skillViewKind === "skill-detail"
      : pluginViewKind === "installed-detail" ||
        pluginViewKind === "installed-skill" ||
        pluginViewKind === "store-detail";

  const sortedSkills = useMemo(
    () => [...skills].sort((a, b) => a.name.localeCompare(b.name)),
    [skills],
  );
  const sortedPlugins = useMemo(
    () => [...plugins].sort((a, b) => (a.title ?? a.id).localeCompare(b.title ?? b.id)),
    [plugins],
  );
  const filteredSkills = useMemo(() => {
    if (!q) return sortedSkills;
    return sortedSkills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [sortedSkills, q]);
  const filteredPlugins = useMemo(() => {
    if (!q) return sortedPlugins;
    return sortedPlugins.filter(
      (p) =>
        (p.title ?? p.id).toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q),
    );
  }, [sortedPlugins, q]);

  useEffect(() => {
    if (!isOpen) {
      setHasMoreSkillsBelow(false);
      return;
    }
    const list = skillListRef.current;
    if (!list) return;
    updateSkillScrollHint();
    const resizeObserver = new ResizeObserver(updateSkillScrollHint);
    resizeObserver.observe(list);
    window.addEventListener("resize", updateSkillScrollHint);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateSkillScrollHint);
    };
  }, [isOpen, sortedSkills.length, updateSkillScrollHint]);

  useEffect(() => {
    if (!isOpen || !showPlugins) {
      setHasMorePluginsBelow(false);
      return;
    }
    const list = pluginListRef.current;
    if (!list) return;
    updatePluginScrollHint();
    const resizeObserver = new ResizeObserver(updatePluginScrollHint);
    resizeObserver.observe(list);
    window.addEventListener("resize", updatePluginScrollHint);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updatePluginScrollHint);
    };
  }, [isOpen, showPlugins, sortedPlugins.length, updatePluginScrollHint]);

  const handleClose = async () => {
    if (confirmSkillDiscardRef.current && !(await confirmSkillDiscardRef.current())) return;
    onClose();
  };

  const handleDismiss = async () => {
    if (search) {
      setSearch("");
      searchInputRef.current?.focus();
      return;
    }
    // Escape/backdrop navigate detail views before closing the dialog.
    const viewKind = section === "skills" ? skillViewKind : pluginViewKind;
    const backFn = section === "skills" ? skillBackRef.current : pluginBackRef.current;
    // These views return directly to the section overview; editors defer to their own back handler.
    const oneStepFromList = viewKind === "skill-detail" || viewKind === "installed-detail";
    if (isDrilledIn) {
      if (oneStepFromList) {
        backFn?.();
        setRequestedSkillName(undefined);
        setRequestedPluginId(undefined);
        setOverview(true);
      } else {
        backFn?.();
      }
      return;
    }
    await handleClose();
  };

  const showSkillsList = useCallback(async () => {
    if (confirmSkillDiscardRef.current && !(await confirmSkillDiscardRef.current())) return;
    setSection("skills");
    setRequestedSkillName(undefined);
    setOverview(true);
    skillBackRef.current?.();
  }, []);

  const showPluginsList = useCallback(async () => {
    if (confirmSkillDiscardRef.current && !(await confirmSkillDiscardRef.current())) return;
    setSection("plugins");
    setRequestedPluginId(undefined);
    setOverview(false);
    pluginBackRef.current?.("overview");
  }, []);

  const openSkill = useCallback(async (name: string) => {
    if (confirmSkillDiscardRef.current && !(await confirmSkillDiscardRef.current())) return;
    setSection("skills");
    setOverview(false);
    setSearch("");
    setRequestedSkillName(name);
  }, []);

  const openPlugin = useCallback(async (id: string) => {
    if (confirmSkillDiscardRef.current && !(await confirmSkillDiscardRef.current())) return;
    setSection("plugins");
    setOverview(false);
    setSearch("");
    setRequestedPluginId(id);
  }, []);

  const createNewSkill = useCallback(async () => {
    if (confirmSkillDiscardRef.current && !(await confirmSkillDiscardRef.current())) return;
    setSection("skills");
    setOverview(false);
    setSearch("");
    setRequestedSkillName(undefined);
    if (skillActions) {
      skillActions.onNew();
    } else {
      pendingNewSkillRef.current = true;
    }
  }, [skillActions]);

  const handleMobileBack = useCallback(() => {
    if (section === "plugins" && pluginViewKind === "store-detail") {
      pluginBackRef.current?.();
      return;
    }
    if (section === "skills") {
      void showSkillsList();
    } else {
      void showPluginsList();
    }
  }, [pluginViewKind, section, showPluginsList, showSkillsList]);

  const handleExportAllPlugins = useCallback(() => {
    if (plugins.length === 0) {
      notify.error("No plugins to export");
      return;
    }
    void downloadPluginsAsZip(plugins).catch((error) =>
      notify.error("Failed to export plugins", error),
    );
  }, [plugins]);

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-80" onClose={handleDismiss}>
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
          <div className="flex min-h-full items-end justify-center sm:items-center sm:p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative flex w-full flex-col overflow-hidden bg-white/95 shadow-xl backdrop-blur-xl dark:bg-neutral-900/95 rounded-t-2xl sm:rounded-xl sm:border sm:border-neutral-200/50 dark:sm:border-neutral-700/50 h-[92dvh] sm:h-[75dvh] sm:max-w-5xl">
                {/* ── Top bar ── */}
                <div className="relative flex h-12 shrink-0 items-center gap-2 border-b border-neutral-200/60 pr-3 pl-3 sm:pl-4 sm:py-2 dark:border-neutral-800/60">
                  {isDrilledIn && !hasDetailBreadcrumb && (
                    <button
                      type="button"
                      onClick={handleMobileBack}
                      title="Back to list"
                      aria-label="Back to list"
                      className="shrink-0 rounded-md p-2 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 sm:hidden dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                    >
                      <ArrowLeft size={18} />
                    </button>
                  )}
                  <Dialog.Title className="hidden shrink-0 text-sm font-semibold text-neutral-900 sm:block dark:text-neutral-100">
                    Catalog
                  </Dialog.Title>
                  <div
                    className={cn(
                      "flex min-w-0 flex-1 items-center md:absolute md:left-1/2 md:top-1/2 md:w-64 md:-translate-x-1/2 md:-translate-y-1/2",
                      isDrilledIn && "max-sm:hidden",
                    )}
                  >
                    <div className="flex w-full items-center gap-2 rounded-md border border-neutral-200/70 bg-neutral-50/50 px-2 py-2 sm:max-w-xs sm:py-1.5 sm:w-64 focus-within:border-neutral-300 focus-within:ring-2 focus-within:ring-neutral-500/15 dark:border-neutral-700/50 dark:bg-neutral-800/30 dark:focus-within:border-neutral-600">
                      <Search size={11} className="shrink-0 text-neutral-400" />
                      <input
                        ref={searchInputRef}
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={section === "plugins" ? "Search plugins…" : "Search skills…"}
                        className="min-w-0 flex-1 bg-transparent text-xs text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
                      />
                      {search && (
                        <button
                          type="button"
                          onClick={() => setSearch("")}
                          className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                        >
                          <X size={10} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    {section === "skills" && !isDrilledIn && (
                      <DropdownMenu
                        anchor="bottom end"
                        trigger={
                          <MenuButton
                            type="button"
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                          >
                            <Plus size={13} aria-hidden="true" />
                            Add skill
                          </MenuButton>
                        }
                      >
                        <DropdownMenuItem icon={<Plus size={13} />} onClick={createNewSkill}>
                          New skill
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          icon={<Upload size={13} />}
                          onClick={async () => {
                            if (
                              confirmSkillDiscardRef.current &&
                              !(await confirmSkillDiscardRef.current())
                            )
                              return;
                            skillActions?.onImport();
                          }}
                          disabled={!skillActions}
                        >
                          Import
                        </DropdownMenuItem>
                      </DropdownMenu>
                    )}
                    {section === "skills" && skillActions && !isDrilledIn && (
                      <button
                        type="button"
                        onClick={skillActions.onExportAll}
                        disabled={!skillActions.canExport}
                        title="Export all skills"
                        className="shrink-0 rounded-md p-2 sm:p-1.5 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-neutral-800"
                      >
                        <Download size={15} />
                      </button>
                    )}
                    {section === "plugins" && !isDrilledIn && (
                      <button
                        type="button"
                        onClick={handleExportAllPlugins}
                        disabled={plugins.length === 0}
                        title="Export all plugins"
                        className="shrink-0 rounded-md p-2 sm:p-1.5 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-neutral-800"
                      >
                        <Download size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleClose()}
                      aria-label="Close catalog"
                      className="shrink-0 rounded-md p-2 sm:p-1.5 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>

                {!isDrilledIn && (
                  <nav
                    aria-label="Catalog sections"
                    className="flex shrink-0 gap-1 border-b border-neutral-200/60 px-3 py-1 sm:hidden dark:border-neutral-800/60"
                  >
                    <button
                      type="button"
                      onClick={showSkillsList}
                      className={cn(
                        "flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors",
                        section === "skills"
                          ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                          : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-200",
                      )}
                    >
                      <Sparkles size={15} />
                      Skills
                    </button>
                    {showPlugins && (
                      <button
                        type="button"
                        onClick={showPluginsList}
                        className={cn(
                          "flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors",
                          section === "plugins"
                            ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                            : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-200",
                        )}
                      >
                        <Puzzle size={15} />
                        Plugins
                      </button>
                    )}
                  </nav>
                )}

                {/* ── Body ── */}
                <div className="flex min-h-0 flex-1 overflow-hidden">
                  {/* ── Left nav sidebar ── */}
                  <nav
                    aria-label="Catalog navigation"
                    className="hidden w-56 shrink-0 flex-col gap-3 overflow-hidden border-r border-neutral-200/60 bg-neutral-50/80 px-2 py-2 sm:flex dark:border-neutral-800/60 dark:bg-neutral-950/20"
                  >
                    {/* Skills section */}
                    <div
                      className={cn(
                        "relative flex min-h-0 flex-1 flex-col",
                        showPlugins ? "order-2" : "order-1",
                      )}
                    >
                      <div className="mb-1 flex shrink-0">
                        <button
                          type="button"
                          onClick={showSkillsList}
                          title="Show all skills"
                          aria-label="Show all skills"
                          aria-current={skillsSectionActive ? "page" : undefined}
                          className={cn(
                            "group flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-[11px] font-semibold uppercase tracking-wider transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-neutral-400",
                            skillsSectionActive
                              ? "bg-neutral-200/40 text-neutral-900 dark:bg-neutral-800/60 dark:text-neutral-100"
                              : "text-neutral-500 hover:bg-neutral-200/40 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100",
                          )}
                        >
                          <span className="flex-1">Skills</span>
                          <ArrowRight
                            size={14}
                            className="shrink-0 text-neutral-400 group-hover:text-current dark:text-neutral-500"
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                      <ul
                        ref={skillListRef}
                        onScroll={updateSkillScrollHint}
                        className="ml-2 min-h-0 overflow-y-auto border-l border-neutral-200/80 pl-2 dark:border-neutral-800"
                      >
                        {sortedSkills.length === 0 && (
                          <li className="px-2 py-2 text-xs text-neutral-400 dark:text-neutral-600">
                            No skills yet
                          </li>
                        )}
                        {sortedSkills.map((skill) => {
                          const active =
                            !showOverview &&
                            section === "skills" &&
                            requestedSkillName === skill.name;
                          const enabled = enabledSkillNames?.has(skill.name) ?? false;
                          return (
                            <li key={skill.id} className="group/row relative">
                              <button
                                type="button"
                                onClick={() => openSkill(skill.name)}
                                aria-current={active ? "page" : undefined}
                                className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-neutral-400 hover:bg-neutral-200/40 aria-[current=page]:bg-neutral-200/40 dark:hover:bg-neutral-800/50 dark:aria-[current=page]:bg-neutral-800/50"
                              >
                                <Sparkles
                                  size={14}
                                  className="shrink-0 text-neutral-400 dark:text-neutral-500"
                                />
                                <span className="min-w-0 flex-1">
                                  <span
                                    className={cn(
                                      "block truncate text-[13px] leading-5",
                                      active || enabled
                                        ? "font-medium text-neutral-900 dark:text-neutral-100"
                                        : "text-neutral-600 dark:text-neutral-300",
                                    )}
                                  >
                                    {skill.name}
                                  </span>
                                </span>
                                {onToggle && (
                                  <span
                                    role="checkbox"
                                    aria-checked={enabled}
                                    aria-label={enabled ? "Disable skill" : "Enable skill"}
                                    tabIndex={0}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onToggle(skill.name);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        onToggle(skill.name);
                                      }
                                    }}
                                    className={cn(
                                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                                      enabled
                                        ? "border-transparent bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900"
                                        : "border-neutral-300 text-transparent opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 hover:border-neutral-400 dark:border-neutral-600 dark:hover:border-neutral-500",
                                    )}
                                  >
                                    <Check size={10} strokeWidth={3} />
                                  </span>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      {hasMoreSkillsBelow && (
                        <div className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-center">
                          <button
                            type="button"
                            onClick={scrollSkillListToBottom}
                            title="Scroll to the end of skills"
                            aria-label="Scroll to the end of skills"
                            className="pointer-events-auto rounded-full border border-neutral-200 bg-white p-0.5 text-neutral-600 shadow-sm transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
                          >
                            <ChevronDown size={15} />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Plugins section */}
                    {showPlugins && (
                      <div className="relative order-1 flex min-h-0 max-h-1/2 flex-col">
                        <div className="mb-1 flex shrink-0">
                          <button
                            type="button"
                            onClick={showPluginsList}
                            title="Show all plugins"
                            aria-label="Show all plugins"
                            aria-current={pluginsSectionActive ? "page" : undefined}
                            className={cn(
                              "group flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-[11px] font-semibold uppercase tracking-wider transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-neutral-400",
                              pluginsSectionActive
                                ? "bg-neutral-200/40 text-neutral-900 dark:bg-neutral-800/60 dark:text-neutral-100"
                                : "text-neutral-500 hover:bg-neutral-200/40 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100",
                            )}
                          >
                            <span className="flex-1">Plugins</span>
                            <ArrowRight
                              size={14}
                              className="shrink-0 text-neutral-400 group-hover:text-current dark:text-neutral-500"
                              aria-hidden="true"
                            />
                          </button>
                        </div>
                        <ul
                          ref={pluginListRef}
                          onScroll={updatePluginScrollHint}
                          className="ml-2 min-h-0 overflow-y-auto border-l border-neutral-200/80 pl-2 dark:border-neutral-800"
                        >
                          {sortedPlugins.length === 0 && (
                            <li className="px-2 py-2">
                              <p className="text-xs text-neutral-400 dark:text-neutral-600">
                                No plugins installed
                              </p>
                            </li>
                          )}
                          {sortedPlugins.map((plugin) => {
                            const active =
                              !showOverview &&
                              section === "plugins" &&
                              requestedPluginId === plugin.id;
                            const enabled = enabledPluginIds?.has(plugin.id) ?? false;
                            return (
                              <li key={plugin.id} className="group/row relative">
                                <button
                                  type="button"
                                  onClick={() => openPlugin(plugin.id)}
                                  aria-current={active ? "page" : undefined}
                                  className={cn(
                                    "flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-neutral-400 hover:bg-neutral-200/40 aria-[current=page]:bg-neutral-200/40 dark:hover:bg-neutral-800/50 dark:aria-[current=page]:bg-neutral-800/50",
                                    onTogglePlugin && "pr-8",
                                  )}
                                >
                                  {plugin.icon ? (
                                    <img
                                      src={plugin.icon}
                                      alt=""
                                      className="h-4 w-4 shrink-0 rounded object-contain"
                                    />
                                  ) : (
                                    <Puzzle
                                      size={14}
                                      className="shrink-0 text-neutral-400 dark:text-neutral-500"
                                    />
                                  )}
                                  <span className="min-w-0 flex-1">
                                    <span
                                      className={cn(
                                        "block truncate text-[13px] leading-5",
                                        active || enabled
                                          ? "font-medium text-neutral-900 dark:text-neutral-100"
                                          : "text-neutral-600 dark:text-neutral-300",
                                      )}
                                    >
                                      {plugin.title ?? plugin.id}
                                    </span>
                                  </span>
                                </button>
                                {onTogglePlugin && (
                                  <button
                                    type="button"
                                    role="checkbox"
                                    aria-checked={enabled}
                                    aria-label={`${enabled ? "Disable" : "Enable"} plugin ${plugin.title ?? plugin.id}`}
                                    onClick={() => onTogglePlugin(plugin.id)}
                                    className={cn(
                                      "absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md transition-opacity focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-neutral-400",
                                      !enabled &&
                                        "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100",
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        "flex h-4 w-4 items-center justify-center rounded-full border transition-colors",
                                        enabled
                                          ? "border-transparent bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900"
                                          : "border-neutral-300 text-transparent hover:border-neutral-400 dark:border-neutral-600 dark:hover:border-neutral-500",
                                      )}
                                    >
                                      <Check size={10} strokeWidth={3} aria-hidden="true" />
                                    </span>
                                  </button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                        {hasMorePluginsBelow && (
                          <div className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-center">
                            <button
                              type="button"
                              onClick={scrollPluginListToBottom}
                              title="Scroll to the end of plugins"
                              aria-label="Scroll to the end of plugins"
                              className="pointer-events-auto rounded-full border border-neutral-200 bg-white p-0.5 text-neutral-600 shadow-sm transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
                            >
                              <ChevronDown size={15} />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </nav>

                  {/* ── Main panel ── */}
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    {showOverview ? (
                      <div className="flex min-h-0 flex-1 flex-col">
                        <div className="min-h-0 flex-1 overflow-y-auto py-2">
                          <h3 className="px-5 py-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                            Skills
                          </h3>
                          {section === "skills" ? (
                            filteredSkills.length > 0 ? (
                              <ul>
                                {filteredSkills.map((skill) => (
                                  <li key={skill.id}>
                                    <button
                                      type="button"
                                      onClick={() => openSkill(skill.name)}
                                      className="flex w-full items-center gap-3 px-5 py-3 sm:py-2 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                                    >
                                      <Sparkles
                                        size={15}
                                        className="shrink-0 text-neutral-400 dark:text-neutral-500"
                                      />
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                                          {skill.name}
                                        </span>
                                        {skill.description && (
                                          <span className="block truncate text-xs text-neutral-400 dark:text-neutral-500">
                                            {skill.description}
                                          </span>
                                        )}
                                      </span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <div className="flex min-h-full items-center justify-center px-5">
                                {q ? (
                                  <p className="text-xs text-neutral-400 dark:text-neutral-500">
                                    No matching skills
                                  </p>
                                ) : (
                                  <div className="flex flex-col items-center gap-3 text-center">
                                    <Sparkles
                                      size={28}
                                      className="text-neutral-300 dark:text-neutral-600"
                                    />
                                    <div>
                                      <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                                        No skills yet
                                      </p>
                                      <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">
                                        Skills extend what your agents can do
                                      </p>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          ) : filteredPlugins.length > 0 ? (
                            <ul>
                              {filteredPlugins.map((plugin) => (
                                <li key={plugin.id}>
                                  <button
                                    type="button"
                                    onClick={() => openPlugin(plugin.id)}
                                    className="flex w-full items-center gap-3 px-5 py-3 sm:py-2 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                                  >
                                    {plugin.icon ? (
                                      <img
                                        src={plugin.icon}
                                        alt=""
                                        className="h-4 w-4 shrink-0 rounded object-contain"
                                      />
                                    ) : (
                                      <Puzzle
                                        size={15}
                                        className="shrink-0 text-neutral-400 dark:text-neutral-500"
                                      />
                                    )}
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                                        {plugin.title ?? plugin.id}
                                      </span>
                                      {plugin.description && (
                                        <span className="block truncate text-xs text-neutral-400 dark:text-neutral-500">
                                          {plugin.description}
                                        </span>
                                      )}
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 pt-4 text-center">
                              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                                {q ? "No matching plugins" : "No plugins installed"}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                    <div className={cn("flex min-h-0 flex-1 flex-col", showOverview && "hidden")}>
                      {section === "skills" ? (
                        <SkillCatalogPanel
                          onShowOverview={showSkillsList}
                          isOpen={isOpen}
                          onClose={onClose}
                          onToggle={onToggle}
                          enabledSkillNames={enabledSkillNames}
                          onSkillSaved={onSkillSaved}
                          onImported={onImported}
                          onDeleted={() => {
                            setSection("skills");
                            setRequestedSkillName(undefined);
                            setOverview(true);
                          }}
                          initialView={initialView}
                          initialSkillName={initialSkillName}
                          requestedSkillName={requestedSkillName}
                          search={search}
                          onViewKindChange={setSkillViewKind}
                          onActionsChange={setSkillActions}
                          onNavigateBackChange={(fn) => {
                            skillBackRef.current = fn;
                          }}
                          onConfirmDiscardChange={(fn) => {
                            confirmSkillDiscardRef.current = fn;
                          }}
                        />
                      ) : (
                        <PluginsManagerPanel
                          onShowOverview={showPluginsList}
                          isOpen={isOpen}
                          requestedPluginId={requestedPluginId}
                          search={search}
                          onViewKindChange={setPluginViewKind}
                          onNavigateBackChange={(fn) => {
                            pluginBackRef.current = fn;
                          }}
                          onDeleted={() => {
                            setSection("plugins");
                            setRequestedPluginId(undefined);
                            setOverview(true);
                          }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
