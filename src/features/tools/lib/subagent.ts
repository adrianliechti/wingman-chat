import { maxIterations, type ChatMiddleware } from "@tanstack/ai";
import subagentDescription from "@/features/tools/prompts/subagent-description.txt?raw";
import subagentSystem from "@/features/tools/prompts/subagent-system.txt?raw";
import { getConfig } from "@/shared/config";
import { run as agentRun } from "@/shared/lib/agent";
import type { Client } from "@/shared/lib/client";
import { getFinalTextFromContent } from "@/shared/lib/assistantText";
import { captureRequestContext, injectRequestContext } from "@/shared/lib/requestContext";
import { artifactDelta, artifactDeltaFromMeta } from "@/shared/types/artifact";
import { Role, type Tool } from "@/shared/types/chat";

export function createSubagentTool(
  model: string,
  providerInstructions: string,
  baseTools: Tool[],
  runtimeContext?: string,
  middleware?: ChatMiddleware[],
): Tool {
  const baseInstructions = subagentSystem.trim();
  const extra = providerInstructions.trim();
  const instructions = extra ? `${baseInstructions}\n\n${extra}` : baseInstructions;

  return createAgentTool("agent", subagentDescription.trim(), {
    model,
    instructions,
    tools: baseTools,
    runtimeContext,
    middleware,
  });
}

/** Native chat definition and the small text-result boundary required by realtime. */
export function createAgentTool(
  name: string,
  description: string,
  spec: NonNullable<Tool["subagent"]>,
  options: { client?: Client; needsApproval?: boolean } = {},
): Tool {
  return {
    name,
    subagent: spec,
    description,
    needsApproval: options.needsApproval,
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          minLength: 1,
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
      const model = spec.model ?? ctx?.model;
      if (options.needsApproval) {
        if (!ctx?.elicit)
          return [{ type: "text", text: "This task requires confirmation, which is unavailable in this context." }];
        const answer = await ctx.elicit({ message: `${description}\n\n${prompt}` });
        ctx.signal?.throwIfAborted();
        if (answer.action !== "accept") return [{ type: "text", text: "Cancelled by user." }];
      }

      try {
        const timeout = spec.timeoutMs ? AbortSignal.timeout(spec.timeoutMs) : undefined;
        const signal = timeout && ctx?.signal ? AbortSignal.any([ctx.signal, timeout]) : (timeout ?? ctx?.signal);
        signal?.throwIfAborted();
        const direct = await spec.direct?.(args, { ...ctx, model, signal });
        signal?.throwIfAborted();
        if (direct !== undefined) return [{ type: "text", text: direct }];
        if (!model) return [{ type: "text", text: "No model is available for this task." }];
        const requestContext = captureRequestContext(spec.runtimeContext);
        const runResult = await agentRun(
          options.client ?? getConfig().client,
          model,
          spec.instructions,
          [{ role: Role.User, content: [{ type: "text", text: prompt }] }],
          spec.tools,
          {
            agentName: name,
            middleware: spec.middleware,
            parentContext: ctx?.agentContext,
            context: { ...ctx?.invocationContext, subagentRunId: crypto.randomUUID() },
            options: { signal },
            ...(spec.maxIterations ? { agentLoopStrategy: maxIterations(spec.maxIterations) } : {}),
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
        return [{ type: "text", text: text || "Subagent completed but produced no output." }];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return [{ type: "text", text: `Subagent error: ${message}` }];
      }
    },
  };
}
