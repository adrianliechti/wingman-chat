import { serializeSkill } from "@/features/skills/lib/skillParser";
import { decodeDataURL, downloadBlob, parseDataUrl } from "@/shared/lib/utils";
import type { InstalledPlugin } from "./types";

const ICON_EXTENSION_BY_MIME: Record<string, string> = {
  "image/svg+xml": "svg",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Download every installed plugin as a portable backup. Each plugin retains
 * its manifest, MCP server configuration, skills, and bundled resources.
 */
export async function downloadPluginsAsZip(
  plugins: InstalledPlugin[],
  filename: string = "plugins.zip",
): Promise<void> {
  if (plugins.length === 0) throw new Error("No plugins to download");

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  for (const plugin of plugins) {
    const folder = zip.folder(plugin.id);
    if (!folder) continue;

    let iconFilename: string | undefined;
    if (plugin.icon?.startsWith("data:")) {
      const mimeType = parseDataUrl(plugin.icon)?.mimeType;
      iconFilename = `icon.${ICON_EXTENSION_BY_MIME[mimeType ?? ""] ?? "bin"}`;
      folder.file(iconFilename, decodeDataURL(plugin.icon));
    }

    folder.file(
      "plugin.json",
      JSON.stringify(
        {
          id: plugin.id,
          title: plugin.title,
          version: plugin.version,
          description: plugin.description,
          keywords: plugin.keywords,
          hubUrl: plugin.hubUrl,
          installedAt: plugin.installedAt,
          icon: iconFilename,
          skillNames: plugin.skills.map((skill) => skill.name),
        },
        null,
        2,
      ),
    );

    if (plugin.mcpServers?.length) {
      folder.file(
        "mcp.json",
        JSON.stringify(
          {
            mcpServers: Object.fromEntries(plugin.mcpServers.map(({ name, ...server }) => [name, server])),
          },
          null,
          2,
        ),
      );
    }

    for (const skill of plugin.skills) {
      folder.file(`skills/${skill.name}/SKILL.md`, serializeSkill({ id: skill.name, ...skill }));
      for (const resource of skill.resources ?? []) {
        folder.file(
          `skills/${skill.name}/${resource.path}`,
          resource.content.startsWith("data:") ? decodeDataURL(resource.content) : resource.content,
        );
      }
    }
  }

  downloadBlob(await zip.generateAsync({ type: "blob" }), filename);
}
