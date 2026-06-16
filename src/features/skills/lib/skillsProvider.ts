import { ScrollText, Sparkles } from "lucide-react";
import type { Skill } from "@/features/skills/lib/skillParser";
import skillsPrompt from "@/features/skills/prompts/skills.txt?raw";
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
  loadContent: () => string | Promise<string>;
}

/** Adapt in-memory library skills (content already loaded) to catalog entries. */
export function libraryEntries(skills: Skill[]): SkillEntry[] {
  return skills.map((s) => ({
    name: s.name,
    description: s.description,
    loadContent: () => s.content,
  }));
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
            text: JSON.stringify({
              name: entry.name,
              description: entry.description,
              instructions: content,
            }),
          },
        ];
      },
    },
  ];

  const skillsXml = entries
    .map(
      (entry) =>
        `  <skill>\n    <name>${entry.name}</name>\n    <description>${entry.description}</description>\n  </skill>`,
    )
    .join("\n");

  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    icon: Sparkles,
    instructions: skillsPrompt.replace("{skillsXml}", skillsXml) || undefined,
    tools,
  };
}
