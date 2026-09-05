import {
  withMessageIdentity,
  type Content,
  type Message,
  type MessageError,
  type Tool,
  type ToolCallContent,
  type ToolContext,
} from "../types/chat";
import type { AgentContext } from "../types/telemetry";
import type { Client } from "./client";
import { combineAbortSignals } from "./abortSignals";
import { getErrorInfo, isAbortError, isContextOverflowError } from "./errors";
import { traceExecuteTool, traceInvokeAgent } from "./otel";
import { parseToolArguments, ToolArgumentsParseError, toolArgumentHints } from "./toolArguments";
import { compileToolRegistry, ToolArgumentValidationError, ToolRegistryError, type ToolRegistry } from "./toolRegistry";
import {
  AgentInvocationContext,
  AgentRunController,
  type AgentRunEvent,
  type AgentRunResult,
} from "./agent-run-controller";

export type { AgentRunEvent, AgentRunResult, AgentRunStatus } from "./agent-run-controller";

/** Safety bound on model calls in one run, guarding against a runaway tool loop. */
const DEFAULT_MAX_TURNS = 100;

/** How many times one turn may compact-and-retry after a context overflow. */
const MAX_OVERFLOW_COMPACTIONS = 2;

/** Options forwarded verbatim to `client.complete`. */
export type CompleteOptions = Parameters<Client["complete"]>[5];

export interface AgentBeforeFinishContext {
  runId: string;
  messages: Message[];
  signal?: AbortSignal;
}

export type AgentBeforeFinishDecision =
  | { action: "finish"; appendContent?: Content[] }
  | { action: "continue"; feedback: Message };

/** Per-turn hooks the caller can supply. All optional. */
export interface RunHooks {
  /** Stable run id supplied by a durable caller. Generated when omitted. */
  runId?: string;

  /** Shared identity, cancellation, and model-call budget for nested agents. */
  invocationContext?: AgentInvocationContext;

  /** Receives the framework-independent lifecycle stream for this run. */
  onEvent?: (event: AgentRunEvent) => void;

  /**
   * Identifier for this agent (e.g. `"chat"` or `"research"`).
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

  /** Runtime stop gate. Return feedback to continue the same bounded run. */
  beforeFinish?: (context: AgentBeforeFinishContext) => Promise<AgentBeforeFinishDecision>;

  /** Persists wire-visible but UI-hidden feedback injected by a stop policy. */
  onRuntimeFeedback?: (message: Message) => void | Promise<void>;

  /**
   * Transform messages before they're sent to the LLM. Used by chat to prune
   * at summary boundaries.
   */
  prepareMessages?: (messages: Message[]) => Message[];

  /**
   * Called when a model request overflows the context window mid-run (e.g. tool
   * results ballooned it after the proactive compaction). Return a compacted
   * copy of the messages to retry with, or the same array to give up. Lets the
   * loop recover instead of failing the whole turn.
   */
  onContextOverflow?: (messages: Message[]) => Message[] | Promise<Message[]>;

  /** Cap on model calls in one run. Defaults to a safety bound; a runaway
   * tool-calling loop stops here rather than never terminating. */
  maxTurns?: number;

  /** Invocation-wide model-call budget shared with nested agents. Defaults to maxTurns. */
  maxModelCalls?: number | null;

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
): Promise<AgentRunResult> {
  const combinedSignal = combineAbortSignals(hooks.invocationContext?.signal, hooks.options?.signal);
  const baseInvocation =
    hooks.invocationContext ??
    new AgentInvocationContext({
      maxModelCalls: hooks.maxModelCalls === undefined ? (hooks.maxTurns ?? DEFAULT_MAX_TURNS) : hooks.maxModelCalls,
    });
  const controller = new AgentRunController({
    runId: hooks.runId,
    invocation: baseInvocation.withSignal(combinedSignal.signal),
    onEvent: hooks.onEvent,
  });
  try {
    const toolRegistry = compileToolRegistry(tools);
    return await traceInvokeAgent(
      hooks.agentName,
      (invokeCtx) => runLoop(client, model, instructions, messages, toolRegistry, hooks, invokeCtx, controller),
      hooks.parentContext,
    );
  } catch (error) {
    if (controller.invocation.signal?.aborted || isAbortError(error)) {
      return controller.finish("aborted", "abort", messages);
    }
    if (error instanceof ToolRegistryError) {
      return controller.finish("failed", "error", messages, {
        code: "TOOL_REGISTRY_INVALID",
        message: error.message,
      });
    }
    const detail = getErrorInfo(error);
    return controller.finish("failed", "error", messages, detail);
  } finally {
    combinedSignal.cleanup();
  }
}

/** Compatibility adapter for callers that have not migrated to terminal results yet. */
export async function runMessages(
  client: Client,
  model: string,
  instructions: string,
  messages: Message[],
  tools: Tool[],
  hooks: RunHooks = {},
): Promise<Message[]> {
  const result = await run(client, model, instructions, messages, tools, hooks);
  if (result.status === "failed") {
    const error = new Error(result.error?.message ?? "Agent run failed");
    Object.assign(error, { code: result.error?.code ?? "AGENT_RUN_FAILED" });
    throw error;
  }
  return result.messages;
}

async function runLoop(
  client: Client,
  model: string,
  instructions: string,
  messages: Message[],
  toolRegistry: ToolRegistry,
  hooks: RunHooks,
  invokeCtx: AgentContext,
  controller: AgentRunController,
): Promise<AgentRunResult> {
  const { onStream, onTurnStart, onTurnEnd, onToolResult, prepareMessages, onContextOverflow, options } = hooks;
  const signal = controller.invocation.signal;
  const maxTurns = hooks.maxTurns ?? DEFAULT_MAX_TURNS;
  let conversation = [...messages];

  // Send one model request, recovering from a mid-run context overflow by
  // compacting and re-sending rather than failing the turn. Bounded so a
  // request that stays too large after compacting still surfaces the error.
  const sendTurn = async (turn: number): Promise<Message> => {
    for (let compactions = 0; ; compactions++) {
      const modelMessages = prepareMessages ? prepareMessages(conversation) : conversation;
      try {
        if (!controller.invocation.tryConsumeModelCall()) throw new AgentBudgetExceededError();
        controller.emit({ type: "model.started", turn });
        let streamingStarted = false;
        const assistant = await client.complete(
          model,
          instructions,
          modelMessages,
          toolRegistry.tools,
          (content) => {
            if (!streamingStarted) {
              streamingStarted = true;
              controller.emit({ type: "model.streaming", turn });
            }
            onStream?.(content);
          },
          {
            ...options,
            signal,
            parentContext: invokeCtx,
          },
        );
        controller.emit({ type: "model.completed", turn });
        return assistant;
      } catch (error) {
        if (
          onContextOverflow &&
          compactions < MAX_OVERFLOW_COMPACTIONS &&
          !signal?.aborted &&
          isContextOverflowError(error)
        ) {
          try {
            controller.emit({ type: "compaction.started", turn });
            const compacted = await onContextOverflow(conversation);
            controller.emit({ type: "compaction.completed", turn });
            if (compacted !== conversation) {
              conversation = compacted;
              continue;
            }
          } catch (compactError) {
            // Compaction itself failed (e.g. the summarizer errored); surface the
            // original overflow, which is the more actionable error.
            console.warn("[agent] context-overflow recovery failed", compactError);
          }
        }
        throw error;
      }
    }
  };

  try {
    // Bounded to keep a runaway tool-calling loop from never terminating.
    for (let turn = 0; turn < maxTurns; turn++) {
      if (signal?.aborted) return controller.finish("aborted", "abort", conversation);
      onTurnStart?.();

      const assistantMessage = withMessageIdentity(await sendTurn(turn), controller.runId);
      if (signal?.aborted) return controller.finish("aborted", "abort", conversation);

      conversation = [...conversation, assistantMessage];
      onTurnEnd?.(assistantMessage);

      const toolCalls = assistantMessage.content.filter((p): p is ToolCallContent => p.type === "tool_call");
      if (toolCalls.length === 0) {
        if (signal?.aborted) return controller.finish("aborted", "abort", conversation);
        if (hooks.beforeFinish) {
          controller.emit({ type: "verification.started", turn });
          const decision = await hooks.beforeFinish({
            runId: controller.runId,
            messages: conversation,
            signal,
          });
          if (signal?.aborted) return controller.finish("aborted", "abort", conversation);
          controller.emit({ type: "verification.completed", turn });
          if (decision.action === "continue") {
            const feedback = withMessageIdentity(decision.feedback, controller.runId);
            conversation = [...conversation, feedback];
            await hooks.onRuntimeFeedback?.(feedback);
            continue;
          }
          if (decision.appendContent?.length) {
            conversation = appendToFinalAssistant(conversation, decision.appendContent);
          }
        }
        return controller.finish("completed", "end_turn", conversation);
      }

      for (const toolCall of toolCalls) {
        if (signal?.aborted) return controller.finish("aborted", "abort", conversation);
        controller.emit({ type: "tool.started", turn, callId: toolCall.id, name: toolCall.name });
        const toolResult = withMessageIdentity(
          await dispatchToolCall(toolCall, toolRegistry, hooks, invokeCtx, controller, turn),
          controller.runId,
        );
        conversation = [...conversation, toolResult];
        onToolResult?.(toolResult);
        controller.emit({ type: "tool.completed", turn, callId: toolCall.id, name: toolCall.name });
        if (signal?.aborted) return controller.finish("aborted", "abort", conversation);
      }
    }

    return controller.finish("max_turns", "max_turns", conversation);
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) return controller.finish("aborted", "abort", conversation);
    if (error instanceof AgentBudgetExceededError) {
      return controller.finish("max_turns", "max_turns", conversation);
    }
    const detail = getErrorInfo(error);
    return controller.finish("failed", "error", conversation, detail);
  }
}

async function dispatchToolCall(
  toolCall: ToolCallContent,
  toolRegistry: ToolRegistry,
  hooks: RunHooks,
  invokeCtx: AgentContext,
  controller: AgentRunController,
  turn: number,
): Promise<Message> {
  const tool = toolRegistry.get(toolCall.name);
  if (!tool) {
    return toolErrorMessage(toolCall, `Error: Tool "${toolCall.name}" not found or not executable.`, {
      code: "TOOL_NOT_FOUND",
      message: `Tool "${toolCall.name}" is not available or not executable.`,
    });
  }

  if (toolCall.incomplete) {
    return toolErrorMessage(
      toolCall,
      `Error: The response hit its output token limit while writing the arguments for "${toolCall.name}", so they are incomplete. Nothing was executed. Retry with a smaller payload — write the file in several smaller calls, or use \`edit\` to build it up in steps.`,
      {
        code: "TOOL_ARGS_TRUNCATED",
        message: `Arguments for "${toolCall.name}" were truncated by the output token limit.`,
      },
    );
  }

  // Parse before tracing so a malformed-JSON failure (model mis-escaped a
  // string field like `code`) yields an actionable, model-facing message it can
  // self-correct from — instead of a raw V8 SyntaxError. `parseToolArguments`
  // already retries with a repair pass, so reaching the catch means the args are
  // genuinely unrecoverable.
  let args: Record<string, unknown>;
  try {
    // Pass the tool's schema so a mis-escaped code/command field can be sliced
    // out by structural boundaries instead of guessed at (or truncated) by the
    // generic repair pass.
    args = toolRegistry.parse(tool, parseToolArguments(toolCall.arguments, toolArgumentHints(tool.parameters)));
  } catch (error) {
    if (error instanceof ToolArgumentsParseError) {
      return toolErrorMessage(
        toolCall,
        `Error: The tool arguments could not be parsed (${error.message}). Re-send the call as a single JSON object with the declared parameters. If a string value (e.g. \`code\`) contains " or \\, escape every " as \\", every \\ as \\\\, and newlines as \\n. For long scripts with many quotes, write the code to a .py artifact and run it via \`path\` to avoid JSON escaping entirely.`,
        { code: "TOOL_ARGS_INVALID_JSON", message: "The tool arguments could not be parsed as JSON." },
      );
    }
    if (error instanceof ToolArgumentValidationError) {
      return toolErrorMessage(
        toolCall,
        `Error: ${error.message}. Re-send the call with the declared parameter types.`,
        {
          code: "TOOL_ARGS_SCHEMA_INVALID",
          message: error.message,
        },
      );
    }
    throw error;
  }

  try {
    let resultMeta: Record<string, unknown> | undefined;
    let resultError: MessageError | undefined;
    let resultContent: Record<string, unknown> | undefined;

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
          ...baseContext,
          runId: controller.runId,
          invocationContext: controller.invocation,
          signal: controller.invocation.signal ?? baseContext?.signal,
          setMeta: (meta) => {
            resultMeta = meta;
            hooks.onToolMeta?.(toolCall.id, { ...meta });
            controller.emit({ type: "tool.updated", turn, callId: toolCall.id, name: toolCall.name });
          },
          updateMeta: (meta) => {
            resultMeta = { ...resultMeta, ...meta };
            hooks.onToolMeta?.(toolCall.id, { ...resultMeta });
            controller.emit({ type: "tool.updated", turn, callId: toolCall.id, name: toolCall.name });
          },
          setError: (error) => {
            resultError = error;
          },
          setContent: (content) => {
            resultContent = content;
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
          ...(resultContent ? { content: resultContent } : {}),
        },
      ],
      ...(resultError ? { error: resultError } : {}),
    };
  } catch (error) {
    if (controller.invocation.signal?.aborted || isAbortError(error)) throw error;
    console.error("Tool failed", error);
    const detail = error instanceof Error ? error.message : "Tool execution failed.";
    return toolErrorMessage(toolCall, `Error: ${detail}`, {
      code: "TOOL_EXECUTION_ERROR",
      message: "The tool could not complete the requested action. Please try again or use a different approach.",
    });
  }
}

class AgentBudgetExceededError extends Error {
  constructor() {
    super("The invocation-wide model-call budget was exhausted.");
    this.name = "AgentBudgetExceededError";
  }
}

function appendToFinalAssistant(messages: Message[], content: Content[]): Message[] {
  const index = messages.findLastIndex((message) => message.role === "assistant");
  if (index < 0) return messages;
  const next = [...messages];
  next[index] = { ...next[index], content: [...next[index].content, ...content] };
  return next;
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
