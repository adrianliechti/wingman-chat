import { Dialog, Transition } from "@headlessui/react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Replace,
  ScrollText,
  Search,
  Server,
  Store,
  Trash2,
  X,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePlugins } from "@/features/plugins/hooks/usePlugins";
import { loadHubPlugins } from "@/features/plugins/lib/hub";
import type { HubPlugin, InstalledPlugin } from "@/features/plugins/lib/types";
import type { ParsedSkill } from "@/features/skills/lib/skillParser";
import { getConfig } from "@/shared/config";
import { cn } from "@/shared/lib/cn";
import { confirm } from "@/shared/lib/confirm";
import { notify } from "@/shared/lib/notify";
import { Markdown } from "@/shared/ui/Markdown";
import { SkillResourcesEditor } from "@/features/agent/components/SkillResourcesEditor";

interface PluginsManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

function matchesSearch(item: { id: string; title?: string; description?: string; keywords?: string[] }, q: string) {
  if (!q) return true;
  const haystack = [item.id, item.title, item.description, ...(item.keywords ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

/**
 * Standalone dialog for browsing a configured plugin hub's store and managing
 * already-installed plugins, laid out like the Skill Catalog: a tabbed
 * sidebar list on the left, and a detail/preview panel on the right.
 * Installing copies a plugin's skills into its own self-contained OPFS folder
 * — after that the hub is only consulted again to check for updates.
 */
export function PluginsManager({ isOpen, onClose }: PluginsManagerProps) {
  const { plugins, installPlugin, uninstallPlugin } = usePlugins();
  const hubUrl = getConfig().plugins?.url;

  const searchInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"installed" | "store">("installed");
  const [search, setSearch] = useState("");

  const [storePlugins, setStorePlugins] = useState<HubPlugin[]>([]);
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);

  const [selectedInstalled, setSelectedInstalled] = useState<InstalledPlugin | null>(null);
  const [selectedStorePlugin, setSelectedStorePlugin] = useState<HubPlugin | null>(null);
  /** Drill-down within the selected plugin's detail view. */
  const [selectedSkill, setSelectedSkill] = useState<ParsedSkill | null>(null);
  const [selectedStoreSkillName, setSelectedStoreSkillName] = useState<string | null>(null);

  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const installedIds = useMemo(() => new Set(plugins.map((p) => p.id)), [plugins]);

  const loadStore = useCallback(() => {
    if (!hubUrl) return;
    setStoreLoading(true);
    setStoreError(null);
    void loadHubPlugins(hubUrl)
      .then((loaded) => {
        setStorePlugins(loaded);
        if (loaded.length === 0) setStoreError("Hub returned no plugins");
      })
      .catch(() => setStoreError("Failed to reach hub"))
      .finally(() => setStoreLoading(false));
  }, [hubUrl]);

  useEffect(() => {
    if (isOpen && tab === "store" && storePlugins.length === 0 && !storeLoading) {
      loadStore();
    }
  }, [isOpen, tab, storePlugins.length, storeLoading, loadStore]);

  useEffect(() => {
    if (!isOpen) {
      setTab("installed");
      setSearch("");
      setSelectedInstalled(null);
      setSelectedStorePlugin(null);
      setSelectedSkill(null);
      setSelectedStoreSkillName(null);
      setInstallError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) searchInputRef.current?.focus();
  }, [isOpen]);

  const switchTab = useCallback((next: "installed" | "store") => {
    setTab(next);
    setSearch("");
    setSelectedInstalled(null);
    setSelectedStorePlugin(null);
    setSelectedSkill(null);
    setSelectedStoreSkillName(null);
  }, []);

  const filteredInstalled = useMemo(() => {
    const q = search.trim().toLowerCase();
    return plugins.filter((p) => matchesSearch(p, q));
  }, [plugins, search]);

  const filteredStore = useMemo(() => {
    const q = search.trim().toLowerCase();
    return storePlugins.filter((p) => matchesSearch(p, q));
  }, [storePlugins, search]);

  const handleInstall = async (plugin: HubPlugin) => {
    if (!hubUrl) return;
    setInstallingId(plugin.id);
    setInstallError(null);
    try {
      await installPlugin(hubUrl, plugin);
      notify.success(`Installed "${plugin.title || plugin.id}"`);
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : "Failed to install plugin");
    } finally {
      setInstallingId(null);
    }
  };

  const handleUninstall = async (plugin: InstalledPlugin) => {
    if (
      !(await confirm({
        title: "Uninstall plugin?",
        message: `"${plugin.title || plugin.id}" and all its bundled skills will be removed.`,
        danger: true,
      }))
    )
      return;
    await uninstallPlugin(plugin.id);
    setSelectedInstalled(null);
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
              <Dialog.Panel className="relative flex h-[90dvh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-neutral-200/50 bg-white/95 shadow-xl backdrop-blur-xl sm:h-[75dvh] dark:border-neutral-700/50 dark:bg-neutral-900/95">
                {/* ── Full-width top bar ── */}
                <div className="flex shrink-0 items-center justify-between border-b border-neutral-200/60 px-4 py-3 dark:border-neutral-800/60">
                  <Dialog.Title className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    Plugins
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
                  {/* ── Left panel: plugin list ── */}
                  <div
                    className={cn(
                      selectedInstalled || selectedStorePlugin ? "hidden sm:flex" : "flex",
                      "min-h-0 w-full flex-1 sm:flex-none sm:shrink-0 flex-col border-b border-neutral-200/60 sm:w-64 sm:border-b-0 sm:border-r dark:border-neutral-800/60",
                    )}
                  >
                    {/* Tabs: installed vs. store */}
                    <div className="flex shrink-0 items-center gap-1 border-b border-neutral-200/40 px-2 py-1.5 dark:border-neutral-800/40">
                      {(
                        [
                          { id: "installed" as const, label: "Installed" },
                          ...(hubUrl ? [{ id: "store" as const, label: "Store" }] : []),
                        ] as { id: "installed" | "store"; label: string }[]
                      ).map((t) => (
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
                          {t.id === "installed" && plugins.length > 0 && (
                            <span className="ml-1 text-[10px] text-neutral-400 dark:text-neutral-500">
                              {plugins.length}
                            </span>
                          )}
                          {t.id === "store" && storePlugins.length > 0 && (
                            <span className="ml-1 text-[10px] text-neutral-400 dark:text-neutral-500">
                              {storePlugins.length}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Search */}
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
                    </div>

                    {/* Plugin list */}
                    <div className="flex-1 overflow-y-auto py-1">
                      {tab === "installed" ? (
                        plugins.length === 0 ? (
                          <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
                            <Package size={28} className="text-neutral-300 dark:text-neutral-600" />
                            <div>
                              <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                                No plugins installed
                              </p>
                              {hubUrl && (
                                <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">
                                  Browse the Store tab to add one
                                </p>
                              )}
                            </div>
                          </div>
                        ) : filteredInstalled.length === 0 ? (
                          <p className="py-6 text-center text-xs text-neutral-400 dark:text-neutral-500">
                            No plugins match your search.
                          </p>
                        ) : (
                          filteredInstalled.map((plugin) => {
                            const isSelected = selectedInstalled?.id === plugin.id;
                            return (
                              <button
                                key={plugin.id}
                                type="button"
                                onClick={() => {
                                  setSelectedInstalled(plugin);
                                  setSelectedSkill(null);
                                }}
                                className={`group flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                                  isSelected
                                    ? "bg-neutral-100 dark:bg-neutral-800/70"
                                    : "hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <span className="block truncate text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                                    {plugin.title || plugin.id}
                                  </span>
                                  {plugin.description && (
                                    <span className="mt-0.5 block truncate text-[11px] leading-tight text-neutral-400 dark:text-neutral-500">
                                      {plugin.description}
                                    </span>
                                  )}
                                </div>
                              </button>
                            );
                          })
                        )
                      ) : storeLoading ? (
                        <div className="flex h-full items-center justify-center">
                          <Loader2 size={20} className="animate-spin text-neutral-300 dark:text-neutral-600" />
                        </div>
                      ) : storeError && storePlugins.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
                          <AlertTriangle size={28} className="text-neutral-300 dark:text-neutral-600" />
                          <div>
                            <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{storeError}</p>
                            <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">
                              Check that the hub is reachable
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={loadStore}
                            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300/50 px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100/50 dark:border-neutral-600/50 dark:text-neutral-400 dark:hover:bg-neutral-800/50"
                          >
                            <RefreshCw size={11} />
                            Retry
                          </button>
                        </div>
                      ) : storePlugins.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
                          <Store size={28} className="text-neutral-300 dark:text-neutral-600" />
                          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                            No plugins available
                          </p>
                        </div>
                      ) : filteredStore.length === 0 ? (
                        <p className="py-6 text-center text-xs text-neutral-400 dark:text-neutral-500">
                          No plugins match your search.
                        </p>
                      ) : (
                        filteredStore.map((plugin) => {
                          const isSelected = selectedStorePlugin?.id === plugin.id;
                          const added = installedIds.has(plugin.id);
                          return (
                            <button
                              key={plugin.id}
                              type="button"
                              onClick={() => {
                                setSelectedStorePlugin(plugin);
                                setSelectedStoreSkillName(null);
                              }}
                              className={`group flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                                isSelected
                                  ? "bg-neutral-100 dark:bg-neutral-800/70"
                                  : "hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                                  {plugin.title || plugin.id}
                                </span>
                                {plugin.description && (
                                  <span className="mt-0.5 block truncate text-[11px] leading-tight text-neutral-400 dark:text-neutral-500">
                                    {plugin.description}
                                  </span>
                                )}
                              </div>
                              {added && (
                                <span
                                  title="Already installed"
                                  className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-medium text-neutral-400 dark:text-neutral-500"
                                >
                                  <Check size={11} />
                                  Added
                                </span>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* ── Right panel ── */}
                  <div
                    className={cn(
                      !selectedInstalled && !selectedStorePlugin ? "hidden sm:flex" : "flex",
                      "min-h-0 min-w-0 flex-1 flex-col",
                    )}
                  >
                    {selectedSkill ? (
                      /* ── Skill detail (drilled into from an installed plugin) ── */
                      <>
                        <div className="flex items-center gap-2 border-b border-neutral-200/60 px-5 py-3.5 dark:border-neutral-800/60">
                          <button
                            type="button"
                            onClick={() => setSelectedSkill(null)}
                            className="-ml-1 shrink-0 rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 sm:hidden dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                          >
                            <ArrowLeft size={16} />
                          </button>
                          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
                            <button
                              type="button"
                              onClick={() => setSelectedSkill(null)}
                              className="shrink-0 truncate font-medium text-neutral-400 transition-colors hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-300"
                            >
                              {selectedInstalled?.title || selectedInstalled?.id}
                            </button>
                            <span className="shrink-0 text-neutral-300 dark:text-neutral-600">/</span>
                            <span className="min-w-0 truncate font-semibold text-neutral-900 dark:text-neutral-100">
                              {selectedSkill.name}
                            </span>
                          </div>
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
                    ) : selectedStoreSkillName ? (
                      /* ── Skill detail (not-yet-installed store plugin, name only) ── */
                      <>
                        <div className="flex items-center gap-2 border-b border-neutral-200/60 px-5 py-3.5 dark:border-neutral-800/60">
                          <button
                            type="button"
                            onClick={() => setSelectedStoreSkillName(null)}
                            className="-ml-1 shrink-0 rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 sm:hidden dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                          >
                            <ArrowLeft size={16} />
                          </button>
                          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
                            <button
                              type="button"
                              onClick={() => setSelectedStoreSkillName(null)}
                              className="shrink-0 truncate font-medium text-neutral-400 transition-colors hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-300"
                            >
                              {selectedStorePlugin?.title || selectedStorePlugin?.id}
                            </button>
                            <span className="shrink-0 text-neutral-300 dark:text-neutral-600">/</span>
                            <span className="min-w-0 truncate font-semibold text-neutral-900 dark:text-neutral-100">
                              {selectedStoreSkillName}
                            </span>
                          </div>
                        </div>
                        <div className="flex-1 overflow-y-auto px-5 py-4">
                          <p className="text-sm text-neutral-500 dark:text-neutral-400">
                            Install the plugin to read this skill's full instructions.
                          </p>
                        </div>
                      </>
                    ) : selectedInstalled ? (
                      /* ── Installed plugin detail ── */
                      <>
                        <div className="flex items-center gap-2 border-b border-neutral-200/60 px-5 py-3.5 dark:border-neutral-800/60">
                          <button
                            type="button"
                            onClick={() => setSelectedInstalled(null)}
                            className="-ml-1 shrink-0 rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 sm:hidden dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                          >
                            <ArrowLeft size={16} />
                          </button>
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                              {selectedInstalled.title || selectedInstalled.id}
                            </span>
                            {selectedInstalled.version && (
                              <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                                v{selectedInstalled.version}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleUninstall(selectedInstalled)}
                            title="Uninstall"
                            className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>

                        <div className="flex-1 overflow-y-auto px-5 py-4">
                          {selectedInstalled.description && (
                            <div className="mb-4">
                              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                                Description
                              </p>
                              <p className="text-sm text-neutral-700 dark:text-neutral-300">
                                {selectedInstalled.description}
                              </p>
                            </div>
                          )}
                          {selectedInstalled.skills.length > 0 && (
                            <div className="mb-4">
                              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                                Skills
                              </p>
                              <ul className="divide-y divide-neutral-200/40 dark:divide-neutral-800/40">
                                {selectedInstalled.skills.map((skill) => (
                                  <li key={skill.name}>
                                    <button
                                      type="button"
                                      onClick={() => setSelectedSkill(skill)}
                                      className="group flex w-full items-center gap-2 py-1.5 text-left transition-colors hover:text-neutral-950 dark:hover:text-neutral-50"
                                    >
                                      <ScrollText
                                        size={13}
                                        className="shrink-0 text-neutral-400 dark:text-neutral-500"
                                      />
                                      <div className="min-w-0 flex-1">
                                        <span className="block text-sm font-medium text-neutral-800 dark:text-neutral-200">
                                          {skill.name}
                                        </span>
                                        {skill.description && (
                                          <span className="block truncate text-xs text-neutral-400 dark:text-neutral-500">
                                            {skill.description}
                                          </span>
                                        )}
                                      </div>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {selectedInstalled.mcpServers && selectedInstalled.mcpServers.length > 0 && (
                            <div className="mb-4">
                              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                                MCP servers (informational only, not installed)
                              </p>
                              <ul className="divide-y divide-neutral-200/40 dark:divide-neutral-800/40">
                                {selectedInstalled.mcpServers.map((s) => (
                                  <li key={s.name} className="flex items-center gap-2 py-1.5">
                                    <Server size={13} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
                                    <div className="min-w-0 flex-1">
                                      <span className="block text-sm font-medium text-neutral-800 dark:text-neutral-200">
                                        {s.name}
                                      </span>
                                      <span className="block text-xs text-neutral-400 dark:text-neutral-500">
                                        {s.type}
                                      </span>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <div>
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                              Source
                            </p>
                            <p className="break-all text-xs text-neutral-400 dark:text-neutral-500">
                              {selectedInstalled.hubUrl}
                            </p>
                          </div>
                        </div>
                      </>
                    ) : selectedStorePlugin ? (
                      /* ── Store plugin preview ── */
                      <>
                        <div className="flex items-center gap-2 border-b border-neutral-200/60 px-5 py-3.5 dark:border-neutral-800/60">
                          <button
                            type="button"
                            onClick={() => setSelectedStorePlugin(null)}
                            className="-ml-1 shrink-0 rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 sm:hidden dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                          >
                            <ArrowLeft size={16} />
                          </button>
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                              {selectedStorePlugin.title || selectedStorePlugin.id}
                            </span>
                            {selectedStorePlugin.version && (
                              <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                                v{selectedStorePlugin.version}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleInstall(selectedStorePlugin)}
                            disabled={installingId === selectedStorePlugin.id}
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-200 dark:text-neutral-900"
                          >
                            {installingId === selectedStorePlugin.id ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : installedIds.has(selectedStorePlugin.id) ? (
                              <Replace size={13} />
                            ) : (
                              <Plus size={13} />
                            )}
                            {installingId === selectedStorePlugin.id
                              ? "Installing…"
                              : installedIds.has(selectedStorePlugin.id)
                                ? "Reinstall"
                                : "Install"}
                          </button>
                        </div>

                        <div className="flex-1 overflow-y-auto px-5 py-4">
                          {selectedStorePlugin.description && (
                            <div className="mb-4">
                              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                                Description
                              </p>
                              <p className="text-sm text-neutral-700 dark:text-neutral-300">
                                {selectedStorePlugin.description}
                              </p>
                            </div>
                          )}
                          {installedIds.has(selectedStorePlugin.id) && (
                            <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
                              Already installed. Reinstalling overwrites your local copy of its skills.
                            </p>
                          )}
                          {selectedStorePlugin.skills && selectedStorePlugin.skills.length > 0 && (
                            <div className="mb-4">
                              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                                Skills
                              </p>
                              <ul className="divide-y divide-neutral-200/40 dark:divide-neutral-800/40">
                                {selectedStorePlugin.skills.map((name) => (
                                  <li key={name}>
                                    <button
                                      type="button"
                                      onClick={() => setSelectedStoreSkillName(name)}
                                      className="flex w-full items-center gap-2 py-1.5 text-left text-sm text-neutral-700 transition-colors hover:text-neutral-950 dark:text-neutral-300 dark:hover:text-neutral-50"
                                    >
                                      <ScrollText
                                        size={13}
                                        className="shrink-0 text-neutral-400 dark:text-neutral-500"
                                      />
                                      {name}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {selectedStorePlugin.mcp_servers && selectedStorePlugin.mcp_servers.length > 0 && (
                            <div className="mb-4">
                              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                                MCP servers (informational only, not installed)
                              </p>
                              <ul className="divide-y divide-neutral-200/40 dark:divide-neutral-800/40">
                                {selectedStorePlugin.mcp_servers.map((s) => (
                                  <li key={s.name} className="flex items-center gap-2 py-1.5">
                                    <Server size={13} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
                                    <div className="min-w-0 flex-1">
                                      <span className="block text-sm font-medium text-neutral-800 dark:text-neutral-200">
                                        {s.name}
                                      </span>
                                      <span className="block text-xs text-neutral-400 dark:text-neutral-500">
                                        {s.type}
                                      </span>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {selectedStorePlugin.keywords && selectedStorePlugin.keywords.length > 0 && (
                            <div className="mb-4">
                              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                                Keywords
                              </p>
                              <p className="text-sm text-neutral-700 dark:text-neutral-300">
                                {selectedStorePlugin.keywords.join(", ")}
                              </p>
                            </div>
                          )}
                          <div>
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                              Source
                            </p>
                            <p className="break-all text-xs text-neutral-400 dark:text-neutral-500">
                              {selectedStorePlugin.source}
                            </p>
                          </div>
                          {installError && <p className="mt-4 text-xs text-red-500">{installError}</p>}
                        </div>
                      </>
                    ) : (
                      /* ── Empty right panel ── */
                      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                        <Package size={32} className="text-neutral-200 dark:text-neutral-700" />
                        <div>
                          <p className="text-sm font-medium text-neutral-400 dark:text-neutral-500">
                            Select a plugin to view
                          </p>
                          {hubUrl && (
                            <p className="mt-0.5 text-xs text-neutral-300 dark:text-neutral-600">
                              Or browse the store to install one
                            </p>
                          )}
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
