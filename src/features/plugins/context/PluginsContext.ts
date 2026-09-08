import { createContext } from "react";
import type { HubPlugin, InstalledPlugin } from "@/features/plugins/lib/types";

export interface PluginsContextType {
  plugins: InstalledPlugin[];
  isLoaded: boolean;
  installPlugin: (hubUrl: string, plugin: HubPlugin) => Promise<InstalledPlugin>;
  uninstallPlugin: (id: string) => Promise<void>;
  getPlugin: (id: string) => InstalledPlugin | undefined;
}

export const PluginsContext = createContext<PluginsContextType | undefined>(undefined);
