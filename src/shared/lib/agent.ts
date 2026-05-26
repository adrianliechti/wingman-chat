/**
 * Shared agent harness — canonical tool-calling loop.
 *
 * Both the main chat and notebook features delegate here instead of
 * duplicating the call → tool_call → tool_result cycle.
 */

import { context, type Context } from "@opentelemetry/api";
import type { Content, Message, Tool, ToolCallContent, ToolContext } from "../types/chat";
import type { Client } from "./client";
import { traceExecuteTool, traceInvokeAgent } from "./otel";

/** Options forwarded verbatim to `client.complete`. */
export type CompleteOptions = Parameters<Client["complete"]>[5];

/** Per-turn hooks the caller can supply. All optional. */
export interface RunHooks {
  /**
   * Identifier for this agent (e.g. "chat", "notebook", "research"). Used as
   * the suffix on the `invoke_agent` span name and the `gen_ai.agent.name`
   * attribute. Omitted → span is just `invoke_agent`.
   */
  agentName?: string;

  /** Called with partial content as the model streams. */
  onStream?: (content: Content[]) => void;

  /** Called before each LLM request (e.g. to set up streaming UI). */
  onTurnStart?: () => void;

  /** Called after each LLM response is received with the new assistant message. */
  onTurnEnd?: (assistant: Message) => void;

  /**
   * Build a ToolContext for a given tool call (chat uses this for elicitation, render, etc.).
   * The harness injects `setMeta`/`updateMeta` automatically — callers should not supply them.
   */
  createToolContext?: (toolCall: ToolCallContent) => ToolContext | undefined;

  /** Called after each tool result message is appended. */
  onToolResult?: (toolResult: Message) => void;

  /** Fires on every `setMeta`/`updateMeta` — both live (during execution) and late (after commit). */
  onToolMeta?: (toolCallId: string, meta: Record<string, unknown>) => void;

  /**
   * Transform messages before they're sent to the LLM.
   * Used by chat to prune at summary boundaries.
   */
  prepareMessages?: (messages: Message[]) => Message[];

  /** Options forwarded to `client.complete` (includes signal, effort, verbosity, …). */
  options?: CompleteOptions;
}

/**
 * Run an LLM completion loop with tool support.
 *
 * Calls `client.complete()`, executes any tool calls, feeds results back,
 * and repeats until the model stops calling tools or the signal is aborted.
 */
export async function run(
  client: Client,
  model: string,
  instructions: string,
  messages: Message[],
  tools: Tool[],
  hooks: RunHooks = {},
): Promise<Message[]> {
  return traceInvokeAgent(hooks.agentName, (invokeCtx) =>
    runInner(client, model, instructions, messages, tools, hooks, invokeCtx),
  );
}

async function runInner(
  client: Client,
  model: string,
  instructions: string,
  messages: Message[],
  tools: Tool[],
  hooks: RunHooks,
  invokeCtx: Context,
): Promise<Message[]> {
  let conversation = [...messages];

  const { onStream, onTurnStart, onTurnEnd, createToolContext, onToolResult, onToolMeta, prepareMessages, options } =
    hooks;
  const signal = options?.signal;

  const appendToolResult = (message: Message) => {
    conversation = [...conversation, message];
    onToolResult?.(message);
  };

  while (true) {
    onTurnStart?.();

    const modelMessages = prepareMessages ? prepareMessages(conversation) : conversation;

    // Rebind invoke_agent's context synchronously so the chat span nests under
    // it even when zone-based async tracking has been lost across awaits.
    const assistantMessage = await context.with(invokeCtx, () =>
      client.complete(model, instructions, modelMessages, tools, onStream, options),
    );

    if (signal?.aborted) {
      return conversation;
    }

    conversation = [...conversation, assistantMessage];
    onTurnEnd?.(assistantMessage);

    const toolCalls = assistantMessage.content.filter((p): p is ToolCallContent => p.type === "tool_call");

    if (toolCalls.length === 0) {
      return conversation;
    }

    for (const toolCall of toolCalls) {
      const tool = tools.find((t) => t.name === toolCall.name);

      if (!tool) {
        appendToolResult({
          role: "user",
          content: [
            {
              type: "tool_result",
              id: toolCall.id,
              name: toolCall.name,
              arguments: toolCall.arguments,
              result: [{ type: "text", text: `Error: Tool "${toolCall.name}" not found or not executable.` }],
            },
          ],
          error: {
            code: "TOOL_NOT_FOUND",
            message: `Tool "${toolCall.name}" is not available or not executable.`,
          },
        });
        continue;
      }

      try {
        const args = JSON.parse(toolCall.arguments || "{}");

        let resultMeta: Record<string, unknown> | undefined;
        const baseContext = createToolContext?.(toolCall);

        const result = await context.with(invokeCtx, () =>
          traceExecuteTool(
            toolCall.name,
            { toolCallId: toolCall.id, toolDescription: tool.description },
            // The execute_tool span's context is captured here synchronously
            // and exposed to the tool via `runInTrace`, so the tool can rebind
            // it across its own awaits before spawning nested spans.
            (executeCtx) => {
              const toolContext: ToolContext | undefined = baseContext
                ? {
                    ...baseContext,
                    setMeta: (meta: Record<string, unknown>) => {
                      resultMeta = meta;
                      onToolMeta?.(toolCall.id, { ...meta });
                    },
                    updateMeta: (meta: Record<string, unknown>) => {
                      resultMeta = { ...resultMeta, ...meta };
                      onToolMeta?.(toolCall.id, { ...resultMeta });
                    },
                    runInTrace: <T>(fn: () => T) => context.with(executeCtx, fn),
                  }
                : undefined;
              return tool.function(args, toolContext);
            },
          ),
        );

        appendToolResult({
          role: "user",
          content: [
            {
              type: "tool_result",
              id: toolCall.id,
              name: toolCall.name,
              arguments: toolCall.arguments,
              result,
              ...(resultMeta ? { meta: resultMeta } : {}),
            },
          ],
        });
      } catch (error) {
        console.error("Tool failed", error);

        appendToolResult({
          role: "user",
          content: [
            {
              type: "tool_result",
              id: toolCall.id,
              name: toolCall.name,
              arguments: toolCall.arguments,
              result: [
                {
                  type: "text",
                  text: `Error: ${error instanceof Error ? error.message : "Tool execution failed."}`,
                },
              ],
            },
          ],
          error: {
            code: "TOOL_EXECUTION_ERROR",
            message: "The tool could not complete the requested action. Please try again or use a different approach.",
          },
        });
      }

      if (signal?.aborted) {
        return conversation;
      }
    }
  }
}
