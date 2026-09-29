import {
  chat,
  convertMessagesToModelMessages,
  maxIterations,
  StreamProcessor,
  toolDefinition,
  type ChatMiddleware,
  type UIMessage,
} from "@tanstack/ai";
import { z } from "zod";
import {
  withMessageIdentity,
  updateToolResultMeta,
  type Content,
  type Message,
  type Tool,
  type ToolCallContent,
  type ToolContext,
} from "../types/chat";
import type { AgentContext } from "../types/telemetry";
import type { Client } from "./client";
import { combineAbortSignals } from "./abortSignals";
import { fromAIMessages, toAIMessages } from "./aiMessages";
import { aiDebug, textStreamStrategy } from "./aiStream";
import { getErrorInfo, isAbortError, isContextOverflowError } from "./errors";
import { aiTelemetry, traceExecuteTool, traceInvokeAgent } from "./otel";
import { serializeToolResultForApi } from "./utils";
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

/** Model options shared by one-shot completions and TanStack chat runs. */
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
  /** Conversation identity shared by TanStack runs and diagnostics. */
  threadId?: string;

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

  /** Called before each turn with the empty assistant message and its durable identity. */
  onTurnStart?: (assistant: Message) => void;

  /** Called after each LLM response is received with the new assistant message. */
  onTurnEnd?: (assistant: Message) => void;

  /** Authoritative history after each commit, including compaction and stop policies. */
  onMessagesChange?: (messages: Message[]) => void;

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
  prepareMessages?: (messages: Message[]) => Message[] | Promise<Message[]>;

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

/**
 * Application lifecycle adapter around TanStack's agent loop. TanStack owns
 * streaming, tool argument parsing, dispatch, errors, and loop continuation.
 * Wingman owns durable workspace results and post-run artifact verification.
 */
export async function run(
  client: Client,
  model: string,
  instructions: string,
  messages: Message[],
  tools: Tool[],
  hooks: RunHooks = {},
): Promise<AgentRunResult> {
  const combined = combineAbortSignals(hooks.invocationContext?.signal, hooks.options?.signal);
  const abortController = new AbortController();
  const abort = () => abortController.abort(combined.signal?.reason);
  if (combined.signal?.aborted) abort();
  else combined.signal?.addEventListener("abort", abort, { once: true });
  const invocation = (
    hooks.invocationContext ??
    new AgentInvocationContext({
      maxModelCalls: hooks.maxModelCalls === undefined ? (hooks.maxTurns ?? DEFAULT_MAX_TURNS) : hooks.maxModelCalls,
    })
  ).withSignal(abortController.signal);
  const controller = new AgentRunController({ runId: hooks.runId, invocation, onEvent: hooks.onEvent });
  let conversation = [...messages];
  let modelCalls = 0;
  let budgetExhausted = false;
  let compactions = 0;
  const commit = (next: Message[]) => {
    conversation = next;
    hooks.onMessagesChange?.(next);
  };

  try {
    return await traceInvokeAgent(
      hooks.agentName,
      async (invokeCtx) => {
        // Only application verification/context recovery can start another run.
        // The tool/model cycle itself is entirely inside chat().
        for (;;) {
          abortController.signal.throwIfAborted();
          const base = conversation;
          const results = new Map<string, Message>();
          const reportedResults = new Set<string>();
          const completed = new Set<string>();
          const usages = new Map<string, Message["usage"]>();
          const cycleId = crypto.randomUUID();
          const adapter = client.textAdapter(model, abortController.signal);
          let current: Message | undefined;
          let streamError: Error | undefined;
          let streamed = false;
          let lastHadTools = false;
          let processor: StreamProcessor;
          const project = (native: UIMessage[]): Message[] => {
            let turn = 0;
            return fromAIMessages(native, controller.runId, model).map((message) => {
              if (message.role === "assistant") {
                // The processor may rename a pending tool-only native message
                // when text starts. Logical turns retain their durable identity.
                const id = `${cycleId}-${turn++}`;
                return { ...message, id, usage: usages.get(id) ?? message.usage };
              }
              const result = message.content.find((part) => part.type === "tool_result");
              return (result && results.get(result.id)) ?? message;
            });
          };
          const snapshot = (native: UIMessage[]): Message[] => [
            ...base,
            ...project(native).filter((message) => message.role === "user" || completed.has(message.id!)),
          ];
          const finishTurn = () => {
            if (streamError || abortController.signal.aborted) return;
            const assistant = project(processor.getMessages()).findLast((message) => message.role === "assistant");
            if (!assistant || completed.has(assistant.id!)) return;
            completed.add(assistant.id!);
            lastHadTools = assistant.content.some((part) => part.type === "tool_call");
            commit(snapshot(processor.getMessages()));
            hooks.onTurnEnd?.(assistant);
            controller.emit({ type: "model.completed", turn: modelCalls - 1 });
          };
          processor = new StreamProcessor({
            chunkStrategy: textStreamStrategy(),
            events: {
              onError: (error) => {
                streamError = error;
              },
              onMessagesChange: (native) => {
                const projected = project(native);
                const message = projected.findLast((item) => item.role === "assistant");
                if (message && !completed.has(message.id!)) {
                  if (message.id !== current?.id) {
                    current = withMessageIdentity({ ...message, content: [] }, controller.runId);
                    hooks.onTurnStart?.(current);
                  }
                  if (!streamed) {
                    streamed = true;
                    controller.emit({ type: "model.streaming", turn: modelCalls - 1 });
                  }
                  hooks.onStream?.(message.content.filter((part) => part.type !== "tool_result"));
                }
                const newResults = projected.filter((message) =>
                  message.content.some((part) => part.type === "tool_result" && !reportedResults.has(part.id)),
                );
                if (!abortController.signal.aborted && newResults.length) {
                  // Validation errors produce results without onBeforeToolCall.
                  // Commit their owning model turn before publishing the result.
                  finishTurn();
                  commit(snapshot(native));
                  for (const message of newResults) {
                    const output = message.content.find((part) => part.type === "tool_result");
                    if (output && !reportedResults.has(output.id)) {
                      reportedResults.add(output.id);
                      hooks.onToolResult?.(message);
                    }
                  }
                }
              },
              onStreamEnd: finishTurn,
            },
          });
          const middleware: ChatMiddleware = {
            onConfig: async (ctx, config) => {
              if (ctx.phase !== "beforeModel") return;
              if (modelCalls >= (hooks.maxTurns ?? DEFAULT_MAX_TURNS) || !invocation.tryConsumeModelCall()) {
                budgetExhausted = true;
                ctx.abort("Model-call budget exhausted");
                throw new Error("Model-call budget exhausted");
              }
              modelCalls++;
              const prepared = hooks.prepareMessages ? await hooks.prepareMessages(conversation) : conversation;
              return { ...config, providerMessages: convertMessagesToModelMessages(toAIMessages(prepared, model)) };
            },
            onIteration: () => {
              finishTurn();
              current = undefined;
              streamed = false;
              controller.emit({ type: "model.started", turn: modelCalls });
            },
            onUsage: (_ctx, usage) => {
              const message = project(processor.getMessages()).findLast((item) => item.role === "assistant");
              if (message)
                usages.set(message.id!, {
                  model: adapter.responseInfo?.model ?? model,
                  reasoningContext: adapter.responseInfo?.reasoningContext,
                  inputTokens: usage.promptTokens,
                  outputTokens: usage.completionTokens,
                  cachedInputTokens: usage.promptTokensDetails?.cachedTokens,
                  reasoningTokens: usage.completionTokensDetails?.reasoningTokens,
                });
            },
            onBeforeToolCall: (_ctx, call) => {
              finishTurn();
              controller.emit({
                type: "tool.started",
                turn: modelCalls - 1,
                callId: call.toolCallId,
                name: call.toolName,
              });
            },
            onAfterToolCall: (_ctx, call) => {
              controller.emit({
                type: "tool.completed",
                turn: modelCalls - 1,
                callId: call.toolCallId,
                name: call.toolName,
              });
            },
            onToolPhaseComplete: () => {
              finishTurn();
            },
          };
          const nativeTools = tools.map((tool) =>
            toolDefinition({
              name: tool.name,
              description: tool.description ?? tool.name,
              inputSchema: z.fromJSONSchema(tool.parameters),
              lazy: tool.lazy,
            }).server(async (input, execution) => {
              const call: ToolCallContent = {
                type: "tool_call",
                id: execution?.toolCallId ?? crypto.randomUUID(),
                name: tool.name,
                arguments: JSON.stringify(input),
              };
              let meta: Record<string, unknown> = {};
              let content: Record<string, unknown> | undefined;
              let error: Message["error"];
              const updateMeta = (next: Record<string, unknown>) => {
                meta = next;
                const saved = results.get(call.id);
                if (saved) results.set(call.id, updateToolResultMeta([saved], call.id, meta)[0]);
                commit(updateToolResultMeta(conversation, call.id, meta));
                hooks.onToolMeta?.(call.id, { ...meta });
              };
              const result = await traceExecuteTool(
                tool.name,
                { toolCallId: call.id, toolDescription: tool.description, parentContext: invokeCtx },
                (agentContext) =>
                  tool.function(input as Record<string, unknown>, {
                    ...hooks.createToolContext?.(call),
                    runId: controller.runId,
                    invocationContext: invocation,
                    signal: abortController.signal,
                    agentContext,
                    setMeta: updateMeta,
                    updateMeta: (next) => updateMeta({ ...meta, ...next }),
                    setContent: (next) => {
                      content = next;
                    },
                    setError: (next) => {
                      error = next;
                    },
                  }),
              );
              abortController.signal.throwIfAborted();
              results.set(
                call.id,
                withMessageIdentity(
                  {
                    role: "user",
                    content: [
                      {
                        type: "tool_result",
                        id: call.id,
                        name: call.name,
                        arguments: call.arguments,
                        result,
                        meta,
                        content,
                      },
                    ],
                    error,
                  },
                  controller.runId,
                ),
              );
              // Preserve display metadata above while letting TanStack report
              // the failure to its tool lifecycle, diagnostics, and model loop.
              if (error) throw Object.assign(new Error(error.message), { code: error.code });
              return serializeToolResultForApi(result);
            }),
          );
          try {
            await processor.process(
              chat({
                adapter,
                messages: toAIMessages(conversation, model),
                systemPrompts: [instructions],
                tools: nativeTools,
                lazyToolsConfig: { includeDescription: "first-sentence" },
                abortController,
                runId: controller.runId,
                threadId: hooks.threadId,
                debug: aiDebug,
                modelOptions: client.chatModelOptions(model, hooks.options),
                agentLoopStrategy: maxIterations((hooks.maxTurns ?? DEFAULT_MAX_TURNS) - modelCalls),
                middleware: [aiTelemetry(hooks.agentName ?? "chat", invokeCtx), middleware],
              }),
            );
            if (streamError) throw streamError;
            if (!abortController.signal.aborted) {
              finishTurn();
              commit(snapshot(processor.getMessages()));
            }
          } catch (error) {
            if (
              !abortController.signal.aborted &&
              hooks.onContextOverflow &&
              compactions < MAX_OVERFLOW_COMPACTIONS &&
              isContextOverflowError(error)
            ) {
              compactions++;
              controller.emit({ type: "compaction.started", turn: modelCalls });
              const compacted = await hooks.onContextOverflow(conversation);
              controller.emit({ type: "compaction.completed", turn: modelCalls });
              if (compacted !== conversation) {
                commit(compacted);
                continue;
              }
            }
            throw error;
          }
          if (budgetExhausted || (lastHadTools && modelCalls >= (hooks.maxTurns ?? DEFAULT_MAX_TURNS)))
            return controller.finish("max_turns", "max_turns", conversation);
          abortController.signal.throwIfAborted();
          if (hooks.beforeFinish) {
            controller.emit({ type: "verification.started", turn: modelCalls });
            const decision = await hooks.beforeFinish({
              runId: controller.runId,
              messages: conversation,
              signal: abortController.signal,
            });
            controller.emit({ type: "verification.completed", turn: modelCalls });
            abortController.signal.throwIfAborted();
            if (decision.action === "continue") {
              const feedback = withMessageIdentity(decision.feedback, controller.runId);
              commit([...conversation, feedback]);
              await hooks.onRuntimeFeedback?.(feedback);
              continue;
            }
            if (decision.appendContent?.length) {
              const index = conversation.findLastIndex((message) => message.role === "assistant");
              if (index >= 0)
                commit(
                  conversation.map((message, i) =>
                    i === index ? { ...message, content: [...message.content, ...decision.appendContent!] } : message,
                  ),
                );
            }
          }
          return controller.finish("completed", "end_turn", conversation);
        }
      },
      hooks.parentContext,
    );
  } catch (error) {
    if (budgetExhausted) return controller.finish("max_turns", "max_turns", conversation);
    if (abortController.signal.aborted || isAbortError(error))
      return controller.finish("aborted", "abort", conversation);
    return controller.finish("failed", "error", conversation, getErrorInfo(error));
  } finally {
    combined.signal?.removeEventListener("abort", abort);
    combined.cleanup();
  }
}

export async function runMessages(...args: Parameters<typeof run>): Promise<Message[]> {
  const result = await run(...args);
  if (result.status === "failed")
    throw Object.assign(new Error(result.error?.message ?? "Agent run failed"), { code: result.error?.code });
  if (result.status === "aborted") throw new DOMException("Agent run was cancelled.", "AbortError");
  if (result.status === "max_turns")
    throw Object.assign(new Error("Agent run reached its turn limit."), { code: "MAX_TURNS" });
  return result.messages;
}
