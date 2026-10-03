import { z } from "zod";
import { maxIterations, type ChatMiddleware } from "@tanstack/ai";
import subagentDescription from "@/features/tools/prompts/subagent-description.txt?raw";
import subagentSystem from "@/features/tools/prompts/subagent-system.txt?raw";
import { getConfig } from "@/shared/config";
import { run as agentRun } from "@/shared/lib/agent";
import type { Client } from "@/shared/lib/client";
import { getErrorInfo } from "@/shared/lib/errors";
import { finalText, toolResultMetadata, userMessage } from "@/shared/lib/messages";
import { captureRequestContext, injectRequestContext } from "@/shared/lib/requestContext";
import { artifactDelta, artifactDeltaFromMeta } from "@/shared/types/artifact";
import type { Tool } from "@/shared/types/chat";

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
    inputSchema: z.strictObject({
      prompt: z
        .string()
        .min(1)
        .describe(
          "A clear, self-contained task description for the agent. Include the task goal, constraints, and expected result.",
        ),
    }),
    execute: async (args, execution) => {
      const ctx = execution?.context;
      const parentSignal = execution?.abortSignal ?? ctx?.signal;
      parentSignal?.throwIfAborted();
      const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
      if (!prompt) {
        return [{ type: "text", content: "Error: prompt is required" }];
      }
      const model = spec.model ?? ctx?.model;
      if (options.needsApproval) {
        if (!ctx?.elicit)
          return [{ type: "text", content: "This task requires confirmation, which is unavailable in this context." }];
        const answer = await ctx.elicit({ message: `${description}\n\n${prompt}` });
        parentSignal?.throwIfAborted();
        if (answer.action !== "accept") return [{ type: "text", content: "Cancelled by user." }];
      }

      try {
        const timeout = spec.timeoutMs ? AbortSignal.timeout(spec.timeoutMs) : undefined;
        const signal = timeout && parentSignal ? AbortSignal.any([parentSignal, timeout]) : (timeout ?? parentSignal);
        signal?.throwIfAborted();
        const direct = await spec.direct?.(args, { ...ctx, model, signal });
        signal?.throwIfAborted();
        if (direct !== undefined) return [{ type: "text", content: direct }];
        if (!model) return [{ type: "text", content: "No model is available for this task." }];
        const requestContext = captureRequestContext(spec.runtimeContext);
        const runResult = await agentRun(
          options.client ?? getConfig().client,
          model,
          spec.instructions,
          [userMessage(prompt)],
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
          .flatMap((message) => message.parts)
          .flatMap((part) =>
            part.type === "tool-result" ? (artifactDeltaFromMeta(toolResultMetadata(part).meta)?.mutations ?? []) : [],
          );
        if (mutations.length) ctx?.setMeta?.({ artifactDelta: artifactDelta(mutations) });
        parentSignal?.throwIfAborted();

        if (runResult.status === "aborted") {
          return [{ type: "text", content: "Subagent interrupted before finishing." }];
        }
        if (runResult.status === "failed") {
          return [{ type: "text", content: `Subagent error: ${runResult.error?.message ?? "Unknown error"}` }];
        }
        if (runResult.status === "interrupted") {
          return [{ type: "text", content: "This task needs interactive input. Continue it in chat." }];
        }

        const conversation = runResult.messages;
        const last = conversation[conversation.length - 1];
        const text = last ? finalText(last).trim() : "";
        return [{ type: "text", content: text || "Subagent completed but produced no output." }];
      } catch (error) {
        parentSignal?.throwIfAborted();
        const { message } = getErrorInfo(error);
        return [{ type: "text", content: `Subagent error: ${message}` }];
      }
    },
  };
}
