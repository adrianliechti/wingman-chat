import type { ParsedSkill } from "@/features/skills/lib/skillParser";

export interface PluginMCPServer {
  name: string;
  type: string;
}

/** A plugin listed by a hub's catalog, not yet installed. */
export interface HubPlugin {
  id: string;
  title?: string;
  version?: string;
  description?: string;
  keywords?: string[];
  skills?: string[];
  mcp_servers?: PluginMCPServer[];
  source: string;
  download: string;
  sha256: string;
  size: number;
}

/**
 * A plugin installed into OPFS. Bundled skills live under the plugin's own
 * folder (`plugins/{id}/skills/{name}/SKILL.md`) rather than the personal
 * skill library, so the plugin is fully self-contained once installed — the
 * hub is never consulted again except to check for updates.
 */
export interface InstalledPlugin {
  id: string;
  title?: string;
  version?: string;
  description?: string;
  keywords?: string[];
  mcpServers?: PluginMCPServer[];
  hubUrl: string;
  sha256: string;
  installedAt: string;
  skills: ParsedSkill[];
}
