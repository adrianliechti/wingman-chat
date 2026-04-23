/**
 * Shared agent harness — canonical tool-calling loop.
 *
 * Both the main chat and notebook features delegate here instead of
 * duplicating the call → tool_call → tool_result cycle.
 */

import type { Content, Message, Tool, ToolCallContent, ToolContext } from "../types/chat";
import type { Client } from "./client";

/** Options forwarded verbatim to `client.complete`. */
export type CompleteOptions = Parameters<Client["complete"]>[5];

/** Per-turn hooks the caller can supply. All optional. */
export interface RunHooks {
  /** Called with partial content as the model streams. */
  onStream?: (content: Content[]) => void;

  /** Called before each LLM request (e.g. to set up streaming UI). */
  onTurnStart?: () => void;

  /** Called after each LLM response is received with the new assistant message. */
  onTurnEnd?: (assistant: Message) => void;

  /** Build a ToolContext for a given tool call (chat uses this for elicitation, render, etc.). */
  createToolContext?: (toolCall: ToolCallContent) => {
    context: ToolContext;
    getResultMeta: () => Record<string, unknown> | undefined;
  };

  /** Called after each tool result message is appended. */
  onToolResult?: (toolResult: Message) => void;

  /**
   * Transform messages before they're sent to the LLM.
   * Used by chat to prune at compaction boundaries.
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
  let conversation = [...messages];

  const { onStream, onTurnStart, onTurnEnd, createToolContext, onToolResult, prepareMessages, options } = hooks;
  const signal = options?.signal;

  const appendToolResult = (message: Message) => {
    conversation = [...conversation, message];
    onToolResult?.(message);
  };

  while (true) {
    onTurnStart?.();

    const modelMessages = prepareMessages ? prepareMessages(conversation) : conversation;

    const assistantMessage = await client.complete(model, instructions, modelMessages, tools, onStream, options);

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
        const toolCtx = createToolContext?.(toolCall);
        const result = await tool.function(args, toolCtx?.context);
        const meta = toolCtx?.getResultMeta();

        appendToolResult({
          role: "user",
          content: [
            {
              type: "tool_result",
              id: toolCall.id,
              name: toolCall.name,
              arguments: toolCall.arguments,
              result,
              ...(meta ? { meta } : {}),
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
