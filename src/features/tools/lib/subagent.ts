import type { ChatMiddleware } from "@tanstack/ai";
import subagentDescription from "@/features/tools/prompts/subagent-description.txt?raw";
import subagentSystem from "@/features/tools/prompts/subagent-system.txt?raw";
import { getConfig } from "@/shared/config";
import { run as agentRun } from "@/shared/lib/agent";
import { AgentInvocationContext } from "@/shared/lib/agent-run-controller";
import { getFinalTextFromContent } from "@/shared/lib/assistantText";
import { captureRequestContext, injectRequestContext } from "@/shared/lib/requestContext";
import { artifactDelta, artifactDeltaFromMeta } from "@/shared/types/artifact";
import { Role, type Tool } from "@/shared/types/chat";

export function createSubagentTool(
  model: string,
  providerInstructions: string,
  baseTools: Tool[],
  runtimeContext = "",
  middleware: ChatMiddleware[] = [],
): Tool {
  const baseInstructions = subagentSystem.trim();
  const extra = providerInstructions.trim();
  const instructions = extra ? `${baseInstructions}\n\n${extra}` : baseInstructions;

  return {
    name: "agent",
    subagent: { model, instructions, tools: baseTools, runtimeContext, middleware },
    description: subagentDescription.trim(),
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "A clear, self-contained task description for the agent. Include the task goal, constraints, and expected result.",
        },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    function: async (args, ctx) => {
      const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
      if (!prompt) {
        return [{ type: "text", text: "Error: prompt is required" }];
      }

      try {
        const requestContext = captureRequestContext(runtimeContext);
        const runResult = await agentRun(
          getConfig().client,
          model,
          instructions,
          [{ role: Role.User, content: [{ type: "text", text: prompt }] }],
          baseTools,
          {
            agentName: "subagent",
            middleware,
            parentContext: ctx?.agentContext,
            invocationContext: (ctx?.invocationContext ?? new AgentInvocationContext()).fork("subagent"),
            options: { signal: ctx?.signal },
            createToolContext: () => ({
              model,
              chatId: ctx?.chatId,
              content: ctx?.content?.bind(ctx),
              elicit: ctx?.elicit?.bind(ctx),
              onElicitationComplete: ctx?.onElicitationComplete?.bind(ctx),
            }),
            prepareMessages: (messages) => injectRequestContext(messages, requestContext),
          },
        );

        // File writes belong to the same workspace. Report their mutations on
        // the parent tool result so its completion check can verify them, even
        // if the child failed after committing files.
        const mutations = runResult.messages
          .flatMap((message) => message.content)
          .flatMap((part) => (part.type === "tool_result" ? (artifactDeltaFromMeta(part.meta)?.mutations ?? []) : []));
        if (mutations.length) ctx?.setMeta?.({ artifactDelta: artifactDelta(mutations) });

        if (runResult.status === "aborted") {
          return [{ type: "text", text: "Subagent interrupted before finishing." }];
        }
        if (runResult.status === "failed") {
          return [{ type: "text", text: `Subagent error: ${runResult.error?.message ?? "Unknown error"}` }];
        }
        if (runResult.status === "interrupted") {
          return [{ type: "text", text: "This task needs interactive input. Continue it in chat." }];
        }

        const conversation = runResult.messages;
        const last = conversation[conversation.length - 1];
        const text = last ? getFinalTextFromContent(last.content).trim() : "";
        const suffix = runResult.status === "max_turns" ? "\n\n[Stopped: turn limit reached before finishing.]" : "";
        return [{ type: "text", text: `${text || "Subagent completed but produced no output."}${suffix}` }];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return [{ type: "text", text: `Subagent error: ${message}` }];
      }
    },
  };
}
