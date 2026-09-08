import { useContext } from "react";
import { PluginsContext } from "@/features/plugins/context/PluginsContext";

export function usePlugins() {
  const context = useContext(PluginsContext);
  if (context === undefined) {
    throw new Error("usePlugins must be used within a PluginsProvider");
  }
  return context;
}
