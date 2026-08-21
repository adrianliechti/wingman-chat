import { Dialog, Transition } from "@headlessui/react";
import { Puzzle, Search, Sparkles, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { usePlugins } from "@/features/plugins/hooks/usePlugins";
import { getConfig } from "@/shared/config";
import { cn } from "@/shared/lib/cn";
import type { SkillCatalogPanelProps } from "./SkillCatalogPanel";
import { SkillCatalogPanel } from "./SkillCatalogPanel";
import { PluginsManagerPanel } from "./PluginsManagerPanel";

export type LibrarySection = "skills" | "plugins";

export interface LibraryDialogProps extends SkillCatalogPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialSection?: LibrarySection;
}

export function LibraryDialog({
  isOpen,
  onClose,
  initialSection = "skills",
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
  const [pluginSearch, setPluginSearch] = useState("");
  const [pluginViewKind, setPluginViewKind] = useState<string>("list");
  const [pluginView, setPluginView] = useState<"list" | "store">("list");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Sync section when the dialog opens with a new initialSection
  useEffect(() => {
    if (isOpen) setSection(initialSection);
  }, [isOpen, initialSection]);

  // Reset plugin search and view when leaving the plugins section or closing
  useEffect(() => {
    if (section !== "plugins") {
      setPluginSearch("");
      setPluginViewKind("list");
    }
  }, [section]);

  useEffect(() => {
    if (!isOpen) {
      setPluginSearch("");
      setPluginViewKind("list");
      setPluginView("list");
    }
  }, [isOpen]);

  const pluginIsDrilledIn = pluginViewKind !== "list" && pluginViewKind !== "store";

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
              <Dialog.Panel className="relative flex h-[90dvh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-neutral-200/50 bg-white/95 shadow-xl backdrop-blur-xl sm:h-[75dvh] dark:border-neutral-700/50 dark:bg-neutral-900/95">
                {/* ── Full-width top bar ── */}
                <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200/60 px-4 py-2 dark:border-neutral-800/60">
                  <Dialog.Title className="w-32 shrink-0 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    Catalog
                  </Dialog.Title>
                  {section === "plugins" ? (
                    <>
                      <div className="flex flex-1 items-center justify-center">
                        <div className="flex w-64 items-center gap-2 rounded-md border border-neutral-200/70 bg-neutral-50/50 px-2 py-1.5 focus-within:border-neutral-300 focus-within:ring-2 focus-within:ring-neutral-500/15 dark:border-neutral-700/50 dark:bg-neutral-800/30 dark:focus-within:border-neutral-600">
                          <Search size={11} className="shrink-0 text-neutral-400" />
                          <input
                            ref={searchInputRef}
                            type="text"
                            value={pluginSearch}
                            onChange={(e) => {
                              setPluginSearch(e.target.value);
                              if (pluginIsDrilledIn) setPluginView("list");
                            }}
                            placeholder="Search plugins…"
                            className="flex-1 bg-transparent text-xs text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
                          />
                          {pluginSearch && (
                            <button
                              type="button"
                              onClick={() => setPluginSearch("")}
                              className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                            >
                              <X size={10} />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex w-32 items-center justify-end">
                        <button
                          type="button"
                          onClick={onClose}
                          className="ml-1 shrink-0 rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                        >
                          <X size={15} />
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex-1" />
                      <button
                        type="button"
                        onClick={onClose}
                        className="ml-1 shrink-0 rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                      >
                        <X size={15} />
                      </button>
                    </>
                  )}
                </div>

                {/* ── Body: left nav + main panel ── */}
                <div className="flex min-h-0 flex-1">
                  {/* ── Narrow left nav ── */}
                  <div className="flex w-40 shrink-0 flex-col border-r border-neutral-200/60 dark:border-neutral-800/60">
                    <nav className="flex flex-col gap-0.5 p-2">
                      {navItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setSection(item.id)}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors",
                            section === item.id
                              ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                              : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800/40 dark:hover:text-neutral-200",
                          )}
                        >
                          <span className="shrink-0">{item.icon}</span>
                          <span className="flex-1">{item.label}</span>
                          {item.badge !== undefined && item.badge > 0 && (
                            <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
                              {item.badge}
                            </span>
                          )}
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
                      />
                    ) : (
                      <PluginsManagerPanel
                        isOpen={isOpen}
                        onClose={onClose}
                        search={pluginSearch}
                        view={pluginView}
                        onViewChange={setPluginView}
                        onViewKindChange={setPluginViewKind}
                      />
                    )}
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
