import { FileCode2, ScrollText, Sparkles } from "lucide-react";
import type { Skill } from "@/features/skills/lib/skillParser";
import { loadSkillResource, type SkillTemplate } from "@/features/skills/lib/templates";
import skillsPrompt from "@/features/skills/prompts/skills.txt?raw";
import type { ArtifactFiles } from "@/features/tools/lib/interpreterProtocol";
import { setSkillResourceResolver } from "@/features/tools/lib/skillResourceMount";
import { artifactLanguage } from "@/shared/lib/fileTypes";
import type { Tool, ToolProvider } from "@/shared/types/chat";

/** Provider id for the app's single skills tool. */
export const SKILLS_PROVIDER_ID = "skills";

/**
 * Which independently-toggled sources the Skills tool exposes (no-agent mode).
 * Either may be on at once; a personal skill shadows a shipped template of the
 * same name (personal wins). The Studio skill pack is intentionally absent — it's
 * slaved to the Studio capability and passed to the provider as a separate
 * `studioEnabled` flag, not a user-toggled source.
 */
export interface SkillSources {
  /** The user's own editable OPFS skills. */
  personal: boolean;
  /** The shipped template catalog (excludes the Studio skill pack). */
  catalog: boolean;
}

/**
 * Whether a catalog category (the first path segment of a template's SKILL.md,
 * e.g. `skills/<category>/<name>/SKILL.md`) belongs to the Studio skill pack —
 * the format/medium capabilities and output generators shipped under
 * `skills/studio/`. Surfaced as its own Skills source so they don't crowd the
 * general catalog.
 */
export const isStudioSkillCategory = (category: string): boolean => category === "studio";

/**
 * One skill exposed by the catalog. Content is loaded on demand so eager
 * sources (the in-memory OPFS library) and lazy ones (shipped templates fetched
 * over HTTP) can be combined behind a single `read_skill`.
 */
export interface SkillEntry {
  name: string;
  description: string;
  /** Owning plugin id, when the skill comes from an installed plugin. */
  plugin?: string;
  /** Optional environment requirements (agentskills `compatibility` frontmatter). */
  compatibility?: string;
  /** Bundled resource paths relative to the skill folder, e.g. "scripts/extract.py". */
  resources?: string[];
  loadContent: () => string | Promise<string>;
  loadResource?: (path: string) => string | null | Promise<string | null>;
}

/** Lookup key so a plugin skill never shadows a personal skill of the same name. */
function entryKey(plugin: string | undefined, name: string): string {
  return `${plugin ?? ""}\u0000${name}`;
}

/**
 * Adapt shipped templates (content fetched lazily) to catalog entries, so the
 * Skills tool resolves `read_skill` / `read_skill_resource` identically across
 * sources. Name collisions across sources are resolved by the caller's single
 * dedup (push order = precedence), not here.
 */
export function templateEntries(
  templates: SkillTemplate[],
  loadTemplate: (path: string) => Promise<{ content: string } | null>,
  predicate: (t: SkillTemplate) => boolean,
): SkillEntry[] {
  return templates.filter(predicate).map((t) => ({
    name: t.name,
    description: t.description,
    compatibility: t.compatibility,
    resources: t.resources,
    loadContent: async () => {
      const parsed = await loadTemplate(t.path);
      if (!parsed) throw new Error(`Template "${t.path}" unavailable`);
      return parsed.content;
    },
    loadResource: (resourcePath: string) => loadSkillResource(t.path, resourcePath),
  }));
}

/** The shipped Studio skill pack (studio + generation categories) as entries. */
export function studioTemplateEntries(
  templates: SkillTemplate[],
  loadTemplate: (path: string) => Promise<{ content: string } | null>,
): SkillEntry[] {
  return templateEntries(templates, loadTemplate, (t) => isStudioSkillCategory(t.category));
}

/** Adapt in-memory library skills (content already loaded) to catalog entries. */
export function libraryEntries(skills: Skill[]): SkillEntry[] {
  return skills.map((s) => {
    const resources = s.resources ?? [];
    return {
      name: s.name,
      description: s.description,
      compatibility: s.compatibility,
      resources: resources.length ? resources.map((r) => r.path) : undefined,
      loadContent: () => s.content,
      loadResource: resources.length
        ? (path: string) => resources.find((r) => r.path === path)?.content ?? null
        : undefined,
    };
  });
}

/** Identity (provider id, display name, description) of a skills tool variant. */
export interface SkillsProviderMeta {
  id: string;
  name: string;
  description: string;
}

/**
 * Builds the skills tool provider from a set of catalog entries. There is one
 * caller (useSkillsProvider) that assembles the entries for every mode — agent or
 * no-agent — so a single `read_skill` surface exists at a time. `read_skill`
 * resolves against the provided list (the caller pre-deduplicates by name) and
 * loads content on demand.
 *
 * Returns null when there are no entries to expose.
 */
export function createSkillsProvider(
  entries: SkillEntry[],
  meta: SkillsProviderMeta,
): ToolProvider | null {
  if (entries.length === 0) return null;

  const byName = new Map(entries.map((e) => [entryKey(e.plugin, e.name), e]));
  const hasResources = entries.some((e) => e.resources?.length && e.loadResource);
  const pluginIds = [...new Set(entries.map((e) => e.plugin).filter((p): p is string => !!p))];

  // Let the interpreter mount resources from this provider's resolved skill
  // set. The user/session owns that selection (for an agent this is its curated
  // agent.skills list); the model only chooses which mounted script to run.
  setSkillResourceResolver(
    meta.id,
    hasResources
      ? async () => {
          const files: ArtifactFiles = {};
          for (const entry of byName.values()) {
            if (!entry?.resources?.length || !entry.loadResource) continue;
            for (const path of entry.resources) {
              const content = await entry.loadResource(path);
              // Leading slash matches the artifact/overlay key convention so the
              // interpreter mounts and strips these consistently.
              if (content != null) files[`/skills/${entry.name}/${path}`] = { content };
            }
          }
          return files;
        }
      : null,
  );

  const tools: Tool[] = [
    {
      name: "read_skill",
      // read_skill takes only a skill name (shown as the header preview) and returns
      // JSON { name, description, instructions } — so hide the args and surface just
      // the instructions.
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
      description: "Read the full content and instructions of an available skill.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            enum: entries.map((entry) => entry.name),
            description: "The name of the skill to read.",
          },
          ...(pluginIds.length
            ? {
                plugin: {
                  type: "string",
                  enum: pluginIds,
                  description:
                    "The plugin that owns the skill. Omit for skills from the personal library or catalog.",
                },
              }
            : {}),
        },
        required: ["name"],
      },
      function: async (args: Record<string, unknown>) => {
        const skillName = args.name as string;
        const pluginId = typeof args.plugin === "string" && args.plugin ? args.plugin : undefined;
        if (!skillName) {
          return [
            { type: "text" as const, text: JSON.stringify({ error: "No skill name provided" }) },
          ];
        }
        const entry = byName.get(entryKey(pluginId, skillName));
        if (!entry) {
          return [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Skill "${skillName}" not found` }),
            },
          ];
        }
        let content: string;
        try {
          content = await entry.loadContent();
        } catch {
          return [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Failed to load skill "${skillName}"` }),
            },
          ];
        }
        return [
          {
            type: "text" as const,
            text: JSON.stringify(skillContentResult(entry, content)),
          },
        ];
      },
    },
  ];

  if (hasResources) {
    tools.push({
      name: "read_skill_resource",
      display: {
        header: (args, state) => ({
          icon: FileCode2,
          label: state.error ? "Resource unavailable" : "Read skill resource",
          preview:
            typeof args?.name === "string" && typeof args?.path === "string"
              ? `${args.name}/${args.path}`
              : undefined,
        }),
        input: () => [],
        output: (result) => {
          const part = result.find((c) => c.type === "text");
          const raw = part && part.type === "text" ? part.text : undefined;
          if (!raw) return null;
          try {
            const parsed = JSON.parse(raw) as { path?: unknown; content?: unknown };
            return typeof parsed.content === "string" && typeof parsed.path === "string"
              ? {
                  code: parsed.content,
                  language: artifactLanguage(parsed.path) || "text",
                  name: parsed.path,
                }
              : null;
          } catch {
            return null;
          }
        },
      },
      description:
        "Read a bundled support resource for an available skill. Use only exact resource paths listed by read_skill.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            enum: entries
              .filter((entry) => entry.resources?.length && entry.loadResource)
              .map((entry) => entry.name),
            description: "The name of the skill that owns the resource.",
          },
          path: {
            type: "string",
            description: "The exact resource path relative to the skill folder.",
          },
          ...(pluginIds.length
            ? {
                plugin: {
                  type: "string",
                  enum: pluginIds,
                  description:
                    "The plugin that owns the skill. Omit for skills from the personal library or catalog.",
                },
              }
            : {}),
        },
        required: ["name", "path"],
      },
      function: async (args: Record<string, unknown>) => {
        const skillName = args.name as string;
        const resourcePath = args.path as string;
        const pluginId = typeof args.plugin === "string" && args.plugin ? args.plugin : undefined;
        if (!skillName || !resourcePath) {
          return [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Skill name and resource path required" }),
            },
          ];
        }

        const entry = byName.get(entryKey(pluginId, skillName));
        if (!entry) {
          return [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Skill "${skillName}" not found` }),
            },
          ];
        }

        if (!entry.resources?.includes(resourcePath) || !entry.loadResource) {
          return [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Resource "${resourcePath}" not listed for skill "${skillName}"`,
                resources: entry.resources ?? [],
              }),
            },
          ];
        }

        let content: string | null;
        try {
          content = await entry.loadResource(resourcePath);
        } catch {
          content = null;
        }
        if (content === null) {
          return [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Failed to load resource "${resourcePath}" for skill "${skillName}"`,
              }),
            },
          ];
        }

        return [
          {
            type: "text" as const,
            text: JSON.stringify({ name: entry.name, path: resourcePath, content }),
          },
        ];
      },
    });
  }

  const skillsXml = entries
    .map(
      (entry) =>
        `  <skill${entry.plugin ? ` plugin="${escapeXml(entry.plugin)}"` : ""}>\n    <name>${escapeXml(entry.name)}</name>\n    <description>${escapeXml(entry.description)}</description>\n  </skill>`,
    )
    .join("\n");

  // Only describe read_skill_resource when it's actually registered (some skill
  // ships resources), so the prompt never references an absent tool.
  const resourcesGuidance = hasResources
    ? "\n### Bundled resources\n\nSome skills ship support files (scripts, references, assets). When `read_skill` lists them, load one with `read_skill_resource` only when the instructions reference it or the task clearly needs it — respect progressive disclosure, don't eagerly load every file, and use the exact paths returned by `read_skill`. The selected skills' resources are mounted read-only in the code interpreter under `skills/<name>/`, so run scripts from that exact path instead of pasting their bodies.\n"
    : "";

  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    icon: Sparkles,
    instructions:
      skillsPrompt
        .replace("{resourcesGuidance}", resourcesGuidance)
        .replace("{skillsXml}", skillsXml) || undefined,
    tools,
  };
}

function skillContentResult(entry: SkillEntry, instructions: string) {
  const resources = entry.resources ?? [];
  const compatibilityNote = entry.compatibility
    ? `\n\n<compatibility>${escapeXml(entry.compatibility)}</compatibility>`
    : "";
  const resourceList = resources.length
    ? `\n\n<skill_resources>\n${resources.map((path) => `  <file>${escapeXml(path)}</file>`).join("\n")}\n</skill_resources>`
    : "";
  return {
    name: entry.name,
    description: entry.description,
    ...(entry.compatibility ? { compatibility: entry.compatibility } : {}),
    instructions: `<skill_content name="${escapeXml(entry.name)}">\n${instructions}${compatibilityNote}${resourceList}\n</skill_content>`,
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
