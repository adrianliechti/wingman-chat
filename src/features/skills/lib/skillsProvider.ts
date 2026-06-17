import { FileCode2, ScrollText, Sparkles } from "lucide-react";
import type { Skill } from "@/features/skills/lib/skillParser";
import skillsPrompt from "@/features/skills/prompts/skills.txt?raw";
import type { ArtifactFiles } from "@/features/tools/lib/interpreterProtocol";
import { setSkillResourceResolver } from "@/features/tools/lib/skillResourceMount";
import { artifactLanguage } from "@/shared/lib/fileTypes";
import type { Tool, ToolProvider } from "@/shared/types/chat";

/** Shared provider id for the skills tool (global and agent-scoped never coexist). */
export const SKILLS_PROVIDER_ID = "skills";

/**
 * Which sources the global Skills tool exposes. Both may be enabled at once; a
 * personal skill shadows a shipped template of the same name (personal wins).
 */
export interface SkillSources {
  /** The user's own editable OPFS skills. */
  personal: boolean;
  /** The shipped template catalog (excludes the Notebook generation pack). */
  catalog: boolean;
  /** The Notebook generation pack — output-generation skills and their styles. */
  notebook: boolean;
}

/**
 * Catalog categories (the first path segment of a template's SKILL.md, e.g.
 * `skills/<category>/<name>/SKILL.md`) that make up the toggleable "Notebook"
 * generation pack. These are surfaced as their own Skills source so the chat
 * generation skills + their styles don't crowd the general catalog.
 */
export const NOTEBOOK_SKILL_CATEGORIES = new Set(["notebook", "generation"]);
export const isNotebookSkillCategory = (category: string): boolean => NOTEBOOK_SKILL_CATEGORIES.has(category);

/**
 * One skill exposed by the catalog. Content is loaded on demand so eager
 * sources (the in-memory OPFS library) and lazy ones (shipped templates fetched
 * over HTTP) can be combined behind a single `read_skill`.
 */
export interface SkillEntry {
  name: string;
  description: string;
  /** Optional environment requirements (agentskills `compatibility` frontmatter). */
  compatibility?: string;
  /** Bundled resource paths relative to the skill folder, e.g. "scripts/extract.py". */
  resources?: string[];
  loadContent: () => string | Promise<string>;
  loadResource?: (path: string) => string | Promise<string | null>;
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
 * Builds a skills tool provider from a set of catalog entries.
 *
 * Used by two callers, each with its own meta but the same `read_skill` tool
 * and prompt:
 * - Agent-scoped (useAgentProviders): the subset enabled on the active agent.
 * - Global (useSkillsProvider): the user's library, or library + shipped
 *   templates, depending on the selected scope.
 *
 * They differ only in which entries are exposed. `read_skill` resolves against
 * the provided list (the caller pre-deduplicates by name) and loads content on
 * demand.
 *
 * Returns null when there are no entries to expose.
 */
export function createSkillsProvider(entries: SkillEntry[], meta: SkillsProviderMeta): ToolProvider | null {
  if (entries.length === 0) return null;

  const byName = new Map(entries.map((e) => [e.name, e]));
  const hasResources = entries.some((e) => e.resources?.length && e.loadResource);

  // Let the interpreter mount these skills' bundled resources on demand, so the
  // model can run spec-style scripts (`runpy.run_path("skills/<name>/…")`).
  // Safe to set from here: only one skills provider is active at a time.
  setSkillResourceResolver(
    hasResources
      ? async (names) => {
          const files: ArtifactFiles = {};
          for (const name of names) {
            const entry = byName.get(name);
            if (!entry?.resources?.length || !entry.loadResource) continue;
            for (const path of entry.resources) {
              const content = await entry.loadResource(path);
              // Leading slash matches the artifact/overlay key convention so the
              // interpreter mounts and strips these consistently.
              if (content != null) files[`/skills/${name}/${path}`] = { content };
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
        },
        required: ["name"],
      },
      function: async (args: Record<string, unknown>) => {
        const skillName = args.name as string;
        if (!skillName) {
          return [{ type: "text" as const, text: JSON.stringify({ error: "No skill name provided" }) }];
        }
        const entry = byName.get(skillName);
        if (!entry) {
          return [{ type: "text" as const, text: JSON.stringify({ error: `Skill "${skillName}" not found` }) }];
        }
        let content: string;
        try {
          content = await entry.loadContent();
        } catch {
          return [{ type: "text" as const, text: JSON.stringify({ error: `Failed to load skill "${skillName}"` }) }];
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
      description:
        "Read a bundled support resource for an available skill. Use only exact resource paths listed by read_skill.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            enum: entries.filter((entry) => entry.resources?.length && entry.loadResource).map((entry) => entry.name),
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
        if (!skillName || !resourcePath) {
          return [{ type: "text" as const, text: JSON.stringify({ error: "Skill name and resource path required" }) }];
        }

        const entry = byName.get(skillName);
        if (!entry) {
          return [{ type: "text" as const, text: JSON.stringify({ error: `Skill "${skillName}" not found` }) }];
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
              text: JSON.stringify({ error: `Failed to load resource "${resourcePath}" for skill "${skillName}"` }),
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
        `  <skill>\n    <name>${escapeXml(entry.name)}</name>\n    <description>${escapeXml(entry.description)}</description>\n  </skill>`,
    )
    .join("\n");

  // Only describe read_skill_resource when it's actually registered (some skill
  // ships resources), so the prompt never references an absent tool.
  const resourcesGuidance = hasResources
    ? "\n### Bundled resources\n\nSome skills ship support files (scripts, references, assets). When `read_skill` lists them, load one with `read_skill_resource` only when the instructions reference it or the task clearly needs it — respect progressive disclosure, don't eagerly load every file, and use the exact paths returned by `read_skill`. To *run* a bundled script, prefer passing the skill name in the code interpreter's `skills` parameter (it mounts the resources under `skills/<name>/`) over pasting the script body.\n"
    : "";

  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    icon: Sparkles,
    instructions:
      skillsPrompt.replace("{resourcesGuidance}", resourcesGuidance).replace("{skillsXml}", skillsXml) || undefined,
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
