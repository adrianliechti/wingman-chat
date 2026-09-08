import { Loader2, Plus, Puzzle, RefreshCw, Server, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { usePlugins } from "@/features/plugins/hooks/usePlugins";
import { loadHubPlugins } from "@/features/plugins/lib/hub";
import type { HubPlugin, InstalledPlugin } from "@/features/plugins/lib/types";
import type { ParsedSkill } from "@/features/skills/lib/skillParser";
import { getConfig } from "@/shared/config";
import { confirm } from "@/shared/lib/confirm";
import { notify } from "@/shared/lib/notify";
import { Markdown } from "@/shared/ui/Markdown";
import { SkillResourcesEditor } from "@/features/agent/components/SkillResourcesEditor";

import { CatalogBreadcrumb } from "./CatalogBreadcrumb";

export interface PluginsManagerPanelProps {
  onShowOverview: () => void;
  isOpen: boolean;
  /** When set, navigates to this installed plugin's detail view. */
  requestedPluginId?: string;
  /** Search query managed by the Library dialog. */
  search?: string;
  onViewKindChange?: (kind: "list" | "installed-detail" | "installed-skill" | "store-detail") => void;
  onNavigateBackChange?: (fn: ((destination?: "parent" | "overview") => void) | null) => void;
  /** Called after an installed plugin has been deleted. */
  onDeleted?: () => void;
}

type View =
  | { kind: "list" }
  | { kind: "installed-detail"; plugin: InstalledPlugin }
  | { kind: "installed-skill"; plugin: InstalledPlugin; skill: ParsedSkill }
  | { kind: "store-detail"; plugin: HubPlugin };

export function PluginsManagerPanel({
  onShowOverview,
  isOpen,
  requestedPluginId,
  search = "",
  onViewKindChange,
  onNavigateBackChange,
  onDeleted,
}: PluginsManagerPanelProps) {
  const { plugins, installPlugin, uninstallPlugin } = usePlugins();
  const { agents, updateAgent } = useAgents();
  const hubUrl = getConfig().plugins?.url;

  const [view, setInternalView] = useState<View>({ kind: "list" });

  const setView = useCallback(
    (v: View) => {
      setInternalView(v);
      onViewKindChange?.(v.kind);
    },
    [onViewKindChange],
  );

  const [storePlugins, setStorePlugins] = useState<HubPlugin[]>([]);
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);

  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const installedIds = useMemo(() => new Set(plugins.map((p) => p.id)), [plugins]);
  const installedPluginsById = useMemo(() => new Map(plugins.map((plugin) => [plugin.id, plugin])), [plugins]);
  const availableStorePlugins = useMemo(
    () =>
      storePlugins.filter((plugin) => {
        const installed = installedPluginsById.get(plugin.id);
        return !installed || (Boolean(plugin.version) && installed.version !== plugin.version);
      }),
    [storePlugins, installedPluginsById],
  );
  const filteredStorePlugins = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return availableStorePlugins;
    return availableStorePlugins.filter((plugin) => {
      const title = plugin.title || plugin.id;
      return (
        title.toLowerCase().includes(query) ||
        (plugin.description ?? "").toLowerCase().includes(query) ||
        plugin.id.toLowerCase().includes(query)
      );
    });
  }, [availableStorePlugins, search]);
  const filteredInstalledPlugins = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return plugins;
    return plugins.filter((plugin) => {
      const title = plugin.title || plugin.id;
      return (
        title.toLowerCase().includes(query) ||
        (plugin.description ?? "").toLowerCase().includes(query) ||
        plugin.id.toLowerCase().includes(query)
      );
    });
  }, [plugins, search]);

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
    if (hubUrl) loadStore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setInternalView({ kind: "list" });
      setInstallError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!requestedPluginId || !isOpen) return;
    const target = plugins.find((p) => p.id === requestedPluginId);
    if (target) setView({ kind: "installed-detail", plugin: target });
    // plugins intentionally omitted — resolves at the moment the request changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedPluginId, isOpen]);

  useEffect(() => {
    if (!onNavigateBackChange) return;
    if (view.kind === "installed-skill") {
      const { plugin } = view;
      onNavigateBackChange((destination) =>
        setView(destination === "overview" ? { kind: "list" } : { kind: "installed-detail", plugin }),
      );
    } else if (view.kind === "installed-detail") {
      onNavigateBackChange(() => setView({ kind: "list" }));
    } else if (view.kind === "store-detail") {
      onNavigateBackChange(() => setView({ kind: "list" }));
    } else {
      onNavigateBackChange(null);
    }
  }, [view, onNavigateBackChange, setView]);

  useEffect(() => {
    return () => onNavigateBackChange?.(null);
  }, [onNavigateBackChange]);

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

  const handleUpdate = async (plugin: InstalledPlugin) => {
    if (!hubUrl) return;
    const hubPlugin = storePlugins.find((p) => p.id === plugin.id);
    if (!hubPlugin) return;
    setInstallingId(plugin.id);
    setInstallError(null);
    try {
      const updated = await installPlugin(hubUrl, hubPlugin);
      notify.success(`Updated "${plugin.title || plugin.id}"`);
      setView({ kind: "installed-detail", plugin: updated });
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : "Failed to update plugin");
    } finally {
      setInstallingId(null);
    }
  };

  const handleUninstall = async (plugin: InstalledPlugin) => {
    const serverCount = plugin.mcpServers?.length ?? 0;
    const removed = [
      plugin.skills.length > 0 && `${plugin.skills.length} bundled skill${plugin.skills.length === 1 ? "" : "s"}`,
      serverCount > 0 && `${serverCount} MCP server${serverCount === 1 ? "" : "s"}`,
    ].filter((part): part is string => Boolean(part));
    if (
      !(await confirm({
        title: "Uninstall plugin?",
        message: removed.length
          ? `"${plugin.title || plugin.id}" and its ${removed.join(" and ")} will be removed.`
          : `"${plugin.title || plugin.id}" will be removed.`,
        danger: true,
      }))
    )
      return;
    await uninstallPlugin(plugin.id);
    // Agents keep plugin ids by reference; drop the dangling ones.
    for (const agent of agents) {
      if (agent.plugins?.includes(plugin.id)) {
        updateAgent(agent.id, { plugins: agent.plugins.filter((id) => id !== plugin.id) });
      }
    }
    setView({ kind: "list" });
    onDeleted?.();
  };

  // ── Plugin list ─────────────────────────────────────────────────────────
  if (view.kind === "list") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          <h3 className="px-5 py-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            Installed Plugins
          </h3>
          {filteredInstalledPlugins.length > 0 ? (
            <ul>
              {filteredInstalledPlugins.map((plugin) => (
                <li key={plugin.id}>
                  <button
                    type="button"
                    onClick={() => setView({ kind: "installed-detail", plugin })}
                    className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-neutral-50 sm:py-2 dark:hover:bg-neutral-800/40"
                  >
                    {plugin.icon ? (
                      <img src={plugin.icon} alt="" className="h-4 w-4 shrink-0 rounded object-contain" />
                    ) : (
                      <Puzzle size={15} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                        {plugin.title || plugin.id}
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
            <p className="px-5 py-2 text-xs text-neutral-400 dark:text-neutral-500">
              {search.trim() ? "No matching installed plugins" : "No plugins installed"}
            </p>
          )}

          {hubUrl && (
            <section className="mt-3 border-t border-neutral-200/60 pt-2 dark:border-neutral-800/60">
              <h3 className="px-5 py-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                Available Plugins
              </h3>
              {storeLoading && storePlugins.length === 0 ? (
                <div className="flex justify-center py-5">
                  <Loader2 size={18} className="animate-spin text-neutral-300 dark:text-neutral-600" />
                </div>
              ) : storeError && storePlugins.length === 0 ? (
                <div className="flex items-center gap-3 px-5 py-3">
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">{storeError}</p>
                  <button
                    type="button"
                    onClick={loadStore}
                    className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300/50 px-2 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100/50 dark:border-neutral-600/50 dark:text-neutral-400 dark:hover:bg-neutral-800/50"
                  >
                    <RefreshCw size={11} />
                    Retry
                  </button>
                </div>
              ) : filteredStorePlugins.length === 0 ? (
                <p className="px-5 py-2 text-xs text-neutral-400 dark:text-neutral-500">
                  {search.trim() ? "No matching available plugins" : "No new plugins available"}
                </p>
              ) : (
                <ul>
                  {filteredStorePlugins.map((plugin) => {
                    const installed = installedPluginsById.get(plugin.id);
                    const updateAvailable = Boolean(
                      installed && plugin.version && installed.version !== plugin.version,
                    );
                    return (
                      <li key={plugin.id} className="relative">
                        <button
                          type="button"
                          onClick={() => setView({ kind: "store-detail", plugin })}
                          className="flex w-full items-center gap-3 px-5 py-3 pr-12 text-left transition-colors hover:bg-neutral-50 sm:py-2 dark:hover:bg-neutral-800/40"
                        >
                          {plugin.icon ? (
                            <img src={plugin.icon} alt="" className="h-4 w-4 shrink-0 rounded object-contain" />
                          ) : (
                            <Puzzle size={15} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="block truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                                {plugin.title || plugin.id}
                              </span>
                              {updateAvailable && (
                                <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
                                  Update available
                                </span>
                              )}
                            </span>
                            {plugin.description && (
                              <span className="block truncate text-xs text-neutral-400 dark:text-neutral-500">
                                {plugin.description}
                              </span>
                            )}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleInstall(plugin)}
                          disabled={installingId === plugin.id}
                          title={`${updateAvailable ? "Update" : "Install"} ${plugin.title || plugin.id}`}
                          aria-label={`${updateAvailable ? "Update" : "Install"} ${plugin.title || plugin.id}`}
                          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                        >
                          {installingId === plugin.id ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : updateAvailable ? (
                            <RefreshCw size={15} />
                          ) : (
                            <Plus size={15} />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
    );
  }

  // ── Installed plugin detail ─────────────────────────────────────────────────
  if (view.kind === "installed-detail") {
    const plugin = view.plugin;
    const hubVersion = storePlugins.find((p) => p.id === plugin.id)?.version;
    const updateAvailable = hubVersion && plugin.version && hubVersion !== plugin.version;
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-neutral-200/60 px-4 dark:border-neutral-800/60">
          <CatalogBreadcrumb
            parents={[{ label: "Plugins", onClick: onShowOverview }]}
            title={plugin.title || plugin.id}
          />
          {updateAvailable && (
            <button
              type="button"
              onClick={() => void handleUpdate(plugin)}
              disabled={installingId === plugin.id}
              title="Update"
              className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >
              {installingId === plugin.id ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleUninstall(plugin)}
            title="Uninstall"
            className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
          >
            <Trash2 size={15} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-6 px-5 py-5">
            {plugin.description && (
              <p className="text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">{plugin.description}</p>
            )}
            {plugin.skills.length > 0 && (
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                  Skills
                </p>
                <div className="grid grid-cols-[auto_1fr] gap-x-10 divide-y divide-neutral-200/60 dark:divide-neutral-800/60">
                  {plugin.skills.map((skill) => (
                    <button
                      key={skill.name}
                      type="button"
                      onClick={() => setView({ kind: "installed-skill", plugin, skill })}
                      className="col-span-2 grid grid-cols-subgrid items-baseline py-2 text-left transition-colors hover:opacity-70"
                    >
                      <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{skill.name}</span>
                      {skill.description && (
                        <span className="min-w-0 truncate text-xs text-neutral-400 dark:text-neutral-500">
                          {skill.description}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {plugin.mcpServers && plugin.mcpServers.length > 0 && (
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                  MCP Servers
                </p>
                <div className="space-y-2">
                  {plugin.mcpServers.map((server) => (
                    <div
                      key={server.name}
                      className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 dark:border-neutral-700 dark:bg-neutral-800/50"
                    >
                      <Server size={13} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
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
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                Information
              </p>
              <div className="grid grid-cols-[auto_1fr] gap-x-10 divide-y divide-neutral-200/60 text-xs dark:divide-neutral-800/60">
                {plugin.version && (
                  <div className="col-span-2 grid grid-cols-subgrid items-baseline py-2">
                    <span className="text-neutral-400 dark:text-neutral-500">Version</span>
                    <span className="min-w-0 text-neutral-700 dark:text-neutral-300">
                      <span className="flex items-center gap-2">
                        {plugin.version}
                        {updateAvailable && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
                            {hubVersion} available
                          </span>
                        )}
                      </span>
                    </span>
                  </div>
                )}
                {plugin.author && (
                  <div className="col-span-2 grid grid-cols-subgrid items-baseline py-2">
                    <span className="text-neutral-400 dark:text-neutral-500">Author</span>
                    <span className="min-w-0 text-neutral-700 dark:text-neutral-300">{plugin.author}</span>
                  </div>
                )}
                <div className="col-span-2 grid grid-cols-subgrid items-baseline py-2">
                  <span className="text-neutral-400 dark:text-neutral-500">Source</span>
                  <span className="min-w-0 break-all text-neutral-700 dark:text-neutral-300">{plugin.hubUrl}</span>
                </div>
                <div className="col-span-2 grid grid-cols-subgrid items-baseline py-2">
                  <span className="text-neutral-400 dark:text-neutral-500">Installed</span>
                  <span className="min-w-0 text-neutral-700 dark:text-neutral-300">
                    {new Date(plugin.installedAt).toLocaleDateString()}
                  </span>
                </div>
                {plugin.keywords && plugin.keywords.length > 0 && (
                  <div className="col-span-2 grid grid-cols-subgrid items-baseline py-2">
                    <span className="text-neutral-400 dark:text-neutral-500">Keywords</span>
                    <span className="min-w-0 text-neutral-700 dark:text-neutral-300">{plugin.keywords.join(", ")}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Installed skill detail ──────────────────────────────────────────────────
  if (view.kind === "installed-skill") {
    const { plugin, skill } = view;
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-neutral-200/60 px-4 dark:border-neutral-800/60">
          <CatalogBreadcrumb
            parents={[
              { label: "Plugins", onClick: onShowOverview },
              { label: plugin.title || plugin.id, onClick: () => setView({ kind: "installed-detail", plugin }) },
            ]}
            title={skill.name}
          />
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-sm">
            <Markdown>{skill.content}</Markdown>
          </div>
          {skill.resources && skill.resources.length > 0 && (
            <div className="mt-4">
              <SkillResourcesEditor resources={skill.resources} />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (view.kind === "store-detail") {
    const plugin = view.plugin;
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-neutral-200/60 px-4 dark:border-neutral-800/60">
          <CatalogBreadcrumb
            parents={[{ label: "Plugins", onClick: onShowOverview }]}
            title={plugin.title || plugin.id}
          />
          {!installedIds.has(plugin.id) && (
            <button
              type="button"
              onClick={() => void handleInstall(plugin)}
              disabled={installingId === plugin.id}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-200 dark:text-neutral-900"
            >
              {installingId === plugin.id ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              {installingId === plugin.id ? "Installing…" : "Install"}
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-6 px-5 py-5">
            {plugin.description && (
              <p className="text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">{plugin.description}</p>
            )}
            {(plugin.skills ?? []).length > 0 && (
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                  Skills
                </p>
                <div className="grid grid-cols-[auto_1fr] gap-x-10 divide-y divide-neutral-200/60 dark:divide-neutral-800/60">
                  {(plugin.skills ?? []).map((skill) => (
                    <div key={skill.name} className="col-span-2 grid grid-cols-subgrid items-baseline py-2">
                      <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{skill.name}</span>
                      {skill.description && (
                        <span className="min-w-0 truncate text-xs text-neutral-400 dark:text-neutral-500">
                          {skill.description}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(plugin.mcpServers ?? []).length > 0 && (
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                  MCP Servers
                </p>
                <div className="space-y-2">
                  {(plugin.mcpServers ?? []).map((name) => (
                    <div
                      key={name}
                      className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 dark:border-neutral-700 dark:bg-neutral-800/50"
                    >
                      <Server size={13} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                        {name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                Information
              </p>
              <div className="grid grid-cols-[auto_1fr] gap-x-10 divide-y divide-neutral-200/60 text-xs dark:divide-neutral-800/60">
                {plugin.version && (
                  <div className="col-span-2 grid grid-cols-subgrid items-baseline py-2">
                    <span className="text-neutral-400 dark:text-neutral-500">Version</span>
                    <span className="min-w-0 text-neutral-700 dark:text-neutral-300">{plugin.version}</span>
                  </div>
                )}
                {plugin.author && (
                  <div className="col-span-2 grid grid-cols-subgrid items-baseline py-2">
                    <span className="text-neutral-400 dark:text-neutral-500">Author</span>
                    <span className="min-w-0 text-neutral-700 dark:text-neutral-300">{plugin.author}</span>
                  </div>
                )}
                {plugin.keywords && plugin.keywords.length > 0 && (
                  <div className="col-span-2 grid grid-cols-subgrid items-baseline py-2">
                    <span className="text-neutral-400 dark:text-neutral-500">Keywords</span>
                    <span className="min-w-0 text-neutral-700 dark:text-neutral-300">{plugin.keywords.join(", ")}</span>
                  </div>
                )}
                <div className="col-span-2 grid grid-cols-subgrid items-baseline py-2">
                  <span className="text-neutral-400 dark:text-neutral-500">Source</span>
                  <span className="min-w-0 break-all text-neutral-700 dark:text-neutral-300">{plugin.source}</span>
                </div>
              </div>
            </div>
          </div>
          {installError && <p className="mt-4 text-xs text-red-500">{installError}</p>}
        </div>
      </div>
    );
  }

  return null;
}
