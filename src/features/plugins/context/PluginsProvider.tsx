import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { downloadHubPlugin, loadHubPluginDetail } from "@/features/plugins/lib/hub";
import { deletePlugin, loadAllPlugins, savePlugin } from "@/features/plugins/lib/opfs-plugins";
import type { HubPlugin, InstalledPlugin } from "@/features/plugins/lib/types";
import { PluginsContext } from "./PluginsContext";

interface PluginsProviderProps {
  children: ReactNode;
}

export function PluginsProvider({ children }: PluginsProviderProps) {
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    void loadAllPlugins()
      .then(setPlugins)
      .catch((error) => console.warn("Failed to load plugins:", error))
      .finally(() => setIsLoaded(true));
  }, []);

  const installPlugin = useCallback(
    async (hubUrl: string, plugin: HubPlugin): Promise<InstalledPlugin> => {
      const [skills, detail] = await Promise.all([
        downloadHubPlugin(hubUrl, plugin),
        loadHubPluginDetail(hubUrl, plugin.id).catch(() => null),
      ]);
      const installed: InstalledPlugin = {
        id: plugin.id,
        title: plugin.title,
        version: plugin.version,
        description: plugin.description,
        keywords: plugin.keywords,
        mcpServers: detail?.mcpServers,
        hubUrl,
        installedAt: new Date().toISOString(),
        skills,
      };

      await savePlugin(installed);
      setPlugins((prev) => [...prev.filter((p) => p.id !== installed.id), installed]);
      return installed;
    },
    [],
  );

  const uninstallPlugin = useCallback(async (id: string): Promise<void> => {
    await deletePlugin(id);
    setPlugins((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const getPlugin = useCallback((id: string) => plugins.find((p) => p.id === id), [plugins]);

  return (
    <PluginsContext.Provider
      value={{ plugins, isLoaded, installPlugin, uninstallPlugin, getPlugin }}
    >
      {children}
    </PluginsContext.Provider>
  );
}
