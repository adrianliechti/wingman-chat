import {
  chat,
  defineAgent,
  normalizeToUIMessage,
  convertMessagesToModelMessages,
  modelMessagesToUIMessages,
  maxIterations,
  StreamProcessor,
  toolDefinition,
  type AgentLoopStrategy,
  type ChatMiddleware,
  type RunAgentResumeItem,
  type StreamChunk,
  type UIMessage,
} from "@tanstack/ai";
import { z } from "zod";
import {
  withMessageIdentity,
  updateToolResultMeta,
  type Message,
  type Tool,
  type ToolCallContent,
  type ToolContext,
  type AgentRunContext,
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

export type AgentRunStatus = "completed" | "interrupted" | "aborted" | "failed";

export interface AgentRunResult {
  status: AgentRunStatus;
  messages: Message[];
  error?: Message["error"];
}

/** Provider configuration shared by chat, subagents, and isolated interpreter calls. */
export type ChatOptions = NonNullable<Parameters<Client["chatModelOptions"]>[1]> & ClientRequestOptions;

/** Per-turn hooks the caller can supply. All optional. */
export interface RunHooks {
  /** Provider-owned native extensions, scoped by TanStack to this invocation. */
  middleware?: ChatMiddleware[];
  /** App policies instantiated for this run and each native child, with that run's cancellation. */
  sharedMiddleware?: (signal: AbortSignal, context: AgentRunContext) => ChatMiddleware[];
  /** Conversation identity shared by TanStack runs and diagnostics. */
  threadId?: string;

  /** Stable run id supplied by a durable caller. Generated when omitted. */
  runId?: string;

  /** Application context for cancellation and workspace isolation. */
  context?: AgentRunContext;

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

  /** Fires on every `setMeta`/`updateMeta` — both live (during execution) and late (after commit). */
  onToolMeta?: (toolCallId: string, meta: Record<string, unknown>) => void;

  /**
   * Transform messages before they're sent to the LLM. Used by chat to prune
   * at summary boundaries.
   */
  prepareMessages?: (messages: Message[]) => Message[] | Promise<Message[]>;

  /** Native loop strategy; defaults to 100 model turns per run. */
  agentLoopStrategy?: AgentLoopStrategy;

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

  toolMeta(toolCallId: string) {
    return this.results.get(toolCallId)?.content.find((part) => part.type === "tool_result")?.meta;
  }

  turn(id: string, runId: string, usage?: Message["usage"]) {
    this.runs.set(id, runId);
    if (usage) this.usage.set(id, usage);
  }

  read(messages: UIMessage[], model?: string): Message[] {
    return this.enrich(fromAIMessages(messages, undefined, model));
  }

  private enrich(messages: Message[]): Message[] {
    return messages.map((message) => {
      const part = message.content.find((item) => item.type === "tool_result");
      const saved = part && this.results.get(part.id);
      if (saved) return saved;
      return {
        ...message,
        content: message.content.map((part) =>
          part.type === "subagent"
            ? {
                ...part,
                messages: this.enrich(part.messages),
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
  const combined = combineAbortSignals(hooks.context?.signal, hooks.options?.signal);
  const abortController = new AbortController();
  const abort = () => abortController.abort(combined.signal?.reason);
  if (combined.signal?.aborted) abort();
  else combined.signal?.addEventListener("abort", abort, { once: true });
  const invocation: AgentRunContext = {
    ...hooks.context,
    signal: abortController.signal,
  };
  const runId = hooks.runId ?? crypto.randomUUID();
  const childCalls = new Map<string, string>();
  const childResults = new Map<string, Message[]>();
  let snapshot = () => messages;
  const finish = async (status: AgentRunResult["status"], error?: unknown, messages = snapshot()) => {
    await hooks.onComplete?.({ status, messages, ...(error ? { error: getErrorInfo(error) } : {}) });
  };

  try {
    abortController.signal.throwIfAborted();
    const adapter = client.textAdapter(model, abortController.signal);
    const telemetry = aiTelemetry(hooks.agentName ?? "chat", hooks.parentContext);
    let terminal: Extract<StreamChunk, { type: "RUN_FINISHED" }> | undefined;
    let failure: Error | undefined;
    const remember = (ctx: Parameters<NonNullable<ChatMiddleware["onStart"]>>[0]) => {
      snapshot = () => hooks.metadata.read(modelMessagesToUIMessages([...ctx.messages]), model);
    };
    const middleware: ChatMiddleware<AgentRunContext> = {
      onFinish: remember,
      onError: remember,
      onAbort: remember,
      onConfig: async (ctx, config) => {
        remember(ctx);
        if (ctx.phase === "init")
          return {
            tools: config.tools.map((native) =>
              tools.some((tool) => tool.subagent && tool.name === native.name && tool.needsApproval)
                ? { ...native, needsApproval: true }
                : native,
            ),
          };
        if (ctx.phase !== "beforeModel") return;
        if (hooks.prepareMessages)
          return {
            providerMessages: convertMessagesToModelMessages(
              toAIMessages(
                await hooks.prepareMessages(
                  fromAIMessages(
                    modelMessagesToUIMessages(config.providerMessages ?? config.messages),
                    undefined,
                    model,
                    false,
                  ),
                ),
                model,
              ),
            ),
          };
        return undefined;
      },
      onIteration: (ctx) => {
        if (ctx.currentMessageId) hooks.metadata.turn(ctx.currentMessageId, runId);
      },
      onUsage: (ctx, usage) => {
        if (ctx.currentMessageId)
          hooks.metadata.turn(ctx.currentMessageId, runId, {
            model: adapter.responseInfo?.model ?? model,
            reasoningContext: adapter.responseInfo?.reasoningContext,
            inputTokens: usage.promptTokens,
            outputTokens: usage.completionTokens,
            cachedInputTokens: usage.promptTokensDetails?.cachedTokens,
            reasoningTokens: usage.completionTokensDetails?.reasoningTokens,
          });
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
              runId,
            ),
          );
        }
      },
    };
    const nativeTools = tools
      .filter((tool) => !tool.subagent)
      .map((tool) =>
        chatToolDefinition(tool).server<AgentRunContext>(async (input, execution) => {
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
            model,
            interruptible: true,
            inputResponse: execution?.inputResponse,
            runId,
            invocationContext: execution?.context,
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
            runId,
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
          inputSchema: chatToolDefinition(tool).inputSchema,
          run: (ctx) => {
            const { prompt } = ctx.input as { prompt: string };
            const childModel = spec.model ?? model;
            const history = hooks.metadata.read(
              ctx.messages.map((message) => normalizeToUIMessage(message, () => crypto.randomUUID())),
              childModel,
            );
            const context = captureRequestContext(
              [spec.runtimeContext, `Delegated task: ${prompt}`].filter(Boolean).join("\n\n"),
            );
            return streamRun(
              client,
              childModel,
              spec.instructions,
              spec.inheritHistory === false
                ? [
                    { id: `${ctx.subagentRunId}-prompt`, role: "user", content: [{ type: "text", text: prompt }] },
                    // Native resume includes the parent prefix and the child's
                    // work. A brief-only child retains just its own work.
                    ...history.filter((message) => message.runId?.includes(ctx.subagentRunId)),
                  ]
                : history,
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
                context: { ...invocation, subagentRunId: ctx.subagentRunId },
                options: { signal: ctx.abortSignal },
                parentContext: telemetry.toolContext(childCalls.get(ctx.subagentRunId) ?? ctx.subagentRunId),
                createToolContext: hooks.createToolContext,
                onToolMeta: hooks.onToolMeta,
                prepareMessages: async (messages) =>
                  hooks.prepareMessages && spec.inheritHistory !== false
                    ? injectRequestContext(await hooks.prepareMessages(messages), `Delegated task: ${prompt}`)
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
      messages: toAIMessages(messages, model, { pendingToolCalls: !!hooks.resume?.length }),
      systemPrompts: [instructions],
      tools: nativeTools,
      ...(agents.length ? { subagents: { agents } } : {}),
      lazyToolsConfig: { includeDescription: "first-sentence" },
      abortController,
      context: invocation,
      runId,
      threadId: hooks.threadId,
      parentRunId: hooks.parentRunId,
      resume: hooks.resume,
      subagentRunId: hooks.subagentRunId,
      debug: aiDebug,
      modelOptions: client.chatModelOptions(model, hooks.options),
      agentLoopStrategy: hooks.agentLoopStrategy ?? maxIterations(100),
      middleware: [
        telemetry,
        // Checkpoints must see the canonical transcript. Request-only context
        // and attachment loading then operate on the compacted provider view.
        ...(hooks.sharedMiddleware?.(abortController.signal, invocation) ?? []),
        middleware,
        ...(hooks.middleware ?? []),
      ],
    });
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
      if (chunk.type === "RUN_ERROR" && (!("subagentRunId" in chunk) || chunk.subagentRunId === hooks.subagentRunId)) {
        failure = Object.assign(new Error(chunk.message), { code: chunk.code });
      }
      yield chunk;
    }
    abortController.signal.throwIfAborted();
    if (failure) {
      await finish("failed", failure);
      return;
    }
    await finish(terminal?.outcome?.type === "interrupt" ? "interrupted" : "completed");
    if (terminal) yield terminal;
  } catch (error) {
    const aborted = abortController.signal.aborted || isAbortError(error);
    await finish(aborted ? "aborted" : "failed", error);
    if (!aborted) {
      const info = getErrorInfo(error);
      yield { type: "RUN_ERROR", message: info.message, code: info.code } as StreamChunk;
    }
  } finally {
    combined.signal?.removeEventListener("abort", abort);
    combined.cleanup();
  }
}

/** One-shot callers collect the native stream without an interactive ChatClient. */
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
  const processor = new StreamProcessor({ initialMessages: toAIMessages(messages, model) });
  await processor.process(
    streamRun(client, model, instructions, messages, tools, {
      ...hooks,
      metadata,
      onComplete: (value) => {
        result = value;
      },
    }),
  );
  if (!result) throw new Error("Agent stream did not finish");
  return { ...result, messages: metadata.read(processor.getMessages(), model) };
}

export async function runMessages(...args: Parameters<typeof run>): Promise<Message[]> {
  const result = await run(...args);
  if (result.status === "failed")
    throw Object.assign(new Error(result.error?.message ?? "Agent run failed"), { code: result.error?.code });
  if (result.status === "interrupted") throw new Error("This operation requires an interactive chat to continue.");
  if (result.status === "aborted") throw new DOMException("Agent run was cancelled.", "AbortError");
  return result.messages;
}
