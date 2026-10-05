import { z } from "zod";
import { FilePlus2, FileText, PenTool, SquarePen } from "lucide-react";
import { useMemo } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import type { SkillResource } from "@/features/skills/lib/skillParser";
import {
  validateSkillDescription,
  validateSkillName,
  validateSkillResourcePath,
} from "@/features/skills/lib/skillParser";
import skillBuilderPrompt from "@/features/skills/prompts/skill-builder.txt?raw";
import { inferContentTypeFromPath, isTextContentType } from "@/shared/lib/fileTypes";
import { isDataUrl } from "@/shared/lib/opfs-core";
import type { Tool, ToolProvider } from "@/shared/types/chat";
import { useSkills } from "./useSkills";

const resourceInputSchema = z.strictObject({
  path: z.string().describe('Path relative to the skill folder, e.g. "references/guide.md" or "scripts/extract.py".'),
  content: z.string().describe("Complete text content of the file."),
});

const jsonResult = (value: unknown) => [{ type: "text" as const, content: JSON.stringify(value) }];

/** Validate a model-supplied text resource and build it with its inferred content type. */
function buildTextResource(path: unknown, content: unknown): { resource: SkillResource } | { error: string } {
  const trimmed = typeof path === "string" ? path.trim() : "";
  const validation = validateSkillResourcePath(trimmed);
  if (!validation.valid) return { error: validation.error ?? "Invalid resource path" };
  if (typeof content !== "string") return { error: `Resource "${trimmed}" needs text content` };
  const contentType = inferContentTypeFromPath(trimmed);
  if (!isTextContentType(contentType)) {
    return {
      error: `Resource "${trimmed}" is a binary file type; only text resources can be created here`,
    };
  }
  return { resource: { path: trimmed, content, contentType } };
}

export function useSkillBuilderProvider(): ToolProvider {
  const { skills, getSkill, addSkill, updateSkill: updateSkillInLibrary, removeSkill } = useSkills();
  const { currentAgent, updateAgent, getAgent } = useAgents();

  return useMemo<ToolProvider>(() => {
    // Read the agent's latest skills at call time: several tool calls can run
    // before React re-renders, so the captured `currentAgent` may be stale.
    const setSkillEnabled = (name: string, enabled: boolean) => {
      const agent = currentAgent ? (getAgent(currentAgent.id) ?? currentAgent) : undefined;
      if (!agent) return null;
      const current = agent.skills ?? [];
      const changed = enabled !== current.includes(name);
      if (changed) {
        updateAgent(agent.id, {
          skills: enabled ? [...current, name] : current.filter((s) => s !== name),
        });
      }
      return { agentName: agent.name, changed };
    };

    const tools: Tool[] = [
      {
        name: "list_skills",
        description:
          "List personal library skills (name and description), or pass name to read one skill's full current content and resource paths before editing; add resource to read one bundled file in full. This reads the library regardless of which skills are active; it does not activate the skill.",
        inputSchema: z.strictObject({
          name: z.string().describe("Exact personal skill name to read; omit to list metadata.").optional(),
          resource: z
            .string()
            .describe("With name: path of one bundled resource whose full content should be returned.")
            .optional(),
        }),
        execute: async (args: Record<string, unknown>) => {
          if (args.name !== undefined) {
            const name = typeof args.name === "string" ? args.name.trim() : "";
            const skill = name ? getSkill(name) : undefined;
            if (skill && args.resource !== undefined) {
              const path = typeof args.resource === "string" ? args.resource.trim() : "";
              const resource = skill.resources?.find((r) => r.path === path);
              if (!resource)
                return jsonResult({
                  error: `Resource "${path}" not found in skill "${name}"`,
                });
              if (isDataUrl(resource.content)) {
                return jsonResult({
                  resource: {
                    path: resource.path,
                    binary: true,
                    contentType: resource.contentType,
                  },
                });
              }
              return jsonResult({
                resource: { path: resource.path, content: resource.content },
              });
            }
            return jsonResult(
              skill
                ? {
                    skill: {
                      name: skill.name,
                      description: skill.description,
                      content: skill.content,
                      compatibility: skill.compatibility,
                      resources: skill.resources?.map((resource) => resource.path) ?? [],
                    },
                  }
                : {
                    error: name ? `Skill "${name}" not found in the personal library` : "Skill name is required",
                  },
            );
          }
          const list = skills.map((s) => ({ name: s.name, description: s.description }));
          return jsonResult({ skills: list });
        },
      },
      {
        name: "create_skill",
        display: {
          header: (_args, state) => ({
            icon: FilePlus2,
            label: state.error ? "Create failed" : state.running ? "Creating skill…" : "Created skill",
          }),
          // Show just the SKILL.md content (the name/description are metadata).
          input: (args) => {
            const content = typeof args?.content === "string" ? args.content : "";
            return content ? [{ code: content, language: "markdown" }] : [];
          },
        },
        description:
          "Create a new skill and add it to the library. Skills are reusable, specialized prompts with a name, description, and markdown content body, plus optional bundled text resources. When an agent is active, the new skill is also enabled on it.",
        inputSchema: z.strictObject({
          name: z
            .string()
            .describe(
              "Skill name: lowercase alphanumeric and hyphens only, 1-64 chars. No leading/trailing/consecutive hyphens.",
            ),
          description: z
            .string()
            .describe(
              "What the skill does and when to use it — this is how the skill is matched to a request (max 1024 chars).",
            ),
          content: z.string().describe("The full markdown content/instructions for the skill."),
          resources: z
            .array(resourceInputSchema)
            .describe(
              "Optional text files bundled with the skill (references, templates, scripts). Reference them from the content by path.",
            )
            .optional(),
        }),
        execute: async (args: Record<string, unknown>) => {
          const name = (args.name as string)?.trim();
          const description = (args.description as string)?.trim();
          const content = (args.content as string)?.trim();

          if (!name || !description || !content) {
            return jsonResult({ error: "name, description, and content are all required" });
          }

          const nameValidation = validateSkillName(name);
          if (!nameValidation.valid) {
            return jsonResult({ error: nameValidation.error });
          }

          const descriptionValidation = validateSkillDescription(description);
          if (!descriptionValidation.valid) {
            return jsonResult({ error: descriptionValidation.error });
          }

          const existing = getSkill(name);
          if (existing) {
            return jsonResult({
              error: `Skill "${name}" already exists. Use update_skill to modify it.`,
            });
          }

          const resources = new Map<string, SkillResource>();
          for (const input of Array.isArray(args.resources) ? args.resources : []) {
            const built = buildTextResource(input?.path, input?.content);
            if ("error" in built) return jsonResult({ error: built.error });
            resources.set(built.resource.path, built.resource);
          }

          const skill = addSkill({
            name,
            description,
            content,
            ...(resources.size
              ? {
                  resources: [...resources.values()].sort((a, b) => a.path.localeCompare(b.path)),
                }
              : {}),
          });

          // Auto-enable the new skill on the current agent
          const enabledOnAgent = setSkillEnabled(name, true)?.agentName ?? null;

          return jsonResult({
            success: true,
            enabledOnAgent,
            skill: {
              name: skill.name,
              description: skill.description,
              resources: skill.resources?.map((r) => r.path) ?? [],
            },
          });
        },
      },
      {
        name: "update_skill",
        display: {
          header: (_args, state) => ({
            icon: SquarePen,
            label: state.error ? "Update failed" : state.running ? "Updating skill…" : "Updated skill",
          }),
          input: (args) => {
            const content = typeof args?.content === "string" ? args.content : "";
            return content ? [{ code: content, language: "markdown" }] : [];
          },
        },
        description:
          "Replace an existing personal skill's description and/or content. Fields are replaced wholesale: pass complete values, not diffs. Read the current library content with list_skills({name}) first; load_skill may resolve a different active skill with the same name. Bundled resources are preserved; manage them with write_skill_resource / delete_skill_resource.",
        inputSchema: z.strictObject({
          name: z.string().describe("The name of the skill to update."),
          description: z.string().describe("New description (optional, omit to keep current).").optional(),
          content: z
            .string()
            .describe("New markdown content/instructions (optional, omit to keep current).")
            .optional(),
        }),
        execute: async (args: Record<string, unknown>) => {
          const name = (args.name as string)?.trim();
          if (!name) {
            return jsonResult({ error: "Skill name is required" });
          }

          const existing = getSkill(name);
          if (!existing) {
            return jsonResult({ error: `Skill "${name}" not found` });
          }

          const updates: Partial<{ description: string; content: string }> = {};
          if (args.description !== undefined) {
            const desc = (args.description as string).trim();
            const descriptionValidation = validateSkillDescription(desc);
            if (!descriptionValidation.valid) {
              return jsonResult({ error: descriptionValidation.error });
            }
            updates.description = desc;
          }
          if (args.content !== undefined) {
            updates.content = (args.content as string).trim();
          }

          if (Object.keys(updates).length === 0) {
            return jsonResult({ error: "No updates provided. Supply description and/or content." });
          }

          updateSkillInLibrary(existing.id, updates);

          return jsonResult({
            success: true,
            skill: { name, ...updates },
          });
        },
      },
      {
        name: "write_skill_resource",
        display: {
          header: (args, state) => ({
            icon: FileText,
            label: state.error
              ? "Resource failed"
              : state.running
                ? `Writing ${typeof args?.path === "string" ? args.path : "resource"}…`
                : `Wrote ${typeof args?.path === "string" ? args.path : "resource"}`,
          }),
          input: (args) => {
            const content = typeof args?.content === "string" ? args.content : "";
            return content ? [{ code: content, language: "markdown" }] : [];
          },
        },
        description:
          "Create or overwrite one text resource (reference, template, script) bundled with an existing personal skill. The file is replaced wholesale: pass complete content. Other resources and SKILL.md are untouched. Mention the path in the skill content so it gets used.",
        inputSchema: z.strictObject({
          name: z.string().describe("The name of the skill to attach the resource to."),
          ...resourceInputSchema.shape,
        }),
        execute: async (args: Record<string, unknown>) => {
          const name = (args.name as string)?.trim();
          if (!name) return jsonResult({ error: "Skill name is required" });
          const existing = getSkill(name);
          if (!existing) return jsonResult({ error: `Skill "${name}" not found` });

          const built = buildTextResource(args.path, args.content);
          if ("error" in built) return jsonResult({ error: built.error });
          const { resource } = built;

          const current = existing.resources ?? [];
          const replaced = current.some((r) => r.path === resource.path);
          updateSkillInLibrary(existing.id, {
            resources: [...current.filter((r) => r.path !== resource.path), resource].sort((a, b) =>
              a.path.localeCompare(b.path),
            ),
          });

          return jsonResult({
            success: true,
            skill: name,
            path: resource.path,
            replaced,
          });
        },
      },
      {
        name: "delete_skill_resource",
        display: {
          header: (args, state) => ({
            icon: FileText,
            label: state.error
              ? "Delete failed"
              : state.running
                ? `Removing ${typeof args?.path === "string" ? args.path : "resource"}…`
                : `Removed ${typeof args?.path === "string" ? args.path : "resource"}`,
          }),
        },
        description:
          "Permanently remove one bundled resource from a personal skill. Confirm with the user first unless you added it this turn, and update the skill content if it references the file.",
        inputSchema: z.strictObject({
          name: z.string().describe("The name of the skill."),
          path: z.string().describe("Path of the resource to remove, as listed by list_skills({name})."),
        }),
        execute: async (args: Record<string, unknown>) => {
          const name = (args.name as string)?.trim();
          const path = typeof args.path === "string" ? args.path.trim() : "";
          if (!name || !path) return jsonResult({ error: "Skill name and resource path are required" });
          const existing = getSkill(name);
          if (!existing) return jsonResult({ error: `Skill "${name}" not found` });

          const current = existing.resources ?? [];
          if (!current.some((r) => r.path === path)) {
            return jsonResult({
              error: `Resource "${path}" not found in skill "${name}"`,
            });
          }
          updateSkillInLibrary(existing.id, {
            resources: current.filter((r) => r.path !== path),
          });

          return jsonResult({ success: true, skill: name, deleted: path });
        },
      },
      {
        name: "delete_skill",
        description:
          "Permanently delete a skill from the library. This cannot be undone — confirm with the user before deleting a skill you didn't just create. If the active agent has the skill enabled, it is also removed from that agent.",
        inputSchema: z.strictObject({
          name: z.string().describe("The name of the skill to delete."),
        }),
        execute: async (args: Record<string, unknown>) => {
          const name = (args.name as string)?.trim();
          if (!name) {
            return jsonResult({ error: "Skill name is required" });
          }

          const existing = getSkill(name);
          if (!existing) {
            return jsonResult({ error: `Skill "${name}" not found` });
          }

          removeSkill(existing.id);

          // Drop the now-deleted skill from the active agent (symmetric with
          // create_skill's auto-enable); references on other agents are harmless
          // — they're filtered out when their skills are resolved.
          const removal = setSkillEnabled(name, false);
          const removedFromAgent = removal?.changed ? removal.agentName : null;

          return jsonResult({
            success: true,
            deleted: name,
            removedFromAgent,
          });
        },
      },
    ];

    return {
      id: "skill-builder",
      name: "Skill Builder",
      description: "Create and edit skills",
      icon: PenTool,
      instructions: skillBuilderPrompt || undefined,
      tools,
    };
  }, [skills, getSkill, addSkill, updateSkillInLibrary, removeSkill, currentAgent, updateAgent, getAgent]);
}
