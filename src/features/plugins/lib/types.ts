import type { ParsedSkill } from "@/features/skills/lib/skillParser";

/** A plugin listed by a hub's catalog, not yet installed. */
export interface HubPlugin {
  id: string;
  title?: string;
  version?: string;
  description?: string;
  keywords?: string[];
  skills?: string[];
  mcpServers?: string[];
  source: string;
}

/** A skill's name and description, as returned by a hub's plugin detail endpoint. */
export interface HubPluginSkill {
  name: string;
  description: string;
}

/** An MCP server's name and connection info, as returned by a hub's plugin detail endpoint. */
export interface HubMcpServer {
  name: string;
  type: string;
  url?: string;
  command?: string;
}

/** Full detail for a single hub plugin, fetched on demand when previewing it in the store. */
export interface HubPluginDetail {
  skills: HubPluginSkill[];
  mcpServers: HubMcpServer[];
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
  mcpServers?: HubMcpServer[];
  hubUrl: string;
  installedAt: string;
  skills: ParsedSkill[];
}
