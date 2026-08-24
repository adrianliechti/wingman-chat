import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  MoreVertical,
  Package,
  Plus,
  Puzzle,
  RefreshCw,
  Replace,
  Server,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlugins } from "@/features/plugins/hooks/usePlugins";
import { loadHubPlugins } from "@/features/plugins/lib/hub";
import type { HubPlugin, InstalledPlugin } from "@/features/plugins/lib/types";
import type { ParsedSkill } from "@/features/skills/lib/skillParser";
import { getConfig } from "@/shared/config";
import { confirm } from "@/shared/lib/confirm";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";
import { notify } from "@/shared/lib/notify";
import { Markdown } from "@/shared/ui/Markdown";
import { SkillResourcesEditor } from "@/features/agent/components/SkillResourcesEditor";

export interface PluginsManagerPanelProps {
  isOpen: boolean;
  onClose: () => void;
  search?: string;
  onViewKindChange?: (
    kind: "list" | "installed-detail" | "installed-skill" | "store" | "store-detail",
  ) => void;
}

type View =
  | { kind: "list" }
  | { kind: "installed-detail"; plugin: InstalledPlugin }
  | { kind: "installed-skill"; plugin: InstalledPlugin; skill: ParsedSkill }
  | { kind: "store-detail"; plugin: HubPlugin };

export function PluginsManagerPanel({
  isOpen,
  onClose: _onClose,
  search = "",
  onViewKindChange,
}: PluginsManagerPanelProps) {
  const { plugins, installPlugin, uninstallPlugin } = usePlugins();
  const hubUrl = getConfig().plugins?.url;

  const [view, setInternalView] = useState<View>({ kind: "list" });

  const setView = (v: View) => {
    setInternalView(v);
    onViewKindChange?.(v.kind);
  };

  const [storePlugins, setStorePlugins] = useState<HubPlugin[]>([]);
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);

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
    if (hubUrl) loadStore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setInternalView({ kind: "list" });
      setInstallError(null);
    }
  }, [isOpen]);

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
    if (
      !(await confirm({
        title: "Uninstall plugin?",
        message: `"${plugin.title || plugin.id}" and all its bundled skills will be removed.`,
        danger: true,
      }))
    )
      return;
    await uninstallPlugin(plugin.id);
    setView({ kind: "list" });
  };

  // ── Unified list (installed first, then store-only) ───────────────────────
  if (view.kind === "list") {
    const q = search.trim().toLowerCase();
    const matchesSearch = (p: { id: string; title?: string; description?: string }) =>
      !q ||
      p.id.toLowerCase().includes(q) ||
      (p.title ?? "").toLowerCase().includes(q) ||
      (p.description ?? "").toLowerCase().includes(q);

    const installedMatches = plugins.filter(matchesSearch);
    const storeOnly = storePlugins.filter((p) => !installedIds.has(p.id)).filter(matchesSearch);
    const isEmpty = installedMatches.length === 0 && storeOnly.length === 0;

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto">
          {storeLoading && installedMatches.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 size={20} className="animate-spin text-neutral-300 dark:text-neutral-600" />
            </div>
          ) : storeError && plugins.length === 0 && storePlugins.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <AlertTriangle size={28} className="text-neutral-300 dark:text-neutral-600" />
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
          ) : isEmpty ? (
            search ? (
              <p className="py-8 text-center text-xs text-neutral-400 dark:text-neutral-500">
                No plugins match your search.
              </p>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <Package size={32} className="text-neutral-200 dark:text-neutral-700" />
                <p className="text-sm font-medium text-neutral-400 dark:text-neutral-500">
                  No plugins available
                </p>
              </div>
            )
          ) : (
            <ul className="py-1">
              {installedMatches.length > 0 && (
                <li className="px-5 pb-1 pt-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                    Installed
                  </span>
                </li>
              )}
              {installedMatches.map((plugin) => {
                const hubVersion = storePlugins.find((p) => p.id === plugin.id)?.version;
                const updateAvailable =
                  hubVersion && plugin.version && hubVersion !== plugin.version;
                return (
                  <li
                    key={plugin.id}
                    className="group border-t border-neutral-200/40 first:border-t-0 dark:border-neutral-800/40"
                  >
                    <div className="flex w-full items-center gap-3 pl-5 pr-2 py-3">
                      <button
                        type="button"
                        onClick={() => setView({ kind: "installed-detail", plugin })}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left transition-colors hover:opacity-80"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                          {plugin.icon ? (
                            <img
                              src={plugin.icon}
                              alt=""
                              className="h-6 w-6 rounded object-contain"
                            />
                          ) : (
                            <Puzzle size={16} className="text-neutral-400 dark:text-neutral-500" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-1.5">
                            <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                              {plugin.title || plugin.id}
                            </span>
                            {plugin.version && (
                              <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                                v{plugin.version}
                              </span>
                            )}
                          </div>
                          {plugin.description && (
                            <span className="mt-0.5 block truncate text-xs text-neutral-400 dark:text-neutral-500">
                              {plugin.description}
                            </span>
                          )}
                        </div>
                      </button>
                      {updateAvailable ? (
                        <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
                          Update available
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                          Installed
                        </span>
                      )}
                      <DropdownMenu
                        anchor="bottom end"
                        trigger={
                          <MenuButton className="shrink-0 rounded p-1.5 mr-1 text-neutral-300 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300">
                            <MoreVertical size={14} />
                          </MenuButton>
                        }
                      >
                        {updateAvailable && (
                          <DropdownMenuItem
                            icon={
                              installingId === plugin.id ? (
                                <Loader2 size={13} className="animate-spin" />
                              ) : (
                                <RefreshCw size={13} />
                              )
                            }
                            disabled={installingId === plugin.id}
                            onClick={() => void handleUpdate(plugin)}
                          >
                            Update
                          </DropdownMenuItem>
                        )}
                        {!updateAvailable && storePlugins.some((p) => p.id === plugin.id) && (
                          <DropdownMenuItem
                            icon={<Replace size={13} />}
                            disabled={installingId === plugin.id}
                            onClick={() => void handleUpdate(plugin)}
                          >
                            Reinstall
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          icon={<Trash2 size={13} />}
                          destructive
                          onClick={() => void handleUninstall(plugin)}
                        >
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenu>
                    </div>
                  </li>
                );
              })}
              {installedMatches.length > 0 && storeOnly.length > 0 && (
                <li className="px-5 pb-1 pt-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                    Available
                  </span>
                </li>
              )}
              {storeOnly.map((plugin) => (
                <li
                  key={plugin.id}
                  className="border-t border-neutral-200/40 first:border-t-0 dark:border-neutral-800/40"
                >
                  <div className="flex w-full items-center gap-3 px-5 py-3">
                    <button
                      type="button"
                      onClick={() => setView({ kind: "store-detail", plugin })}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left transition-colors hover:opacity-80"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
                        {plugin.icon ? (
                          <img
                            src={plugin.icon}
                            alt=""
                            className="h-6 w-6 rounded object-contain"
                          />
                        ) : (
                          <Puzzle size={16} className="text-neutral-400 dark:text-neutral-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-1.5">
                          <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                            {plugin.title || plugin.id}
                          </span>
                        </div>
                        {plugin.description && (
                          <span className="mt-0.5 block truncate text-xs text-neutral-400 dark:text-neutral-500">
                            {plugin.description}
                          </span>
                        )}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleInstall(plugin)}
                      disabled={installingId === plugin.id}
                      title="Install"
                      className="shrink-0 rounded-full border border-neutral-200 bg-neutral-50 p-1.5 text-neutral-500 transition-colors hover:border-neutral-300 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:bg-neutral-700"
                    >
                      {installingId === plugin.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Plus size={14} />
                      )}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
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
          <button
            type="button"
            onClick={() => setView({ kind: "list" })}
            className="-ml-1 rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          >
            <ArrowLeft size={16} />
          </button>
          {plugin.icon ? (
            <img src={plugin.icon} alt="" className="h-5 w-5 shrink-0 rounded object-contain" />
          ) : (
            <Puzzle size={15} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
          )}
          <span className="flex-1 truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {plugin.title || plugin.id}
          </span>
          {updateAvailable && (
            <button
              type="button"
              onClick={() => void handleUpdate(plugin)}
              disabled={installingId === plugin.id}
              title="Update"
              className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >
              {installingId === plugin.id ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <RefreshCw size={15} />
              )}
            </button>
          )}
          {!updateAvailable && storePlugins.some((p) => p.id === plugin.id) && (
            <button
              type="button"
              onClick={() => void handleUpdate(plugin)}
              disabled={installingId === plugin.id}
              title="Reinstall"
              className="rounded-md p-1.5 text-neutral-300 transition-colors hover:bg-neutral-100 hover:text-neutral-600 disabled:opacity-40 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >
              {installingId === plugin.id ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Replace size={15} />
              )}
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
              <p className="text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
                {plugin.description}
              </p>
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
                      <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                        {skill.name}
                      </span>
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
                <div className="col-span-2 grid grid-cols-subgrid items-baseline py-2">
                  <span className="text-neutral-400 dark:text-neutral-500">Source</span>
                  <span className="min-w-0 break-all text-neutral-700 dark:text-neutral-300">
                    {plugin.hubUrl}
                  </span>
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
                    <span className="min-w-0 text-neutral-700 dark:text-neutral-300">
                      {plugin.keywords.join(", ")}
                    </span>
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
          <button
            type="button"
            onClick={() => setView({ kind: "installed-detail", plugin })}
            className="-ml-1 rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
            <button
              type="button"
              onClick={() => setView({ kind: "installed-detail", plugin })}
              className="shrink-0 truncate font-medium text-neutral-400 transition-colors hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-300"
            >
              {plugin.title || plugin.id}
            </button>
            <span className="shrink-0 text-neutral-300 dark:text-neutral-600">/</span>
            <span className="min-w-0 truncate font-semibold text-neutral-900 dark:text-neutral-100">
              {skill.name}
            </span>
          </div>
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
          <button
            type="button"
            onClick={() => setView({ kind: "list" })}
            className="-ml-1 rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          >
            <ArrowLeft size={16} />
          </button>
          {plugin.icon ? (
            <img src={plugin.icon} alt="" className="h-5 w-5 shrink-0 rounded object-contain" />
          ) : (
            <Puzzle size={15} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
          )}
          <span className="flex-1 truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {plugin.title || plugin.id}
          </span>
          {installedIds.has(plugin.id) ? (
            <button
              type="button"
              onClick={() => void handleInstall(plugin)}
              disabled={installingId === plugin.id}
              title="Reinstall"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >
              {installingId === plugin.id ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Replace size={13} />
              )}
              {installingId === plugin.id ? "Installing…" : "Reinstall"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleInstall(plugin)}
              disabled={installingId === plugin.id}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-200 dark:text-neutral-900"
            >
              {installingId === plugin.id ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Plus size={13} />
              )}
              {installingId === plugin.id ? "Installing…" : "Install"}
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-6 px-5 py-5">
            {plugin.description && (
              <p className="text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
                {plugin.description}
              </p>
            )}
            {(plugin.skills ?? []).length > 0 && (
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                  Skills
                </p>
                <div className="grid grid-cols-[auto_1fr] gap-x-10 divide-y divide-neutral-200/60 dark:divide-neutral-800/60">
                  {(plugin.skills ?? []).map((skill) => (
                    <div
                      key={skill.name}
                      className="col-span-2 grid grid-cols-subgrid items-baseline py-2"
                    >
                      <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                        {skill.name}
                      </span>
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
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                Information
              </p>
              <div className="grid grid-cols-[auto_1fr] gap-x-10 divide-y divide-neutral-200/60 text-xs dark:divide-neutral-800/60">
                {plugin.version && (
                  <div className="col-span-2 grid grid-cols-subgrid items-baseline py-2">
                    <span className="text-neutral-400 dark:text-neutral-500">Version</span>
                    <span className="min-w-0 text-neutral-700 dark:text-neutral-300">
                      {plugin.version}
                    </span>
                  </div>
                )}
                {plugin.keywords && plugin.keywords.length > 0 && (
                  <div className="col-span-2 grid grid-cols-subgrid items-baseline py-2">
                    <span className="text-neutral-400 dark:text-neutral-500">Keywords</span>
                    <span className="min-w-0 text-neutral-700 dark:text-neutral-300">
                      {plugin.keywords.join(", ")}
                    </span>
                  </div>
                )}
                <div className="col-span-2 grid grid-cols-subgrid items-baseline py-2">
                  <span className="text-neutral-400 dark:text-neutral-500">Source</span>
                  <span className="min-w-0 break-all text-neutral-700 dark:text-neutral-300">
                    {plugin.source}
                  </span>
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
