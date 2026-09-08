import type { InstalledPlugin } from "@/features/plugins/lib/types";
import type { SkillEntry } from "@/features/skills/lib/skillsProvider";

/** Provider id prefix for per-plugin UI toggle tracking and MCP lifecycle. */
export const PLUGIN_PROVIDER_PREFIX = "plugin:";

export function pluginProviderId(pluginId: string): string {
  return `${PLUGIN_PROVIDER_PREFIX}${pluginId}`;
}

/** Client id for an MCP server bundled by a plugin. */
export function pluginMcpClientId(pluginId: string, serverName: string): string {
  return `${PLUGIN_PROVIDER_PREFIX}${pluginId}:mcp:${serverName}`;
}

/**
 * Adapt plugins' bundled skills to catalog entries so they resolve through the
 * app's single `read_skill` surface, tagged with the owning plugin id.
 */
export function pluginEntries(plugins: InstalledPlugin[]): SkillEntry[] {
  return plugins.flatMap((plugin) =>
    plugin.skills.map((skill) => {
      const resources = skill.resources ?? [];
      return {
        name: skill.name,
        description: skill.description,
        plugin: plugin.id,
        compatibility: skill.compatibility,
        resources: resources.length ? resources.map((r) => r.path) : undefined,
        loadContent: () => skill.content,
        loadResource: resources.length
          ? (path: string) => resources.find((r) => r.path === path)?.content ?? null
          : undefined,
      };
    }),
  );
}
