import { PenTool } from "lucide-react";
import { useMemo } from "react";
import { useAgents } from "@/features/agent/hooks/useAgents";
import { validateSkillName } from "@/features/skills/lib/skillParser";
import type { Tool, ToolProvider } from "@/shared/types/chat";
import { useSkills } from "./useSkills";

export function useSkillBuilderProvider(): ToolProvider {
  const { getSkill, addSkill, updateSkill: updateSkillInLibrary } = useSkills();
  const { currentAgent, updateAgent } = useAgents();

  return useMemo<ToolProvider>(() => {
    const tools: Tool[] = [
      {
        name: "create_skill",
        description:
          "Create a new skill. Skills are specialized prompts with a name, description, and markdown content body. The skill is automatically enabled on the current agent.",
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
              description: "Short description of what the skill does (max 1024 chars).",
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

          const validation = validateSkillName(name);
          if (!validation.valid) {
            return [{ type: "text" as const, text: JSON.stringify({ error: validation.error }) }];
          }

          if (description.length > 1024) {
            return [
              { type: "text" as const, text: JSON.stringify({ error: "Description must be 1024 characters or less" }) },
            ];
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
              text: JSON.stringify({ success: true, skill: { name: skill.name, description: skill.description } }),
            },
          ];
        },
      },
      {
        name: "update_skill",
        description: "Update an existing skill's description and/or content.",
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
            if (desc.length > 1024) {
              return [
                {
                  type: "text" as const,
                  text: JSON.stringify({ error: "Description must be 1024 characters or less" }),
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
                text: JSON.stringify({ error: "No updates provided. Supply description and/or content." }),
              },
            ];
          }

          updateSkillInLibrary(existing.id, updates);

          return [{ type: "text" as const, text: JSON.stringify({ success: true, skill: { name, ...updates } }) }];
        },
      },
    ];

    return {
      id: "skill-builder",
      name: "Skill Builder",
      description: "Create and edit skills",
      icon: PenTool,
      tools,
    };
  }, [getSkill, addSkill, updateSkillInLibrary, currentAgent, updateAgent]);
}
