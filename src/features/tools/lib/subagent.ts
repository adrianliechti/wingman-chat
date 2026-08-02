import subagentDescription from "@/features/tools/prompts/subagent-description.txt?raw";
import subagentSystem from "@/features/tools/prompts/subagent-system.txt?raw";
import { getConfig } from "@/shared/config";
import { run as agentRun } from "@/shared/lib/agent";
import { getTextFromContent, Role, type Tool } from "@/shared/types/chat";

export function createSubagentTool(model: string, providerInstructions: string, baseTools: Tool[]): Tool {
  const baseInstructions = subagentSystem.trim();
  const extra = providerInstructions.trim();
  const instructions = extra ? `${baseInstructions}\n\n${extra}` : baseInstructions;

  return {
    name: "agent",
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
    function: async (args, ctx) => {
      const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
      if (!prompt) {
        return [{ type: "text", text: "Error: prompt is required" }];
      }

      try {
        const runResult = await agentRun(
          getConfig().client,
          model,
          instructions,
          [{ role: Role.User, content: [{ type: "text", text: prompt }] }],
          baseTools,
          {
            agentName: "subagent",
            parentContext: ctx?.agentContext,
            invocationContext: ctx?.invocationContext?.fork("subagent"),
            options: { signal: ctx?.signal },
            createToolContext: () => ({ model }),
          },
        );

        if (runResult.status === "aborted") {
          return [{ type: "text", text: "Subagent interrupted before finishing." }];
        }
        if (runResult.status === "failed") {
          return [{ type: "text", text: `Subagent error: ${runResult.error?.message ?? "Unknown error"}` }];
        }

        const conversation = runResult.messages;
        const last = conversation[conversation.length - 1];
        const text = last ? getTextFromContent(last.content).trim() : "";
        const suffix = runResult.status === "max_turns" ? "\n\n[Stopped: turn limit reached before finishing.]" : "";
        return [{ type: "text", text: `${text || "Subagent completed but produced no output."}${suffix}` }];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return [{ type: "text", text: `Subagent error: ${message}` }];
      }
    },
  };
}
