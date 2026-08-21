import { Dialog, Transition } from "@headlessui/react";
import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  MoreVertical,
  Package,
  Plus,
  RefreshCw,
  Replace,
  ScrollText,
  Search,
  Server,
  Trash2,
  X,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePlugins } from "@/features/plugins/hooks/usePlugins";
import { loadHubPluginDetail, loadHubPlugins } from "@/features/plugins/lib/hub";
import type { HubPlugin, HubPluginDetail, InstalledPlugin } from "@/features/plugins/lib/types";
import type { ParsedSkill } from "@/features/skills/lib/skillParser";
import { getConfig } from "@/shared/config";
import { cn } from "@/shared/lib/cn";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";
import { confirm } from "@/shared/lib/confirm";
import { notify } from "@/shared/lib/notify";
import { Markdown } from "@/shared/ui/Markdown";
import { SkillResourcesEditor } from "@/features/agent/components/SkillResourcesEditor";

interface PluginsManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

function matchesSearch(
  item: { id: string; title?: string; description?: string; keywords?: string[] },
  q: string,
) {
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
  const [search, setSearch] = useState("");

  const [storePlugins, setStorePlugins] = useState<HubPlugin[]>([]);
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);

  const [selectedInstalled, setSelectedInstalled] = useState<InstalledPlugin | null>(null);
  const [selectedStorePlugin, setSelectedStorePlugin] = useState<HubPlugin | null>(null);
  /** Drill-down within the selected plugin's detail view. */
  const [selectedSkill, setSelectedSkill] = useState<ParsedSkill | null>(null);

  const [storeDetail, setStoreDetail] = useState<HubPluginDetail | null>(null);
  const [storeDetailLoading, setStoreDetailLoading] = useState(false);

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
    if (isOpen && hubUrl) loadStore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!hubUrl || !selectedStorePlugin) {
      setStoreDetail(null);
      return;
    }
    setStoreDetail(null);
    setStoreDetailLoading(true);
    let cancelled = false;
    void loadHubPluginDetail(hubUrl, selectedStorePlugin.id)
      .then((detail) => {
        if (!cancelled) setStoreDetail(detail);
      })
      .catch(() => {
        if (!cancelled) setStoreDetail(null);
      })
      .finally(() => {
        if (!cancelled) setStoreDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hubUrl, selectedStorePlugin]);

  useEffect(() => {
    if (!isOpen) {
      setSearch("");
      setSelectedInstalled(null);
      setSelectedStorePlugin(null);
      setSelectedSkill(null);
      setInstallError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) searchInputRef.current?.focus();
  }, [isOpen]);

  const filteredList = useMemo(() => {
    const q = search.trim().toLowerCase();
    const installedMatches = plugins.filter((p) => matchesSearch(p, q));
    const storeOnly = storePlugins
      .filter((p) => !installedIds.has(p.id))
      .filter((p) => matchesSearch(p, q));
    return { installedMatches, storeOnly };
  }, [plugins, storePlugins, installedIds, search]);

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
                      {storeLoading && filteredList.installedMatches.length === 0 ? (
                        <div className="flex h-full items-center justify-center">
                          <Loader2
                            size={20}
                            className="animate-spin text-neutral-300 dark:text-neutral-600"
                          />
                        </div>
                      ) : storeError && plugins.length === 0 && storePlugins.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
                          <AlertTriangle
                            size={28}
                            className="text-neutral-300 dark:text-neutral-600"
                          />
                          <div>
                            <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                              {storeError}
                            </p>
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
                      ) : filteredList.installedMatches.length === 0 &&
                        filteredList.storeOnly.length === 0 ? (
                        search ? (
                          <p className="py-6 text-center text-xs text-neutral-400 dark:text-neutral-500">
                            No plugins match your search.
                          </p>
                        ) : (
                          <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
                            <Package size={28} className="text-neutral-300 dark:text-neutral-600" />
                            <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                              No plugins available
                            </p>
                          </div>
                        )
                      ) : (
                        <>
                          {filteredList.installedMatches.length > 0 && (
                            <p className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                              Installed
                            </p>
                          )}
                          {filteredList.installedMatches.map((plugin) => {
                            const isSelected = selectedInstalled?.id === plugin.id;
                            return (
                              <div
                                key={plugin.id}
                                className={`group flex w-full items-center gap-2 pl-3 pr-1 py-2 transition-colors ${
                                  isSelected
                                    ? "bg-neutral-100 dark:bg-neutral-800/70"
                                    : "hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedInstalled(plugin);
                                    setSelectedSkill(null);
                                  }}
                                  className="min-w-0 flex-1 text-left"
                                >
                                  <span className="block truncate text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                                    {plugin.title || plugin.id}
                                  </span>
                                  {plugin.description && (
                                    <span className="mt-0.5 block truncate text-[11px] leading-tight text-neutral-400 dark:text-neutral-500">
                                      {plugin.description}
                                    </span>
                                  )}
                                </button>
                                <DropdownMenu
                                  anchor="bottom end"
                                  trigger={
                                    <MenuButton className="shrink-0 rounded p-1 text-neutral-300 transition-colors hover:bg-neutral-200/60 hover:text-neutral-600 dark:text-neutral-600 dark:hover:bg-neutral-700/60 dark:hover:text-neutral-300">
                                      <MoreVertical size={13} />
                                    </MenuButton>
                                  }
                                >
                                  <DropdownMenuItem
                                    icon={<Trash2 size={13} />}
                                    destructive
                                    onClick={() => void handleUninstall(plugin)}
                                  >
                                    Remove
                                  </DropdownMenuItem>
                                </DropdownMenu>
                              </div>
                            );
                          })}
                          {filteredList.installedMatches.length > 0 &&
                            filteredList.storeOnly.length > 0 && (
                              <p className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                                Available
                              </p>
                            )}
                          {filteredList.storeOnly.map((plugin) => {
                            const isSelected = selectedStorePlugin?.id === plugin.id;
                            return (
                              <button
                                key={plugin.id}
                                type="button"
                                onClick={() => setSelectedStorePlugin(plugin)}
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
                          })}
                        </>
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
                        <div className="flex items-center gap-2 border-b border-neutral-200/60 px-4 py-3 dark:border-neutral-800/60">
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
                            <span className="shrink-0 text-neutral-300 dark:text-neutral-600">
                              /
                            </span>
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
                    ) : selectedInstalled ? (
                      /* ── Installed plugin detail ── */
                      <>
                        <div className="flex items-center gap-2 px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setSelectedInstalled(null)}
                            className="-ml-1 shrink-0 self-start rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 sm:hidden dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                          >
                            <ArrowLeft size={16} />
                          </button>
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                              {selectedInstalled.title || selectedInstalled.id}
                            </span>
                            {selectedInstalled.description && (
                              <p className="mt-0.5 text-xs leading-snug text-neutral-500 dark:text-neutral-400">
                                {selectedInstalled.description}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleUninstall(selectedInstalled)}
                            title="Uninstall"
                            className="self-start rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>

                        <div className="flex-1 overflow-y-auto px-5 py-4">
                          <div className="space-y-6">
                            {selectedInstalled.skills.length > 0 && (
                              <div>
                                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                                  Skills
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {selectedInstalled.skills.map((skill) => (
                                    <button
                                      key={skill.name}
                                      type="button"
                                      onClick={() => setSelectedSkill(skill)}
                                      className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-medium text-neutral-700 transition-colors hover:border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:border-neutral-600 dark:hover:bg-neutral-700"
                                    >
                                      <ScrollText
                                        size={11}
                                        className="shrink-0 text-neutral-400 dark:text-neutral-500"
                                      />
                                      {skill.name}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                            {selectedInstalled.mcpServers &&
                              selectedInstalled.mcpServers.length > 0 && (
                                <div>
                                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                                    MCP Servers
                                  </p>
                                  <div className="space-y-2">
                                    {selectedInstalled.mcpServers.map((server) => (
                                      <div
                                        key={server.name}
                                        className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 dark:border-neutral-700 dark:bg-neutral-800/50"
                                      >
                                        <Server
                                          size={13}
                                          className="shrink-0 text-neutral-400 dark:text-neutral-500"
                                        />
                                        <div className="min-w-0 flex-1">
                                          <span className="block text-sm font-medium text-neutral-800 dark:text-neutral-200">
                                            {server.name}
                                          </span>
                                          {(server.url || server.command) && (
                                            <p className="truncate text-xs text-neutral-400 dark:text-neutral-500">
                                              {server.url || server.command}
                                            </p>
                                          )}
                                        </div>
                                        <span className="ml-auto shrink-0 rounded-full bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium uppercase text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400">
                                          {server.type}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            <div>
                              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                                Information
                              </p>
                              <table className="w-full text-sm">
                                <tbody className="divide-y divide-neutral-200/60 dark:divide-neutral-800/60">
                                  {selectedInstalled.version && (
                                    <tr>
                                      <td className="py-2 pr-4 text-neutral-400 dark:text-neutral-500">
                                        Version
                                      </td>
                                      <td className="py-2 text-neutral-700 dark:text-neutral-300">
                                        {selectedInstalled.version}
                                      </td>
                                    </tr>
                                  )}
                                  <tr>
                                    <td className="py-2 pr-4 text-neutral-400 dark:text-neutral-500">
                                      Source
                                    </td>
                                    <td className="py-2 break-all text-neutral-700 dark:text-neutral-300">
                                      {selectedInstalled.hubUrl}
                                    </td>
                                  </tr>
                                  <tr>
                                    <td className="py-2 pr-4 text-neutral-400 dark:text-neutral-500">
                                      Installed
                                    </td>
                                    <td className="py-2 text-neutral-700 dark:text-neutral-300">
                                      {new Date(selectedInstalled.installedAt).toLocaleDateString()}
                                    </td>
                                  </tr>
                                  {selectedInstalled.keywords &&
                                    selectedInstalled.keywords.length > 0 && (
                                      <tr>
                                        <td className="py-2 pr-4 text-neutral-400 dark:text-neutral-500">
                                          Keywords
                                        </td>
                                        <td className="py-2 text-neutral-700 dark:text-neutral-300">
                                          {selectedInstalled.keywords.join(", ")}
                                        </td>
                                      </tr>
                                    )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      </>
                    ) : selectedStorePlugin ? (
                      /* ── Store plugin preview ── */
                      <>
                        <div className="flex items-start gap-2 px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setSelectedStorePlugin(null)}
                            className="-ml-1 shrink-0 rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 sm:hidden dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                          >
                            <ArrowLeft size={16} />
                          </button>
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                              {selectedStorePlugin.title || selectedStorePlugin.id}
                            </span>
                            {selectedStorePlugin.description && (
                              <p className="mt-0.5 text-xs leading-snug text-neutral-500 dark:text-neutral-400">
                                {selectedStorePlugin.description}
                              </p>
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
                          <div className="space-y-6">
                            {storeDetailLoading ? (
                              <div className="flex items-center gap-2 text-xs text-neutral-400 dark:text-neutral-500">
                                <Loader2 size={13} className="animate-spin" />
                                Loading skills and MCP servers…
                              </div>
                            ) : (
                              <>
                                {storeDetail && storeDetail.skills.length > 0 && (
                                  <div>
                                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                                      Skills
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                      {storeDetail.skills.map((skill) => (
                                        <span
                                          key={skill.name}
                                          title={skill.description}
                                          className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                                        >
                                          <ScrollText
                                            size={11}
                                            className="shrink-0 text-neutral-400 dark:text-neutral-500"
                                          />
                                          {skill.name}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {storeDetail && storeDetail.mcpServers.length > 0 && (
                                  <div>
                                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                                      MCP Servers
                                    </p>
                                    <div className="space-y-2">
                                      {storeDetail.mcpServers.map((server) => (
                                        <div
                                          key={server.name}
                                          className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 dark:border-neutral-700 dark:bg-neutral-800/50"
                                        >
                                          <Server
                                            size={13}
                                            className="shrink-0 text-neutral-400 dark:text-neutral-500"
                                          />
                                          <div className="min-w-0 flex-1">
                                            <span className="block text-sm font-medium text-neutral-800 dark:text-neutral-200">
                                              {server.name}
                                            </span>
                                            {(server.url || server.command) && (
                                              <p className="truncate text-xs text-neutral-400 dark:text-neutral-500">
                                                {server.url || server.command}
                                              </p>
                                            )}
                                          </div>
                                          <span className="ml-auto shrink-0 rounded-full bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium uppercase text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400">
                                            {server.type}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                            <div>
                              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                                Information
                              </p>
                              <table className="w-full text-sm">
                                <tbody className="divide-y divide-neutral-200/60 dark:divide-neutral-800/60">
                                  {selectedStorePlugin.version && (
                                    <tr>
                                      <td className="py-2 pr-4 text-neutral-400 dark:text-neutral-500">
                                        Version
                                      </td>
                                      <td className="py-2 text-neutral-700 dark:text-neutral-300">
                                        {selectedStorePlugin.version}
                                      </td>
                                    </tr>
                                  )}
                                  {selectedStorePlugin.keywords &&
                                    selectedStorePlugin.keywords.length > 0 && (
                                      <tr>
                                        <td className="py-2 pr-4 text-neutral-400 dark:text-neutral-500">
                                          Keywords
                                        </td>
                                        <td className="py-2 text-neutral-700 dark:text-neutral-300">
                                          {selectedStorePlugin.keywords.join(", ")}
                                        </td>
                                      </tr>
                                    )}
                                  <tr>
                                    <td className="py-2 pr-4 text-neutral-400 dark:text-neutral-500">
                                      Source
                                    </td>
                                    <td className="py-2 break-all text-neutral-700 dark:text-neutral-300">
                                      {selectedStorePlugin.source}
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </div>
                          {installError && (
                            <p className="mt-4 text-xs text-red-500">{installError}</p>
                          )}
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
