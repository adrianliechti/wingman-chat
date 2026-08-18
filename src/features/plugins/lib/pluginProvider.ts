import { FileCode2, Puzzle, ScrollText } from "lucide-react";
import type { InstalledPlugin } from "@/features/plugins/lib/types";
import { setSkillResourceResolver } from "@/features/tools/lib/skillResourceMount";
import { artifactLanguage } from "@/shared/lib/fileTypes";
import type { ArtifactFiles } from "@/features/tools/lib/interpreterProtocol";
import type { Tool, ToolProvider } from "@/shared/types/chat";
import pluginPromptTemplate from "@/features/plugins/prompts/plugin.txt?raw";

/** Provider id prefix for an installed plugin's tool provider. */
export const PLUGIN_PROVIDER_PREFIX = "plugin:";

export function pluginProviderId(pluginId: string): string {
  return `${PLUGIN_PROVIDER_PREFIX}${pluginId}`;
}

/** Tool names namespaced by plugin id/slug so multiple enabled plugins never collide. */
function pluginSlug(pluginId: string): string {
  return pluginId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Builds a plugin's own ToolProvider — one `read_skill`-equivalent tool scoped
 * to that plugin's bundled skills only, fully independent of the personal
 * Skills tool and every other enabled plugin. Tool names are namespaced by the
 * plugin id so multiple enabled plugins can coexist in the same ToolRegistry.
 */
export function createPluginProvider(plugin: InstalledPlugin): ToolProvider {
  const slug = pluginSlug(plugin.id);
  const readSkillTool = `read_plugin_skill_${slug}`;
  const readResourceTool = `read_plugin_skill_resource_${slug}`;

  const byName = new Map(plugin.skills.map((s) => [s.name, s]));
  const hasResources = plugin.skills.some((s) => s.resources?.length);

  setSkillResourceResolver(
    pluginProviderId(plugin.id),
    hasResources
      ? async () => {
          const files: ArtifactFiles = {};
          for (const skill of plugin.skills) {
            for (const resource of skill.resources ?? []) {
              files[`/skills/${skill.name}/${resource.path}`] = { content: resource.content };
            }
          }
          return files;
        }
      : null,
  );

  const tools: Tool[] = [
    {
      name: readSkillTool,
      display: {
        header: (_args, state) => ({
          icon: ScrollText,
          label: state.error ? "Skill unavailable" : "Read skill",
        }),
        input: () => [],
        output: (result) => {
          const part = result.find((c) => c.type === "text");
          const raw = part && part.type === "text" ? part.text : undefined;
          if (!raw) return null;
          try {
            const parsed = JSON.parse(raw) as { instructions?: unknown };
            return typeof parsed.instructions === "string"
              ? { code: parsed.instructions, language: "markdown", name: "Instructions" }
              : null;
          } catch {
            return null;
          }
        },
      },
      description: `Read the full content and instructions of a skill bundled with the "${plugin.title || plugin.id}" plugin.`,
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            enum: plugin.skills.map((s) => s.name),
            description: "The name of the skill to read.",
          },
        },
        required: ["name"],
      },
      function: async (args: Record<string, unknown>) => {
        const skillName = args.name as string;
        const skill = skillName ? byName.get(skillName) : undefined;
        if (!skill) {
          return [{ type: "text" as const, text: JSON.stringify({ error: `Skill "${skillName}" not found` }) }];
        }
        const resources = skill.resources ?? [];
        const compatibilityNote = skill.compatibility
          ? `\n\n<compatibility>${escapeXml(skill.compatibility)}</compatibility>`
          : "";
        const resourceList = resources.length
          ? `\n\n<skill_resources>\n${resources.map((r) => `  <file>${escapeXml(r.path)}</file>`).join("\n")}\n</skill_resources>`
          : "";
        return [
          {
            type: "text" as const,
            text: JSON.stringify({
              name: skill.name,
              description: skill.description,
              ...(skill.compatibility ? { compatibility: skill.compatibility } : {}),
              instructions: `<skill_content name="${escapeXml(skill.name)}">\n${skill.content}${compatibilityNote}${resourceList}\n</skill_content>`,
            }),
          },
        ];
      },
    },
  ];

  if (hasResources) {
    tools.push({
      name: readResourceTool,
      display: {
        header: (args, state) => ({
          icon: FileCode2,
          label: state.error ? "Resource unavailable" : "Read skill resource",
          preview:
            typeof args?.name === "string" && typeof args?.path === "string" ? `${args.name}/${args.path}` : undefined,
        }),
        input: () => [],
        output: (result) => {
          const part = result.find((c) => c.type === "text");
          const raw = part && part.type === "text" ? part.text : undefined;
          if (!raw) return null;
          try {
            const parsed = JSON.parse(raw) as { path?: unknown; content?: unknown };
            return typeof parsed.content === "string" && typeof parsed.path === "string"
              ? { code: parsed.content, language: artifactLanguage(parsed.path) || "text", name: parsed.path }
              : null;
          } catch {
            return null;
          }
        },
      },
      description: `Read a bundled support resource for a skill in the "${plugin.title || plugin.id}" plugin. Use only exact resource paths listed by ${readSkillTool}.`,
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            enum: plugin.skills.filter((s) => s.resources?.length).map((s) => s.name),
            description: "The name of the skill that owns the resource.",
          },
          path: {
            type: "string",
            description: "The exact resource path relative to the skill folder.",
          },
        },
        required: ["name", "path"],
      },
      function: async (args: Record<string, unknown>) => {
        const skillName = args.name as string;
        const resourcePath = args.path as string;
        const skill = skillName ? byName.get(skillName) : undefined;
        if (!skill) {
          return [{ type: "text" as const, text: JSON.stringify({ error: `Skill "${skillName}" not found` }) }];
        }
        const resource = skill.resources?.find((r) => r.path === resourcePath);
        if (!resource) {
          return [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Resource "${resourcePath}" not listed for skill "${skillName}"`,
                resources: skill.resources?.map((r) => r.path) ?? [],
              }),
            },
          ];
        }
        return [
          {
            type: "text" as const,
            text: JSON.stringify({ name: skill.name, path: resourcePath, content: resource.content }),
          },
        ];
      },
    });
  }

  const skillsXml = plugin.skills
    .map(
      (s) =>
        `  <skill>\n    <name>${escapeXml(s.name)}</name>\n    <description>${escapeXml(s.description)}</description>\n  </skill>`,
    )
    .join("\n");

  const resourcesGuidance = hasResources
    ? `\n### Bundled resources\n\nSome skills ship support files (scripts, references, assets). When \`${readSkillTool}\` lists them, load one with \`${readResourceTool}\` only when the instructions reference it or the task clearly needs it. The selected skills' resources are mounted read-only in the code interpreter under \`skills/<name>/\`, so run scripts from that exact path instead of pasting their bodies.\n`
    : "";

  const instructions = pluginPromptTemplate
    .replace("{pluginTitle}", plugin.title || plugin.id)
    .replace("{pluginDescription}", plugin.description ? `${plugin.description}\n\n` : "")
    .replace(/{readSkillTool}/g, readSkillTool)
    .replace("{resourcesGuidance}", resourcesGuidance)
    .replace("{skillsXml}", skillsXml);

  return {
    id: pluginProviderId(plugin.id),
    name: plugin.title || plugin.id,
    description: plugin.description,
    icon: Puzzle,
    instructions,
    tools,
  };
}
