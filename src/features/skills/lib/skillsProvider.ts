import { convertSchemaToJsonSchema, type Tool as NativeTool } from "@tanstack/ai";
import { createLoadSkillTool, createResourceTool, renderCatalog, withSkills } from "@tanstack/ai-skills";
import { FileCode2, ScrollText, Sparkles } from "lucide-react";
import type { Skill } from "@/features/skills/lib/skillParser";
import { loadSkillResource, type SkillTemplate } from "@/features/skills/lib/templates";
import skillsPrompt from "@/features/skills/prompts/skills.txt?raw";
import type { ArtifactFiles } from "@/features/tools/lib/interpreterProtocol";
import { setSkillResourceResolver } from "@/features/tools/lib/skillResourceMount";
import { artifactLanguage } from "@/shared/lib/fileTypes";
import type { Tool, ToolProvider } from "@/shared/types/chat";
import { createSkillSource, skillMetadata } from "./skillSource";

/** Provider id for the app's single skills tool. */
export const SKILLS_PROVIDER_ID = "skills";

/**
 * Which independently-toggled sources the Skills tool exposes (no-agent mode).
 * The Studio skill pack is intentionally absent here — it's slaved to the Studio
 * capability and passed to the provider as a separate `studioEnabled` flag, not
 * a user-toggled source.
 */
export interface SkillSources {
  /** The user's own editable OPFS skills. */
  personal: boolean;
}

/**
 * One skill exposed by the catalog. Content is loaded on demand so eager
 * sources (the in-memory OPFS library) and lazy ones (shipped templates fetched
 * over HTTP) can be combined behind a single `load_skill`.
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

/**
 * Adapt the shipped Studio skill pack (content fetched lazily) to catalog
 * entries, so the Skills tool resolves `load_skill` / `read_skill_resource`
 * identically across sources. Name collisions across sources are resolved by
 * the caller's single dedup (push order = precedence), not here.
 */
export function studioTemplateEntries(
  templates: SkillTemplate[],
  loadTemplate: (path: string) => Promise<{ content: string } | null>,
): SkillEntry[] {
  return templates
    .filter((t) => t.category === "studio")
    .map((t) => ({
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

/** Shared chat/voice tools backed by TanStack's portable skills API. */
export function createSkillsProvider(entries: SkillEntry[], meta: SkillsProviderMeta): ToolProvider | null {
  if (entries.length === 0) {
    setSkillResourceResolver(meta.id, null);
    return null;
  }

  const source = createSkillSource(entries);
  const skills = entries.map(skillMetadata);
  const hasResources = entries.some((entry) => entry.resources?.length && entry.loadResource);
  const resourceTools = hasResources ? [displaySkillTool(createResourceTool(source))] : [];
  const instructions = [
    skillsPrompt,
    hasResources
      ? "Selected skill files are available in both code interpreters under /skills/<skill-name>/ (Python: /home/user/skills/<skill-name>/). Run a compatible script with the executor's path and optional args instead of pasting its body. Treat bundled resources as read-only; save outputs elsewhere in the workspace."
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // The user/agent selection owns these mounts. Native source checks also guard
  // interpreter reads, and qualified names keep plugin resources from colliding.
  setSkillResourceResolver(
    meta.id,
    hasResources
      ? async () => {
          const files: ArtifactFiles = {};
          for (const skill of skills) {
            for (const path of await source.listResources(skill.name)) {
              const content = await source.readResource(skill.name, path).catch(() => null);
              if (content !== null) files[`/skills/${skill.name}/${path}`] = { content };
            }
          }
          return files;
        }
      : null,
  );

  return {
    ...meta,
    icon: Sparkles,
    instructions: `${instructions}\n\n${renderCatalog(skills, "openai")}`,
    // Realtime has no chat middleware. Each tools request gets its own native
    // activation set, so independent voice sessions cannot suppress each other.
    get tools() {
      return [displaySkillTool(createLoadSkillTool({ source, skills, activated: new Set() })), ...resourceTools];
    },
    chat: { tools: resourceTools, instructions, middleware: [withSkills(source)] },
  };
}

/** Keep native schemas and results; only adapt the workspace's display/storage boundary. */
function displaySkillTool(tool: NativeTool): Tool {
  const resource = tool.name === "read_skill_resource";
  return {
    name: tool.name,
    description: tool.description,
    parameters: convertSchemaToJsonSchema(tool.inputSchema)!,
    function: async (args) => {
      return [{ type: "text", text: JSON.stringify(await tool.execute!(args)) }];
    },
    display: {
      header: (args, state) => ({
        icon: resource ? FileCode2 : ScrollText,
        label: state.error
          ? resource
            ? "Resource unavailable"
            : "Skill unavailable"
          : resource
            ? "Read skill resource"
            : "Read skill",
        preview:
          resource && typeof args?.skill === "string" && typeof args?.path === "string"
            ? `${args.skill}/${args.path}`
            : undefined,
      }),
      input: () => [],
      output: (result) => {
        const raw = result.find((part) => part.type === "text")?.text;
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw) as { content?: unknown; path?: unknown };
          if (typeof parsed.content !== "string") return null;
          const path = typeof parsed.path === "string" ? parsed.path : undefined;
          return {
            code: parsed.content,
            language: path ? artifactLanguage(path) || "text" : "markdown",
            name: path ?? "Instructions",
          };
        } catch {
          return null;
        }
      },
    },
  };
}
