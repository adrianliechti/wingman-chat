import subagentDescription from "@/features/tools/prompts/subagent-description.txt?raw";
import subagentSystem from "@/features/tools/prompts/subagent-system.txt?raw";
import { run as agentRun } from "@/shared/lib/agent";
import { getConfig } from "@/shared/config";
import { getTextFromContent, Role, type Tool } from "@/shared/types/chat";

const SUBAGENT_NAME = "agent";

export function createSubagentTool(
  model: string,
  providerInstructions: string,
  baseTools: Tool[],
): Tool {
  const baseInstructions = subagentSystem.trim();
  const extra = providerInstructions.trim();
  const instructions = extra ? `${baseInstructions}\n\n${extra}` : baseInstructions;

  return {
    name: SUBAGENT_NAME,
    description: subagentDescription.trim(),
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "A clear, self-contained task description for the agent. Include all necessary context since it has no access to the current conversation.",
        },
      },
      required: ["prompt"],
    },
    function: async (args) => {
      const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
      if (!prompt) {
        return [{ type: "text", text: "Error: prompt is required" }];
      }

      try {
        const conversation = await agentRun(
          getConfig().client,
          model,
          instructions,
          [{ role: Role.User, content: [{ type: "text", text: prompt }] }],
          baseTools,
        );

        const last = conversation[conversation.length - 1];
        const text = last ? getTextFromContent(last.content).trim() : "";
        return [{ type: "text", text: text || "Subagent completed but produced no output." }];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return [{ type: "text", text: `Subagent error: ${message}` }];
      }
    },
  };
}

export const SUBAGENT_TOOL_NAME = SUBAGENT_NAME;
