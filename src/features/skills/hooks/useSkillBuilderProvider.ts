import { z } from "zod";
import { FilePlus2, PenTool, SquarePen } from "lucide-react";
import { useMemo } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { validateSkillDescription, validateSkillName } from "@/features/skills/lib/skillParser";
import skillBuilderPrompt from "@/features/skills/prompts/skill-builder.txt?raw";
import type { Tool, ToolProvider } from "@/shared/types/chat";
import { useSkills } from "./useSkills";

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
      if (enabled !== current.includes(name)) {
        updateAgent(agent.id, { skills: enabled ? [...current, name] : current.filter((s) => s !== name) });
      }
      return agent.name;
    };

    const tools: Tool[] = [
      {
        name: "list_skills",
        description:
          "List personal library skills (name and description), or pass name to read one skill's full current content and resource paths before editing. This reads the library regardless of which skills are active; it does not activate the skill.",
        inputSchema: z.strictObject({
          name: z.string().describe("Exact personal skill name to read; omit to list metadata.").optional(),
        }),
        execute: async (args: Record<string, unknown>) => {
          if (args.name !== undefined) {
            const name = typeof args.name === "string" ? args.name.trim() : "";
            const skill = name ? getSkill(name) : undefined;
            return [
              {
                type: "text" as const,
                content: JSON.stringify(
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
                    : { error: name ? `Skill "${name}" not found in the personal library` : "Skill name is required" },
                ),
              },
            ];
          }
          const list = skills.map((s) => ({ name: s.name, description: s.description }));
          return [{ type: "text" as const, content: JSON.stringify({ skills: list }) }];
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
          "Create a new skill and add it to the library. Skills are reusable, specialized prompts with a name, description, and markdown content body. When an agent is active, the new skill is also enabled on it.",
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
        }),
        execute: async (args: Record<string, unknown>) => {
          const name = (args.name as string)?.trim();
          const description = (args.description as string)?.trim();
          const content = (args.content as string)?.trim();

          if (!name || !description || !content) {
            return [
              {
                type: "text" as const,
                content: JSON.stringify({ error: "name, description, and content are all required" }),
              },
            ];
          }

          const nameValidation = validateSkillName(name);
          if (!nameValidation.valid) {
            return [{ type: "text" as const, content: JSON.stringify({ error: nameValidation.error }) }];
          }

          const descriptionValidation = validateSkillDescription(description);
          if (!descriptionValidation.valid) {
            return [
              {
                type: "text" as const,
                content: JSON.stringify({ error: descriptionValidation.error }),
              },
            ];
          }

          const existing = getSkill(name);
          if (existing) {
            return [
              {
                type: "text" as const,
                content: JSON.stringify({
                  error: `Skill "${name}" already exists. Use update_skill to modify it.`,
                }),
              },
            ];
          }

          const skill = addSkill({ name, description, content });

          // Auto-enable the new skill on the current agent
          const enabledOnAgent = setSkillEnabled(name, true);

          return [
            {
              type: "text" as const,
              content: JSON.stringify({
                success: true,
                enabledOnAgent,
                skill: { name: skill.name, description: skill.description },
              }),
            },
          ];
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
          "Replace an existing personal skill's description and/or content. Fields are replaced wholesale: pass complete values, not diffs. Read the current library content with list_skills({name}) first; load_skill may resolve a different active skill with the same name. Bundled resources are preserved.",
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
            return [{ type: "text" as const, content: JSON.stringify({ error: "Skill name is required" }) }];
          }

          const existing = getSkill(name);
          if (!existing) {
            return [
              {
                type: "text" as const,
                content: JSON.stringify({ error: `Skill "${name}" not found` }),
              },
            ];
          }

          const updates: Partial<{ description: string; content: string }> = {};
          if (args.description !== undefined) {
            const desc = (args.description as string).trim();
            const descriptionValidation = validateSkillDescription(desc);
            if (!descriptionValidation.valid) {
              return [
                {
                  type: "text" as const,
                  content: JSON.stringify({ error: descriptionValidation.error }),
                },
              ];
            }
            updates.description = desc;
          }
          if (args.content !== undefined) {
            updates.content = (args.content as string).trim();
          }

          if (Object.keys(updates).length === 0) {
            return [
              {
                type: "text" as const,
                content: JSON.stringify({
                  error: "No updates provided. Supply description and/or content.",
                }),
              },
            ];
          }

          updateSkillInLibrary(existing.id, updates);

          return [
            {
              type: "text" as const,
              content: JSON.stringify({ success: true, skill: { name, ...updates } }),
            },
          ];
        },
      },
      {
        name: "delete_skill",
        description:
          "Permanently delete a skill from the library. This cannot be undone — confirm with the user before deleting a skill you didn't just create. If the active agent has the skill enabled, it is also removed from that agent.",
        inputSchema: z.strictObject({ name: z.string().describe("The name of the skill to delete.") }),
        execute: async (args: Record<string, unknown>) => {
          const name = (args.name as string)?.trim();
          if (!name) {
            return [{ type: "text" as const, content: JSON.stringify({ error: "Skill name is required" }) }];
          }

          const existing = getSkill(name);
          if (!existing) {
            return [
              {
                type: "text" as const,
                content: JSON.stringify({ error: `Skill "${name}" not found` }),
              },
            ];
          }

          removeSkill(existing.id);

          // Drop the now-deleted skill from the active agent (symmetric with
          // create_skill's auto-enable); references on other agents are harmless
          // — they're filtered out when their skills are resolved.
          const removedFromAgent = setSkillEnabled(name, false);

          return [
            {
              type: "text" as const,
              content: JSON.stringify({ success: true, deleted: name, removedFromAgent }),
            },
          ];
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
