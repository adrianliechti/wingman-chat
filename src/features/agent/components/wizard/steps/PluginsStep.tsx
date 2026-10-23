import { Loader2, Plus, Puzzle, RefreshCw, ToggleLeft, ToggleRight } from "lucide-react";
import { type Dispatch, useMemo, useState } from "react";
import { usePlugins } from "@/features/plugins/hooks/usePlugins";
import { useHubPlugins } from "@/features/plugins/hooks/useHubPlugins";
import { matchesPluginQuery } from "@/features/plugins/lib/hub";
import type { HubPlugin } from "@/features/plugins/lib/types";
import { getConfig } from "@/shared/config";
import { notify } from "@/shared/lib/notify";
import type { WizardAction } from "../AgentWizard";
import { StepFilter } from "../StepFilter";
import { StepHeader } from "../StepHeader";

interface PluginsStepProps {
  selectedPlugins: string[];
  dispatch: Dispatch<WizardAction>;
}

export function PluginsStep({ selectedPlugins, dispatch }: PluginsStepProps) {
  const { plugins, installPlugin } = usePlugins();
  const hubUrl = getConfig().plugins?.url;

  const { plugins: storePlugins, loading: storeLoading, error: storeError, reload: loadStore } = useHubPlugins(hubUrl);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const selectedSet = useMemo(() => new Set(selectedPlugins), [selectedPlugins]);
  const installedIds = useMemo(() => new Set(plugins.map((p) => p.id)), [plugins]);
  const availablePlugins = useMemo(
    () => storePlugins.filter((p) => !installedIds.has(p.id)),
    [storePlugins, installedIds],
  );

  const filteredInstalled = useMemo(() => plugins.filter((p) => matchesPluginQuery(p, search)), [plugins, search]);
  const filteredAvailable = useMemo(
    () => availablePlugins.filter((p) => matchesPluginQuery(p, search)),
    [availablePlugins, search],
  );

  const handleInstall = async (plugin: HubPlugin) => {
    if (!hubUrl) return;
    setInstallingId(plugin.id);
    try {
      const installed = await installPlugin(hubUrl, plugin);
      notify.success(`Installed "${plugin.title || plugin.id}"`);
      if (!selectedSet.has(installed.id)) dispatch({ type: "TOGGLE_PLUGIN", id: installed.id });
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "Failed to install plugin");
    }
    setInstallingId(null);
  };

  return (
    <div className="space-y-3">
      <StepHeader
        title="Activate plugins"
        description="Plugins bundle skills and MCP servers installed from a hub. Toggle on the ones this agent should use, or skip this and attach plugins later."
      />

      <div className="flex items-center gap-1.5">
        <h3 className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
          Installed plugins
        </h3>
        <StepFilter value={search} onChange={setSearch} />
      </div>

      <div className="space-y-0.5">
        {filteredInstalled.map((plugin) => {
          const isEnabled = selectedSet.has(plugin.id);
          return (
            <div key={plugin.id} className="flex items-center gap-2 py-1.5">
              <span className="text-neutral-600 dark:text-neutral-400">
                {plugin.icon ? (
                  <img src={plugin.icon} alt="" className="w-4 h-4 rounded object-contain" />
                ) : (
                  <Puzzle size={16} />
                )}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate">
                  {plugin.title || plugin.id}
                </div>
                {plugin.description && (
                  <div className="text-xs text-neutral-500 dark:text-neutral-400 line-clamp-1">
                    {plugin.description}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => dispatch({ type: "TOGGLE_PLUGIN", id: plugin.id })}
                className={`shrink-0 ${isEnabled ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400 dark:text-neutral-500"}`}
              >
                {isEnabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
              </button>
            </div>
          );
        })}
        {filteredInstalled.length === 0 && (
          <p className="py-1.5 text-xs text-neutral-400 dark:text-neutral-500">
            {plugins.length === 0 ? "No plugins installed yet." : "No installed plugins match your search."}
          </p>
        )}
      </div>

      {hubUrl && (
        <div className="space-y-0.5 border-t border-neutral-200/60 pt-2 dark:border-neutral-800/60">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            Available plugins
          </h3>
          {storeLoading && storePlugins.length === 0 ? (
            <div className="flex justify-center py-3">
              <Loader2 size={16} className="animate-spin text-neutral-300 dark:text-neutral-600" />
            </div>
          ) : storeError && storePlugins.length === 0 ? (
            <div className="flex items-center gap-3 py-1.5">
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{storeError}</p>
              <button
                type="button"
                onClick={loadStore}
                className="inline-flex items-center gap-1 rounded-md border border-neutral-300/50 px-2 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100/50 dark:border-neutral-600/50 dark:text-neutral-400 dark:hover:bg-neutral-800/50"
              >
                <RefreshCw size={11} /> Retry
              </button>
            </div>
          ) : filteredAvailable.length === 0 ? (
            <p className="py-1.5 text-xs text-neutral-400 dark:text-neutral-500">
              {search.trim() ? "No available plugins match your search." : "No new plugins available"}
            </p>
          ) : (
            filteredAvailable.map((plugin) => (
              <div key={plugin.id} className="flex items-center gap-2 py-1.5">
                <span className="text-neutral-600 dark:text-neutral-400">
                  {plugin.icon ? (
                    <img src={plugin.icon} alt="" className="w-4 h-4 rounded object-contain" />
                  ) : (
                    <Puzzle size={16} />
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate">
                    {plugin.title || plugin.id}
                  </div>
                  {plugin.description && (
                    <div className="text-xs text-neutral-500 dark:text-neutral-400 line-clamp-1">
                      {plugin.description}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void handleInstall(plugin)}
                  disabled={installingId !== null}
                  title={`Install ${plugin.title || plugin.id}`}
                  aria-label={`Install ${plugin.title || plugin.id}`}
                  className="shrink-0 rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                >
                  {installingId === plugin.id ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
