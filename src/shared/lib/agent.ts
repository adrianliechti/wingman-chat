import type { Content, Message, Tool, ToolCallContent, ToolContext } from "../types/chat";
import type { AgentContext } from "../types/telemetry";
import type { Client } from "./client";
import { traceExecuteTool, traceInvokeAgent } from "./otel";
import { parseToolArguments, ToolArgumentsParseError } from "./toolArguments";

/** Options forwarded verbatim to `client.complete`. */
export type CompleteOptions = Parameters<Client["complete"]>[5];

/** Per-turn hooks the caller can supply. All optional. */
export interface RunHooks {
  /**
   * Identifier for this agent (e.g. `"chat"`, `"notebook"`, `"research"`).
   * Used as the suffix on the `invoke_agent` span name and the
   * `gen_ai.agent.name` attribute. Omitted → span is just `invoke_agent`.
   */
  agentName?: string;

  /** Called with partial content as the model streams. */
  onStream?: (content: Content[]) => void;

  /** Called before each LLM request (e.g. to set up streaming UI). */
  onTurnStart?: () => void;

  /** Called after each LLM response is received with the new assistant message. */
  onTurnEnd?: (assistant: Message) => void;

  /**
   * Build a ToolContext for a given tool call (chat uses this for elicitation,
   * render, etc.). The harness injects tracing and metadata helpers.
   */
  createToolContext?: (toolCall: ToolCallContent) => ToolContext | undefined;

  /** Called after each tool result message is appended. */
  onToolResult?: (toolResult: Message) => void;

  /** Fires on every `setMeta`/`updateMeta` — both live (during execution) and late (after commit). */
  onToolMeta?: (toolCallId: string, meta: Record<string, unknown>) => void;

  /**
   * Transform messages before they're sent to the LLM. Used by chat to prune
   * at summary boundaries.
   */
  prepareMessages?: (messages: Message[]) => Message[];

  /** Options forwarded to `client.complete` (includes signal, effort, verbosity, …). */
  options?: CompleteOptions;

  /**
   * Parent trace context for nested agents spawned from a tool.
   */
  parentContext?: AgentContext;
}

export async function run(
  client: Client,
  model: string,
  instructions: string,
  messages: Message[],
  tools: Tool[],
  hooks: RunHooks = {},
): Promise<Message[]> {
  return traceInvokeAgent(
    hooks.agentName,
    (invokeCtx) => runLoop(client, model, instructions, messages, tools, hooks, invokeCtx),
    hooks.parentContext,
  );
}

async function runLoop(
  client: Client,
  model: string,
  instructions: string,
  messages: Message[],
  tools: Tool[],
  hooks: RunHooks,
  invokeCtx: AgentContext,
): Promise<Message[]> {
  const { onStream, onTurnStart, onTurnEnd, onToolResult, prepareMessages, options } = hooks;
  const signal = options?.signal;
  let conversation = [...messages];

  while (true) {
    onTurnStart?.();
    const modelMessages = prepareMessages ? prepareMessages(conversation) : conversation;

    const assistantMessage = await client.complete(model, instructions, modelMessages, tools, onStream, {
      ...options,
      parentContext: invokeCtx,
    });
    if (signal?.aborted) return conversation;

    conversation = [...conversation, assistantMessage];
    onTurnEnd?.(assistantMessage);

    const toolCalls = assistantMessage.content.filter((p): p is ToolCallContent => p.type === "tool_call");
    if (toolCalls.length === 0) return conversation;

    for (const toolCall of toolCalls) {
      const toolResult = await dispatchToolCall(toolCall, tools, hooks, invokeCtx);
      conversation = [...conversation, toolResult];
      onToolResult?.(toolResult);
      if (signal?.aborted) return conversation;
    }
  }
}

async function dispatchToolCall(
  toolCall: ToolCallContent,
  tools: Tool[],
  hooks: RunHooks,
  invokeCtx: AgentContext,
): Promise<Message> {
  const tool = tools.find((t) => t.name === toolCall.name);
  if (!tool) {
    return toolErrorMessage(toolCall, `Error: Tool "${toolCall.name}" not found or not executable.`, {
      code: "TOOL_NOT_FOUND",
      message: `Tool "${toolCall.name}" is not available or not executable.`,
    });
  }

  // Parse before tracing so a malformed-JSON failure (model mis-escaped a
  // string field like `code`) yields an actionable, model-facing message it can
  // self-correct from — instead of a raw V8 SyntaxError. `parseToolArguments`
  // already retries with a repair pass, so reaching the catch means the args are
  // genuinely unrecoverable.
  let args: Record<string, unknown>;
  try {
    args = parseToolArguments(toolCall.arguments);
  } catch (error) {
    if (error instanceof ToolArgumentsParseError) {
      return toolErrorMessage(
        toolCall,
        'Error: The tool arguments were not valid JSON. This usually means a string value (e.g. `code`) contains an unescaped " or \\. Re-send the call with every " escaped as \\", every \\ as \\\\, and newlines as \\n. For long scripts with many quotes, write the code to a .py artifact and run it via `path` to avoid JSON escaping entirely.',
        { code: "TOOL_ARGS_INVALID_JSON", message: "The tool arguments could not be parsed as JSON." },
      );
    }
    throw error;
  }

  try {
    let resultMeta: Record<string, unknown> | undefined;

    const result = await traceExecuteTool(
      toolCall.name,
      {
        toolCallId: toolCall.id,
        toolDescription: tool.description,
        parentContext: invokeCtx,
      },
      (executeCtx) => {
        const baseContext = hooks.createToolContext?.(toolCall);
        const toolContext: ToolContext = {
          ...(baseContext ?? {}),
          setMeta: (meta) => {
            resultMeta = meta;
            hooks.onToolMeta?.(toolCall.id, { ...meta });
          },
          updateMeta: (meta) => {
            resultMeta = { ...resultMeta, ...meta };
            hooks.onToolMeta?.(toolCall.id, { ...resultMeta });
          },
          agentContext: executeCtx,
        };
        return tool.function(args, toolContext);
      },
    );

    return {
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
    };
  } catch (error) {
    console.error("Tool failed", error);
    const detail = error instanceof Error ? error.message : "Tool execution failed.";
    return toolErrorMessage(toolCall, `Error: ${detail}`, {
      code: "TOOL_EXECUTION_ERROR",
      message: "The tool could not complete the requested action. Please try again or use a different approach.",
    });
  }
}

function toolErrorMessage(
  toolCall: ToolCallContent,
  resultText: string,
  error: { code: string; message: string },
): Message {
  return {
    role: "user",
    content: [
      {
        type: "tool_result",
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
        result: [{ type: "text", text: resultText }],
      },
    ],
    error,
  };
}
