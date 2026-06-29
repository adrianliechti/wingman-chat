import { FilePlus2, PenTool, SquarePen } from "lucide-react";
import { useMemo } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { validateSkillDescription, validateSkillName } from "@/features/skills/lib/skillParser";
import skillBuilderPrompt from "@/features/skills/prompts/skill-builder.txt?raw";
import type { Tool, ToolProvider } from "@/shared/types/chat";
import { useSkills } from "./useSkills";

/** Provider id of the "Skill Builder" tool (create/update/delete skills). */
export const SKILL_BUILDER_ID = "skill-builder";

export function useSkillBuilderProvider(): ToolProvider {
  const { skills, getSkill, addSkill, updateSkill: updateSkillInLibrary, removeSkill } = useSkills();
  const { currentAgent, updateAgent } = useAgents();

  return useMemo<ToolProvider>(() => {
    const tools: Tool[] = [
      {
        name: "list_skills",
        description:
          "List the skills already in the library (name and description only). Use it to avoid creating duplicates and to find the exact name of a skill to update.",
        parameters: {
          type: "object",
          properties: {},
        },
        function: async () => {
          const list = skills.map((s) => ({ name: s.name, description: s.description }));
          return [{ type: "text" as const, text: JSON.stringify({ skills: list }) }];
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
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "Skill name: lowercase alphanumeric and hyphens only, 1-64 chars. No leading/trailing/consecutive hyphens.",
            },
            description: {
              type: "string",
              description:
                "What the skill does and when to use it — this is how the skill is matched to a request (max 1024 chars).",
            },
            content: {
              type: "string",
              description: "The full markdown content/instructions for the skill.",
            },
          },
          required: ["name", "description", "content"],
        },
        function: async (args: Record<string, unknown>) => {
          const name = (args.name as string)?.trim();
          const description = (args.description as string)?.trim();
          const content = (args.content as string)?.trim();

          if (!name || !description || !content) {
            return [
              {
                type: "text" as const,
                text: JSON.stringify({ error: "name, description, and content are all required" }),
              },
            ];
          }

          const nameValidation = validateSkillName(name);
          if (!nameValidation.valid) {
            return [{ type: "text" as const, text: JSON.stringify({ error: nameValidation.error }) }];
          }

          const descriptionValidation = validateSkillDescription(description);
          if (!descriptionValidation.valid) {
            return [{ type: "text" as const, text: JSON.stringify({ error: descriptionValidation.error }) }];
          }

          const existing = getSkill(name);
          if (existing) {
            return [
              {
                type: "text" as const,
                text: JSON.stringify({ error: `Skill "${name}" already exists. Use update_skill to modify it.` }),
              },
            ];
          }

          const skill = addSkill({ name, description, content });

          // Auto-enable the new skill on the current agent
          if (currentAgent) {
            const currentSkills = currentAgent.skills || [];
            if (!currentSkills.includes(name)) {
              updateAgent(currentAgent.id, { skills: [...currentSkills, name] });
            }
          }

          return [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                enabledOnAgent: currentAgent ? currentAgent.name : null,
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
          "Replace an existing skill's description and/or content. This overwrites the field wholesale — pass the complete new value, not a diff. Read the skill's current content first (read_skill or list_skills) before modifying one you didn't just author.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The name of the skill to update.",
            },
            description: {
              type: "string",
              description: "New description (optional, omit to keep current).",
            },
            content: {
              type: "string",
              description: "New markdown content/instructions (optional, omit to keep current).",
            },
          },
          required: ["name"],
        },
        function: async (args: Record<string, unknown>) => {
          const name = (args.name as string)?.trim();
          if (!name) {
            return [{ type: "text" as const, text: JSON.stringify({ error: "Skill name is required" }) }];
          }

          const existing = getSkill(name);
          if (!existing) {
            return [{ type: "text" as const, text: JSON.stringify({ error: `Skill "${name}" not found` }) }];
          }

          const updates: Partial<{ description: string; content: string }> = {};
          if (args.description !== undefined) {
            const desc = (args.description as string).trim();
            const descriptionValidation = validateSkillDescription(desc);
            if (!descriptionValidation.valid) {
              return [{ type: "text" as const, text: JSON.stringify({ error: descriptionValidation.error }) }];
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
                text: JSON.stringify({ error: "No updates provided. Supply description and/or content." }),
              },
            ];
          }

          updateSkillInLibrary(existing.id, updates);

          return [{ type: "text" as const, text: JSON.stringify({ success: true, skill: { name, ...updates } }) }];
        },
      },
      {
        name: "delete_skill",
        description:
          "Permanently delete a skill from the library. This cannot be undone — confirm with the user before deleting a skill you didn't just create. If the active agent has the skill enabled, it is also removed from that agent.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The name of the skill to delete.",
            },
          },
          required: ["name"],
        },
        function: async (args: Record<string, unknown>) => {
          const name = (args.name as string)?.trim();
          if (!name) {
            return [{ type: "text" as const, text: JSON.stringify({ error: "Skill name is required" }) }];
          }

          const existing = getSkill(name);
          if (!existing) {
            return [{ type: "text" as const, text: JSON.stringify({ error: `Skill "${name}" not found` }) }];
          }

          removeSkill(existing.id);

          // Drop the now-deleted skill from the active agent (symmetric with
          // create_skill's auto-enable); references on other agents are harmless
          // — they're filtered out when their skills are resolved.
          let removedFromAgent: string | null = null;
          if (currentAgent && (currentAgent.skills || []).includes(name)) {
            updateAgent(currentAgent.id, { skills: currentAgent.skills.filter((s) => s !== name) });
            removedFromAgent = currentAgent.name;
          }

          return [{ type: "text" as const, text: JSON.stringify({ success: true, deleted: name, removedFromAgent }) }];
        },
      },
    ];

    return {
      id: SKILL_BUILDER_ID,
      name: "Skill Builder",
      description: "Create and edit skills",
      icon: PenTool,
      instructions: skillBuilderPrompt || undefined,
      tools,
    };
  }, [skills, getSkill, addSkill, updateSkillInLibrary, removeSkill, currentAgent, updateAgent]);
}
