import {
  chat,
  defineAgent,
  normalizeToUIMessage,
  convertMessagesToModelMessages,
  modelMessagesToUIMessages,
  maxIterations,
  toolDefinition,
  type ChatMiddleware,
  type RunAgentResumeItem,
  type StreamChunk,
  type UIMessage,
} from "@tanstack/ai";
import { ChatClient } from "@tanstack/ai-client";
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
import type { Client, ClientRequestOptions } from "./client";
import { combineAbortSignals } from "./abortSignals";
import { fromAIMessages, toAIMessages } from "./aiMessages";
import { artifactDelta, artifactDeltaFromMeta } from "../types/artifact";
import { captureRequestContext, injectRequestContext } from "./requestContext";
import { aiDebug } from "./aiStream";
import { getErrorInfo, isAbortError } from "./errors";
import { aiTelemetry } from "./otel";
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

/** Provider configuration shared by chat, subagents, and isolated interpreter calls. */
export type ChatOptions = NonNullable<Parameters<Client["chatModelOptions"]>[1]> & ClientRequestOptions;

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
  /** Provider-owned native extensions, scoped by TanStack to this invocation. */
  middleware?: ChatMiddleware[];
  /** App policies instantiated for this run and each native child, with that run's cancellation. */
  sharedMiddleware?: (signal: AbortSignal) => ChatMiddleware[];
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

  /**
   * Transform messages before they're sent to the LLM. Used by chat to prune
   * at summary boundaries.
   */
  prepareMessages?: (messages: Message[]) => Message[] | Promise<Message[]>;

  /** Cap on model calls in one run. Defaults to a safety bound; a runaway
   * tool-calling loop stops here rather than never terminating. */
  maxTurns?: number;

  /** Invocation-wide model-call budget shared with nested agents. Defaults to maxTurns. */
  maxModelCalls?: number | null;

  /** Provider settings and cancellation for this run. */
  options?: ChatOptions;

  /**
   * Parent trace context for nested agents spawned from a tool.
   */
  parentContext?: AgentContext;
}

/** Rich workspace results and provider usage are presentation metadata, not a second transcript. */
export class AgentMessageMetadata {
  private results = new Map<string, Message>();
  private usage = new Map<string, Message["usage"]>();
  private runs = new Map<string, string>();

  result(message: Message) {
    const part = message.content.find((item) => item.type === "tool_result");
    if (part) this.results.set(part.id, message);
  }

  turn(id: string, runId: string, usage?: Message["usage"]) {
    this.runs.set(id, runId);
    if (usage) this.usage.set(id, usage);
  }

  read(messages: UIMessage[], model?: string): Message[] {
    return fromAIMessages(messages, undefined, model).map((message) => {
      const part = message.content.find((item) => item.type === "tool_result");
      const saved = part && this.results.get(part.id);
      if (saved) return saved;
      return {
        ...message,
        content: message.content.map((part) =>
          part.type === "subagent"
            ? {
                ...part,
                subagent: { ...part.subagent, messages: toAIMessages(this.read(part.subagent.messages, model), model) },
              }
            : part,
        ),
        runId: this.runs.get(message.id!) ?? message.runId,
        usage: this.usage.get(message.id!) ?? message.usage,
      };
    });
  }
}

export interface StreamRunHooks extends RunHooks {
  metadata: AgentMessageMetadata;
  parentRunId?: string;
  resume?: RunAgentResumeItem[];
  subagentRunId?: string;
  onComplete?: (result: AgentRunResult) => void | Promise<void>;
}

export function chatToolDefinition(tool: Tool) {
  return toolDefinition({
    name: tool.name,
    description: tool.description ?? tool.name,
    inputSchema: z.fromJSONSchema(tool.parameters),
    lazy: tool.lazy,
    needsApproval: tool.needsApproval,
  });
}

export function approvalTools(tools: Tool[]): ReturnType<typeof chatToolDefinition>[] {
  return tools.flatMap((tool) => [
    ...(tool.needsApproval ? [chatToolDefinition(tool)] : []),
    ...(tool.subagent ? approvalTools(tool.subagent.tools) : []),
  ]);
}

/** Browser-local connection stream. chat() owns every model/tool iteration. */
export async function* streamRun(
  client: Client,
  model: string,
  instructions: string,
  messages: Message[],
  tools: Tool[],
  hooks: StreamRunHooks,
): AsyncGenerator<StreamChunk> {
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
  let modelCalls = 0;
  let budgetExhausted = false;
  let conversation = messages;
  let resume = hooks.resume;
  const reportedResults = new Set(
    messages.flatMap((message) => message.content.flatMap((part) => (part.type === "tool_result" ? [part.id] : []))),
  );
  const childCalls = new Map<string, string>();
  const childResults = new Map<string, Message[]>();
  let snapshot = () => conversation;
  const finish = async (status: AgentRunResult["status"], error?: unknown, messages = snapshot()) => {
    const reason =
      status === "completed"
        ? "end_turn"
        : status === "aborted"
          ? "abort"
          : status === "max_turns"
            ? "max_turns"
            : status === "interrupted"
              ? "interrupt"
              : "error";
    await hooks.onComplete?.(controller.finish(status, reason, messages, error ? getErrorInfo(error) : undefined));
  };

  try {
    // Only a failed workspace verification can start another bounded chat().
    // Context compaction is native middleware, not a second retry loop.
    for (;;) {
      abortController.signal.throwIfAborted();
      const adapter = client.textAdapter(model, abortController.signal);
      const telemetry = aiTelemetry(hooks.agentName ?? "chat", hooks.parentContext);
      let lastHadTools = false;
      let terminal: Extract<StreamChunk, { type: "RUN_FINISHED" }> | undefined;
      let failure: Error | undefined;
      const remember = (ctx: Parameters<NonNullable<ChatMiddleware["onStart"]>>[0]) => {
        snapshot = () => hooks.metadata.read(modelMessagesToUIMessages([...ctx.messages]), model);
        for (const message of snapshot()) {
          const result = message.content.find((part) => part.type === "tool_result");
          if (result && !reportedResults.has(result.id)) {
            reportedResults.add(result.id);
            hooks.onToolResult?.(message);
          }
        }
      };
      const middleware: ChatMiddleware = {
        onFinish: remember,
        onError: remember,
        onAbort: remember,
        onConfig: async (ctx) => {
          remember(ctx);
          if (ctx.phase !== "beforeModel") return;
          if (modelCalls >= (hooks.maxTurns ?? DEFAULT_MAX_TURNS) || !invocation.tryConsumeModelCall()) {
            budgetExhausted = true;
            throw Object.assign(new Error("This run reached its model-call limit."), { code: "MAX_TURNS" });
          }
          modelCalls++;
          if (hooks.prepareMessages)
            return {
              providerMessages: convertMessagesToModelMessages(
                toAIMessages(await hooks.prepareMessages(snapshot()), model),
              ),
            };
          return undefined;
        },
        onIteration: (ctx) => {
          if (ctx.currentMessageId) hooks.metadata.turn(ctx.currentMessageId, controller.runId);
          controller.emit({ type: "model.started", turn: modelCalls });
        },
        onUsage: (ctx, usage) => {
          if (ctx.currentMessageId)
            hooks.metadata.turn(ctx.currentMessageId, controller.runId, {
              model: adapter.responseInfo?.model ?? model,
              reasoningContext: adapter.responseInfo?.reasoningContext,
              inputTokens: usage.promptTokens,
              outputTokens: usage.completionTokens,
              cachedInputTokens: usage.promptTokensDetails?.cachedTokens,
              reasoningTokens: usage.completionTokensDetails?.reasoningTokens,
            });
        },
        onBeforeToolCall: (_ctx, call) => {
          controller.emit({ type: "tool.started", turn: modelCalls - 1, callId: call.toolCallId, name: call.toolName });
        },
        onAfterToolCall: (_ctx, call) => {
          if (tools.some((tool) => tool.name === call.toolName && tool.subagent)) {
            const child = [...childCalls].find(([, id]) => id === call.toolCallId)?.[0];
            const mutations = (childResults.get(child ?? "") ?? [])
              .flatMap((message) => message.content)
              .flatMap((part) =>
                part.type === "tool_result" ? (artifactDeltaFromMeta(part.meta)?.mutations ?? []) : [],
              );
            hooks.metadata.result(
              withMessageIdentity(
                {
                  id: `result-${call.toolCallId}`,
                  role: "user",
                  content: [
                    {
                      type: "tool_result",
                      id: call.toolCallId,
                      name: call.toolName,
                      arguments: call.toolCall.function.arguments,
                      result: [
                        {
                          type: "text",
                          text: call.ok
                            ? typeof call.result === "string"
                              ? call.result
                              : (JSON.stringify(call.result) ?? "")
                            : getErrorInfo(call.error).message,
                        },
                      ],
                      ...(mutations.length ? { meta: { artifactDelta: artifactDelta(mutations) } } : {}),
                    },
                  ],
                  ...(!call.ok ? { error: getErrorInfo(call.error) } : {}),
                },
                controller.runId,
              ),
            );
          }
          controller.emit({
            type: "tool.completed",
            turn: modelCalls - 1,
            callId: call.toolCallId,
            name: call.toolName,
          });
        },
        onToolPhaseComplete: (ctx) => {
          remember(ctx);
        },
        onShouldContinue: (_ctx, state) => {
          lastHadTools = state.lastTurnToolCallCount > 0;
        },
      };
      const nativeTools = tools
        .filter((tool) => !tool.subagent)
        .map((tool) =>
          chatToolDefinition(tool).server(async (input, execution) => {
            const call: ToolCallContent = {
              type: "tool_call",
              id: execution?.toolCallId ?? crypto.randomUUID(),
              name: tool.name,
              arguments: JSON.stringify(input),
            };
            let meta: Record<string, unknown> = {};
            let content: Record<string, unknown> | undefined;
            let error: Message["error"];
            let saved: Message | undefined;
            const updateMeta = (next: Record<string, unknown>) => {
              meta = next;
              if (saved) {
                saved = updateToolResultMeta([saved], call.id, meta)[0];
                hooks.metadata.result(saved);
              }
              hooks.onToolMeta?.(call.id, { ...meta });
            };
            const result = await tool.function(input as Record<string, unknown>, {
              ...hooks.createToolContext?.(call),
              interruptible: true,
              inputResponse: execution?.inputResponse,
              runId: controller.runId,
              invocationContext: invocation,
              signal: abortController.signal,
              agentContext: telemetry.toolContext(call.id),
              setMeta: updateMeta,
              updateMeta: (next) => updateMeta({ ...meta, ...next }),
              setContent: (next) => {
                content = next;
              },
              setError: (next) => {
                error = next;
              },
            });
            abortController.signal.throwIfAborted();
            saved = withMessageIdentity(
              {
                id: `result-${call.id}`,
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
            );
            hooks.metadata.result(saved);
            if (error) throw Object.assign(new Error(error.message), { code: error.code });
            return serializeToolResultForApi(result);
          }),
        );
      const agents = tools.flatMap((tool) => {
        const spec = tool.subagent;
        if (!spec) return [];
        return [
          defineAgent({
            name: tool.name,
            description: tool.description ?? tool.name,
            inputSchema: z.object({ prompt: z.string().min(1) }),
            run: (ctx) => {
              const context = captureRequestContext(
                [spec.runtimeContext, `Delegated task: ${ctx.input.prompt}`].filter(Boolean).join("\n\n"),
              );
              return streamRun(
                client,
                spec.model,
                spec.instructions,
                hooks.metadata.read(
                  ctx.messages.map((message) => normalizeToUIMessage(message, () => crypto.randomUUID())),
                  spec.model,
                ),
                spec.tools,
                {
                  metadata: hooks.metadata,
                  middleware: spec.middleware,
                  sharedMiddleware: hooks.sharedMiddleware,
                  agentName: tool.name,
                  runId: ctx.runId,
                  threadId: ctx.threadId,
                  parentRunId: ctx.parentRunId,
                  subagentRunId: ctx.subagentRunId,
                  resume: ctx.resume,
                  invocationContext: invocation.fork(tool.name),
                  options: { signal: ctx.abortSignal },
                  parentContext: telemetry.toolContext(childCalls.get(ctx.subagentRunId) ?? ctx.subagentRunId),
                  createToolContext: hooks.createToolContext,
                  onToolMeta: hooks.onToolMeta,
                  prepareMessages: async (messages) =>
                    hooks.prepareMessages
                      ? injectRequestContext(
                          await hooks.prepareMessages(messages),
                          `Delegated task: ${ctx.input.prompt}`,
                        )
                      : injectRequestContext(messages, context),
                  onComplete: (result) => {
                    childResults.set(
                      ctx.subagentRunId,
                      result.messages.filter((message) => message.runId?.includes(ctx.subagentRunId)),
                    );
                  },
                },
              );
            },
          }),
        ];
      });
      const stream = chat({
        adapter,
        // Outstanding calls belong to an explicit interrupt continuation.
        // A fresh send must not execute a tool abandoned by Stop or reload.
        messages: toAIMessages(conversation, model, { pendingToolCalls: !!resume?.length }),
        systemPrompts: [instructions],
        tools: nativeTools,
        ...(agents.length ? { subagents: { agents } } : {}),
        lazyToolsConfig: { includeDescription: "first-sentence" },
        abortController,
        runId: controller.runId,
        threadId: hooks.threadId,
        parentRunId: hooks.parentRunId,
        resume,
        subagentRunId: hooks.subagentRunId,
        debug: aiDebug,
        modelOptions: client.chatModelOptions(model, hooks.options),
        agentLoopStrategy: maxIterations((hooks.maxTurns ?? DEFAULT_MAX_TURNS) - modelCalls),
        middleware: [
          telemetry,
          middleware,
          ...(hooks.sharedMiddleware?.(abortController.signal) ?? []),
          ...(hooks.middleware ?? []),
        ],
      });
      resume = undefined;
      for await (const chunk of stream) {
        abortController.signal.throwIfAborted();
        if (chunk.type === "SUBAGENT_STARTED" && chunk.parentToolCallId)
          childCalls.set(chunk.subagentRunId, chunk.parentToolCallId);
        if (
          chunk.type === "RUN_FINISHED" &&
          (!("subagentRunId" in chunk) || chunk.subagentRunId === hooks.subagentRunId)
        ) {
          terminal = chunk;
          continue;
        }
        if (
          chunk.type === "RUN_ERROR" &&
          (!("subagentRunId" in chunk) || chunk.subagentRunId === hooks.subagentRunId)
        ) {
          failure = Object.assign(new Error(chunk.message), { code: chunk.code });
        }
        if (chunk.type === "TEXT_MESSAGE_CONTENT") controller.emit({ type: "model.streaming", turn: modelCalls - 1 });
        yield chunk;
      }
      abortController.signal.throwIfAborted();
      if (failure) {
        await finish(budgetExhausted ? "max_turns" : "failed", failure);
        return;
      }
      conversation = snapshot();
      if (lastHadTools && modelCalls >= (hooks.maxTurns ?? DEFAULT_MAX_TURNS)) {
        await finish("max_turns");
        yield {
          type: "RUN_ERROR",
          message: "This run reached its model-call limit. Continue when you are ready.",
          code: "MAX_TURNS",
        } as StreamChunk;
        return;
      }
      // A native interrupt is already a completed pause. Never verify or send
      // feedback until the user has answered it and its tool has finished.
      const interrupted = terminal?.outcome?.type === "interrupt";
      if (!interrupted && hooks.beforeFinish) {
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
          conversation = [...conversation, feedback];
          yield { type: "MESSAGES_SNAPSHOT", messages: toAIMessages(conversation, model) } as StreamChunk;
          continue;
        }
        if (decision.appendContent?.length) {
          const index = conversation.findLastIndex((message) => message.role === "assistant");
          conversation = conversation.map((message, i) =>
            i === index ? { ...message, content: [...message.content, ...decision.appendContent!] } : message,
          );
          yield { type: "MESSAGES_SNAPSHOT", messages: toAIMessages(conversation, model) } as StreamChunk;
        }
      }
      await finish(interrupted ? "interrupted" : "completed", undefined, conversation);
      if (terminal) yield terminal;
      return;
    }
  } catch (error) {
    const aborted = abortController.signal.aborted || isAbortError(error);
    await finish(budgetExhausted ? "max_turns" : aborted ? "aborted" : "failed", error);
    if (!aborted) {
      const info = getErrorInfo(error);
      yield { type: "RUN_ERROR", message: info.message, code: info.code } as StreamChunk;
    }
  } finally {
    combined.signal?.removeEventListener("abort", abort);
    combined.cleanup();
  }
}

/** One-shot callers use the same native client and stream as the chat UI. */
export async function run(
  client: Client,
  model: string,
  instructions: string,
  messages: Message[],
  tools: Tool[],
  hooks: RunHooks = {},
): Promise<AgentRunResult> {
  const metadata = new AgentMessageMetadata();
  let result: AgentRunResult | undefined;
  const initial = toAIMessages(messages, model);
  const ai: ChatClient = new ChatClient({
    initialMessages: initial.slice(0, -1),
    tools: approvalTools(tools),
    connection: {
      connect: (_messages, _data, signal) =>
        streamRun(client, model, instructions, messages, tools, {
          ...hooks,
          options: { ...hooks.options, signal: hooks.options?.signal ?? signal },
          metadata,
          onComplete: (value) => {
            result = value;
          },
        }),
    },
  });
  try {
    await ai.append(initial.at(-1) ?? { id: crypto.randomUUID(), role: "user", parts: [] });
    if (!result) throw new Error("Agent stream did not finish");
    result.messages = metadata.read(ai.getMessages(), model);
    return result;
  } finally {
    ai.dispose();
  }
}

export async function runMessages(...args: Parameters<typeof run>): Promise<Message[]> {
  const result = await run(...args);
  if (result.status === "failed")
    throw Object.assign(new Error(result.error?.message ?? "Agent run failed"), { code: result.error?.code });
  if (result.status === "interrupted") throw new Error("This operation requires an interactive chat to continue.");
  if (result.status === "aborted") throw new DOMException("Agent run was cancelled.", "AbortError");
  if (result.status === "max_turns")
    throw Object.assign(new Error("Agent run reached its turn limit."), { code: "MAX_TURNS" });
  return result.messages;
}
