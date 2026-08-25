import { Dialog, Transition } from "@headlessui/react";
import { Download, Plus, Puzzle, Search, Sparkles, Upload, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { usePlugins } from "@/features/plugins/hooks/usePlugins";
import { getConfig } from "@/shared/config";
import { cn } from "@/shared/lib/cn";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";
import type { SkillCatalogActions, SkillCatalogPanelProps } from "./SkillCatalogPanel";
import { SkillCatalogPanel } from "./SkillCatalogPanel";
import { PluginsManagerPanel } from "./PluginsManagerPanel";

export type LibrarySection = "home" | "skills" | "plugins";

export interface LibraryDialogProps extends SkillCatalogPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialSection?: LibrarySection;
}

export function LibraryDialog({
  isOpen,
  onClose,
  initialSection = "home",
  onToggle,
  enabledSkillNames,
  onSkillSaved,
  onImported,
  initialView,
  initialSkillName,
}: LibraryDialogProps) {
  const { plugins } = usePlugins();
  const hubUrl = getConfig().plugins?.url;
  const showPlugins = plugins.length > 0 || Boolean(hubUrl);

  const [section, setSection] = useState<LibrarySection>(initialSection);
  const [skillSearch, setSkillSearch] = useState("");
  const [skillViewKind, setSkillViewKind] = useState<string>("list");
  const [pluginSearch, setPluginSearch] = useState("");
  const [pluginViewKind, setPluginViewKind] = useState<string>("list");
  const [skillActions, setSkillActions] = useState<SkillCatalogActions | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Sync section when the dialog opens with a new initialSection
  useEffect(() => {
    if (isOpen) setSection(initialSection);
  }, [isOpen, initialSection]);

  // Reset skill search and view when leaving the skills section or closing
  useEffect(() => {
    if (section !== "skills") {
      setSkillSearch("");
      setSkillViewKind("list");
    }
  }, [section]);

  // Reset plugin search and view when leaving the plugins section or closing
  useEffect(() => {
    if (section !== "plugins") {
      setPluginSearch("");
      setPluginViewKind("list");
    }
  }, [section]);

  useEffect(() => {
    if (!isOpen) {
      setSkillSearch("");
      setSkillViewKind("list");
      setPluginSearch("");
      setPluginViewKind("list");
    }
  }, [isOpen]);

  const pluginIsDrilledIn = pluginViewKind !== "list" && pluginViewKind !== "store";
  const skillIsDrilledIn = skillViewKind !== "list";
  const isHome = section === "home";

  const activeSearch = section === "skills" ? skillSearch : pluginSearch;
  const hasSearch = !isHome && activeSearch.length > 0;

  const handleClose = () => {
    if (hasSearch) {
      if (section === "skills") setSkillSearch("");
      else setPluginSearch("");
      searchInputRef.current?.focus();
    } else {
      onClose();
    }
  };

  const navItems: { id: LibrarySection; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "skills", label: "Skills", icon: <Sparkles size={15} /> },
    ...(showPlugins
      ? [
          {
            id: "plugins" as LibrarySection,
            label: "Plugins",
            icon: <Puzzle size={15} />,
            badge: plugins.length || undefined,
          },
        ]
      : []),
  ];

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-80" onClose={handleClose}>
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
                {/* ── Full-width top bar ── */}
                <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200/60 px-4 py-2 dark:border-neutral-800/60">
                  <div className="w-32 shrink-0 flex items-center gap-1">
                    <Dialog.Title className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      Catalog
                    </Dialog.Title>
                  </div>
                  <div className="flex flex-1 items-center justify-center">
                    {!isHome && (() => {
                      const isDrilledIn =
                        section === "skills" ? skillIsDrilledIn : pluginIsDrilledIn;
                      const value = section === "skills" ? skillSearch : pluginSearch;
                      const onChange = (v: string) => {
                        if (section === "skills") setSkillSearch(v);
                        else setPluginSearch(v);
                      };
                      const placeholder =
                        section === "skills" ? "Search skills…" : "Search plugins…";
                      return (
                        <div
                          className={cn(
                            "flex w-full max-w-xs sm:w-64 items-center gap-2 rounded-md border border-neutral-200/70 bg-neutral-50/50 px-2 py-1.5 focus-within:border-neutral-300 focus-within:ring-2 focus-within:ring-neutral-500/15 dark:border-neutral-700/50 dark:bg-neutral-800/30 dark:focus-within:border-neutral-600",
                            isDrilledIn && "invisible",
                          )}
                        >
                          <Search size={11} className="shrink-0 text-neutral-400" />
                          <input
                            ref={searchInputRef}
                            type="text"
                            value={value}
                            onChange={(e) => onChange(e.target.value)}
                            placeholder={placeholder}
                            tabIndex={isDrilledIn ? -1 : undefined}
                            className="flex-1 bg-transparent text-xs text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
                          />
                          {value && (
                            <button
                              type="button"
                              onClick={() => onChange("")}
                              className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                            >
                              <X size={10} />
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  <div className="flex w-32 items-center justify-end gap-1">
                    {section === "skills" && skillActions && (
                      <>
                        <DropdownMenu
                          anchor="bottom end"
                          trigger={
                            <MenuButton
                              title="Add skill"
                              className="shrink-0 rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                            >
                              <Plus size={15} />
                            </MenuButton>
                          }
                        >
                          <DropdownMenuItem icon={<Plus size={13} />} onClick={skillActions.onNew}>
                            New
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            icon={<Upload size={13} />}
                            onClick={skillActions.onImport}
                          >
                            Import
                          </DropdownMenuItem>
                        </DropdownMenu>
                        <button
                          type="button"
                          onClick={skillActions.onExportAll}
                          disabled={!skillActions.canExport}
                          title="Export all skills as a zip"
                          className="shrink-0 rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                        >
                          <Download size={15} />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={onClose}
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>

                {/* ── Body ── */}
                {isHome ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 sm:flex-row sm:gap-4 sm:p-8">
                    <button
                      type="button"
                      onClick={() => setSection("skills")}
                      className="group flex w-full max-w-sm flex-row items-center gap-4 rounded-xl border border-neutral-200/70 bg-neutral-50/60 p-4 text-left transition-colors hover:border-neutral-300 hover:bg-white sm:max-w-xs sm:flex-col sm:items-start sm:gap-3 sm:p-6 dark:border-neutral-700/50 dark:bg-neutral-800/40 dark:hover:border-neutral-600 dark:hover:bg-neutral-800/70"
                    >
                      <div className="flex shrink-0 h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400">
                        <Sparkles size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Skills</p>
                        <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                          Your personal collection of reusable instructions and workflows
                        </p>
                      </div>
                    </button>
                    {showPlugins && (
                      <button
                        type="button"
                        onClick={() => setSection("plugins")}
                        className="group flex w-full max-w-sm flex-row items-center gap-4 rounded-xl border border-neutral-200/70 bg-neutral-50/60 p-4 text-left transition-colors hover:border-neutral-300 hover:bg-white sm:max-w-xs sm:flex-col sm:items-start sm:gap-3 sm:p-6 dark:border-neutral-700/50 dark:bg-neutral-800/40 dark:hover:border-neutral-600 dark:hover:bg-neutral-800/70"
                      >
                        <div className="flex shrink-0 h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400">
                          <Puzzle size={18} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Plugins</p>
                          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                            Bundles of skills and MCP connectors, packaged to share and install across teams
                          </p>
                        </div>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
                    {/* ── Nav: tab bar on mobile, sidebar on desktop ── */}
                    <div className="flex shrink-0 flex-row border-b border-neutral-200/60 sm:w-40 sm:flex-col sm:border-b-0 sm:border-r dark:border-neutral-800/60">
                      <nav className="flex flex-1 flex-row justify-center gap-0 px-2 pt-1 sm:flex-none sm:flex-col sm:justify-start sm:gap-0.5 sm:p-2 sm:pt-2">
                        {navItems.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setSection(item.id)}
                            className={cn(
                              "flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors sm:w-full sm:rounded-md sm:gap-2.5 sm:text-left",
                              "border-b-2 sm:border-b-0",
                              section === item.id
                                ? "border-neutral-900 text-neutral-900 dark:border-neutral-100 dark:text-neutral-100 sm:border-0 sm:bg-neutral-100 sm:dark:bg-neutral-800"
                                : "border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 sm:hover:bg-neutral-50 sm:dark:hover:bg-neutral-800/40",
                            )}
                          >
                            <span className="shrink-0">{item.icon}</span>
                            <span className="sm:flex-1">{item.label}</span>
                          </button>
                        ))}
                      </nav>
                    </div>

                    {/* ── Main panel area ── */}
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                      {section === "skills" ? (
                        <SkillCatalogPanel
                          isOpen={isOpen}
                          onClose={onClose}
                          onToggle={onToggle}
                          enabledSkillNames={enabledSkillNames}
                          onSkillSaved={onSkillSaved}
                          onImported={onImported}
                          initialView={initialView}
                          initialSkillName={initialSkillName}
                          search={skillSearch}
                          onViewKindChange={setSkillViewKind}
                          onActionsChange={setSkillActions}
                        />
                      ) : (
                        <PluginsManagerPanel
                          isOpen={isOpen}
                          onClose={onClose}
                          search={pluginSearch}
                          onViewKindChange={setPluginViewKind}
                        />
                      )}
                    </div>
                  </div>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
