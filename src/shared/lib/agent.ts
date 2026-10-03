import {
  chat,
  defineAgent,
  normalizeToUIMessage,
  modelMessagesToUIMessages,
  uiMessagesToWire,
  maxIterations,
  StreamProcessor,
  toolDefinition,
  type AgentLoopStrategy,
  type ChatMiddleware,
  type ModelMessage,
  type RunAgentResumeItem,
  type StreamChunk,
  type ToolExecutionContext,
  type UIMessage,
} from "@tanstack/ai";
import type { AgentRunContext, MessageUsage, Tool, ToolContext } from "../types/chat";
import type { AgentContext } from "../types/telemetry";
import type { Client, ClientRequestOptions } from "./client";
import { followAbortSignal } from "./abortSignals";
import {
  describeToolOutput,
  mapMessages,
  messageMetadata,
  userMessage,
  type MessageMetadata,
  type TextSegment,
  type ToolResultMetadata,
} from "./messages";
import { artifactDelta, artifactDeltaFromMeta, type ArtifactMutation } from "../types/artifact";
import { captureRequestContext, injectRequestContext } from "./requestContext";
import { aiDebug } from "./aiStream";
import { getErrorInfo, isAbortError } from "./errors";
import { aiTelemetry } from "./otel";
import { packGatewayReasoning, readGatewayReasoning } from "./reasoning";

export type AgentRunStatus = "completed" | "interrupted" | "aborted" | "failed";

export interface AgentRunResult {
  status: AgentRunStatus;
  messages: UIMessage[];
  error?: { code: string; message: string };
}

/** Provider configuration shared by chat, subagents, and isolated interpreter calls. */
export type ChatOptions = NonNullable<Parameters<Client["chatModelOptions"]>[1]> & ClientRequestOptions;

/** A tool invocation as the runtime reports it. */
interface ToolCall {
  id: string;
  name: string;
}

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

  /** Identifier for this agent (e.g. `"chat"` or `"research"`), reported as the telemetry operation name. */
  agentName?: string;

  /**
   * Build a ToolContext for a given tool call (chat uses this for elicitation,
   * render, etc.). The harness injects tracing and metadata helpers.
   */
  createToolContext?: (toolCall: ToolCall, execution: ToolExecutionContext<AgentRunContext>) => ToolContext | undefined;

  /** Fires on every `setMeta` — both live (during execution) and late (after commit). */
  onToolMeta?: (toolCallId: string, meta: Record<string, unknown>) => void;

  /** Transform the provider view before each model call (chat prunes at summary boundaries here). */
  prepareMessages?: (messages: ModelMessage[], signal: AbortSignal) => ModelMessage[] | Promise<ModelMessage[]>;

  /** Native loop strategy; defaults to 100 model turns per run. */
  agentLoopStrategy?: AgentLoopStrategy;

  /** Provider settings and cancellation for this run. */
  options?: ChatOptions;

  /**
   * Parent trace context for nested agents spawned from a tool.
   */
  parentContext?: AgentContext;
}

/**
 * What the runtime holds only as text, kept beside the run and attached to the
 * transcript it persists: each tool's rich output and display data, and the
 * run and usage of every model turn.
 */
export class RunSidecar {
  private readonly results = new Map<string, ToolResultMetadata>();
  private readonly turns = new Map<string, Pick<MessageMetadata, "runId" | "usage">>();
  private readonly rejectedReasoning = new Set<string>();
  /** The gateway's output phases per assistant message; a snapshot rebuilt from the provider view loses them. */
  private readonly textSegments = new Map<string, TextSegment[]>();

  result(toolCallId: string, data: ToolResultMetadata) {
    this.results.set(toolCallId, { ...this.results.get(toolCallId), ...data });
  }

  toolMeta(toolCallId: string) {
    return this.results.get(toolCallId)?.meta;
  }

  turn(id: string, runId: string, usage?: MessageUsage) {
    this.turns.set(id, {
      ...this.turns.get(id),
      runId,
      ...(usage ? { usage } : {}),
    });
  }

  rejectReasoning(payloads: Iterable<string>) {
    for (const payload of payloads) this.rejectedReasoning.add(payload);
  }

  captureTextSegments(segments: ReadonlyMap<string, TextSegment[]>) {
    for (const [id, parts] of segments) this.textSegments.set(id, parts);
  }

  apply(messages: UIMessage[]): UIMessage[] {
    if (!this.results.size && !this.turns.size && !this.rejectedReasoning.size && !this.textSegments.size)
      return messages;
    return mapMessages(messages, (message) => {
      const turn = this.turns.get(message.id);
      const segments = this.textSegments.get(message.id);
      const parts = message.parts.map((part) => {
        if (part.type === "tool-result") {
          const data = this.results.get(part.toolCallId);
          return data ? { ...part, metadata: { ...part.metadata, ...data } } : part;
        }
        // A provider rejected this ciphertext once; it must not come back after a reload.
        if (part.type === "thinking" && part.signature && this.rejectedReasoning.size) {
          const state = readGatewayReasoning(part.signature);
          return state.encryptedContent && this.rejectedReasoning.has(state.encryptedContent)
            ? { ...part, signature: packGatewayReasoning({ ...state, encryptedContent: undefined }) }
            : part;
        }
        return part;
      });
      if (!turn && !segments && parts.every((part, index) => part === message.parts[index])) return message;
      return {
        ...message,
        parts,
        ...(turn || segments
          ? { metadata: { ...message.metadata, ...turn, ...(segments ? { textSegments: segments } : {}) } }
          : {}),
      };
    });
  }
}

export interface StreamRunHooks extends RunHooks {
  sidecar: RunSidecar;
  parentRunId?: string;
  resume?: RunAgentResumeItem[];
  subagentRunId?: string;
  onComplete?: (result: AgentRunResult) => void | Promise<void>;
}

export function approvalTools(tools: Tool[]): ReturnType<typeof toolDefinition>[] {
  return tools.flatMap((tool) => [
    ...(tool.needsApproval
      ? [
          toolDefinition({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            lazy: tool.lazy,
            needsApproval: true,
          }),
        ]
      : []),
    ...(tool.subagent ? approvalTools(tool.subagent.tools) : []),
  ]);
}

/**
 * Outstanding calls belong to an explicit interrupt continuation. A fresh send
 * must not replay a call abandoned by Stop or reload, so it leaves the provider
 * view as if its arguments never finished.
 */
function withoutAbandonedCalls(messages: UIMessage[]): UIMessage[] {
  return mapMessages(messages, (message) => {
    const answered = new Set(message.parts.flatMap((part) => (part.type === "tool-result" ? [part.toolCallId] : [])));
    const parts = message.parts.map((part) =>
      part.type === "tool-call" &&
      part.state !== "input-streaming" &&
      part.output === undefined &&
      !answered.has(part.id)
        ? { ...part, state: "input-streaming" as const }
        : part,
    );
    return parts.some((part, index) => part !== message.parts[index]) ? { ...message, parts } : message;
  });
}

/** Browser-local connection stream. chat() owns every model/tool iteration. */
export async function* streamRun(
  client: Client,
  model: string,
  instructions: string,
  messages: UIMessage[],
  tools: Tool[],
  hooks: StreamRunHooks,
): AsyncGenerator<StreamChunk> {
  const { controller: abortController, cleanup } = followAbortSignal(hooks.context?.signal, hooks.options?.signal);
  const invocation: AgentRunContext = {
    ...hooks.context,
    signal: abortController.signal,
  };
  const runId = hooks.runId ?? crypto.randomUUID();
  const { sidecar } = hooks;
  const childCalls = new Map<string, string>();
  const childMutations = new Map<string, ArtifactMutation[]>();
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
    let aborted = false;
    const captureAdapterMetadata = () => {
      sidecar.rejectReasoning(adapter.rejectedReasoning ?? []);
      if (adapter.textSegments) sidecar.captureTextSegments(adapter.textSegments);
    };
    const remember = (ctx: Parameters<NonNullable<ChatMiddleware["onStart"]>>[0]) => {
      captureAdapterMetadata();
      snapshot = () => sidecar.apply(modelMessagesToUIMessages([...ctx.messages]));
    };
    const middleware: ChatMiddleware<AgentRunContext> = {
      onFinish: remember,
      onError: remember,
      onAbort: (ctx) => {
        aborted = true;
        remember(ctx);
      },
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
        if (ctx.phase !== "beforeModel" || !hooks.prepareMessages) return;
        return {
          providerMessages: await hooks.prepareMessages(
            config.providerMessages ?? config.messages,
            abortController.signal,
          ),
        };
      },
      onIteration: (ctx) => {
        if (ctx.currentMessageId) sidecar.turn(ctx.currentMessageId, runId);
      },
      onUsage: (ctx, usage) => {
        captureAdapterMetadata();
        if (ctx.currentMessageId)
          sidecar.turn(ctx.currentMessageId, runId, {
            model: adapter.responseInfo?.model ?? model,
            reasoningContext: adapter.responseInfo?.reasoningContext,
            inputTokens: usage.promptTokens,
            outputTokens: usage.completionTokens,
            cachedInputTokens: usage.promptTokensDetails?.cachedTokens,
            reasoningTokens: usage.completionTokensDetails?.reasoningTokens,
          });
      },
      onAfterToolCall: (_ctx, call) => {
        const childId = [...childCalls].find(([, id]) => id === call.toolCallId)?.[0];
        const mutations = childId ? childMutations.get(childId) : undefined;
        if (mutations?.length) sidecar.result(call.toolCallId, { meta: { artifactDelta: artifactDelta(mutations) } });
      },
    };
    const nativeTools = tools
      .filter((tool) => !tool.subagent)
      .map((tool) =>
        toolDefinition({ ...tool, outputSchema: undefined }).server<AgentRunContext>(async (input, execution) => {
          const call: ToolCall = {
            id: execution?.toolCallId ?? crypto.randomUUID(),
            name: tool.name,
          };
          let meta: Record<string, unknown> = {};
          let content: Record<string, unknown> | undefined;
          let error: ToolResultMetadata["error"];
          const signal = execution.abortSignal ?? abortController.signal;
          const setMeta = (next: Record<string, unknown>) => {
            if (signal.aborted) return;
            meta = next;
            sidecar.result(call.id, { meta });
            hooks.onToolMeta?.(call.id, { ...meta });
          };
          const output = await tool.execute(input as Record<string, unknown>, {
            ...execution,
            toolCallId: call.id,
            abortSignal: signal,
            context: {
              ...hooks.createToolContext?.(call, execution),
              model,
              interruptible: true,
              inputResponse: execution?.inputResponse,
              runId,
              invocationContext: { ...execution.context, signal },
              signal,
              agentContext: telemetry.toolContext(call.id),
              setMeta,
              setContent: (next) => {
                content = next;
              },
              setError: (next) => {
                error = next;
              },
            },
          });
          signal.throwIfAborted();
          sidecar.result(call.id, {
            result: output,
            meta,
            ...(content ? { content } : {}),
            ...(error ? { error } : {}),
          });
          if (error) throw Object.assign(new Error(error.message), { code: error.code });
          return describeToolOutput(output);
        }),
      );
    const agents = tools.flatMap((tool) => {
      const spec = tool.subagent;
      if (!spec) return [];
      return [
        defineAgent({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          run: async (ctx) => {
            const { prompt } = ctx.input as { prompt: string };
            const childModel = spec.model ?? model;
            const parentSignal = ctx.abortSignal ?? abortController.signal;
            const signal = spec.timeoutMs
              ? AbortSignal.any([parentSignal, AbortSignal.timeout(spec.timeoutMs)])
              : parentSignal;
            signal.throwIfAborted();
            const direct = await spec.direct?.(ctx.input as Record<string, unknown>, {
              model: childModel,
              signal,
              interruptible: true,
              runId: ctx.runId,
            });
            signal.throwIfAborted();
            if (direct !== undefined) {
              // Keep the same native approval/result boundary, but return
              // retrieval text without starting a child model generation.
              return (async function* (): AsyncGenerator<StreamChunk> {
                const messageId = `${ctx.subagentRunId}-direct`;
                yield { type: "TEXT_MESSAGE_START", messageId, role: "assistant" } as StreamChunk;
                yield { type: "TEXT_MESSAGE_CONTENT", messageId, delta: direct } as StreamChunk;
                yield { type: "TEXT_MESSAGE_END", messageId } as StreamChunk;
                yield { type: "RUN_FINISHED", runId: ctx.runId, threadId: ctx.threadId, result: direct } as StreamChunk;
              })();
            }
            const history = sidecar.apply(
              ctx.messages.map((message) => normalizeToUIMessage(message, () => crypto.randomUUID())),
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
                    userMessage(prompt, { id: `${ctx.subagentRunId}-prompt` }),
                    // Native resume includes the parent prefix and the child's
                    // work. A brief-only child retains just its own work.
                    ...history.filter((message) => messageMetadata(message).runId?.includes(ctx.subagentRunId)),
                  ]
                : history,
              spec.tools,
              {
                sidecar,
                middleware: spec.middleware,
                sharedMiddleware: hooks.sharedMiddleware,
                agentName: tool.name,
                runId: ctx.runId,
                threadId: ctx.threadId,
                parentRunId: ctx.parentRunId,
                subagentRunId: ctx.subagentRunId,
                resume: ctx.resume,
                context: { ...invocation, subagentRunId: ctx.subagentRunId },
                options: { signal },
                ...(spec.maxIterations ? { agentLoopStrategy: maxIterations(spec.maxIterations) } : {}),
                parentContext: telemetry.toolContext(childCalls.get(ctx.subagentRunId) ?? ctx.subagentRunId),
                createToolContext: hooks.createToolContext,
                onToolMeta: hooks.onToolMeta,
                prepareMessages: async (messages, signal) =>
                  hooks.prepareMessages && spec.inheritHistory !== false
                    ? injectRequestContext(await hooks.prepareMessages(messages, signal), `Delegated task: ${prompt}`)
                    : injectRequestContext(messages, context),
                onComplete: (result) => {
                  const mutations = result.messages
                    .filter((message) => messageMetadata(message).runId?.includes(ctx.subagentRunId))
                    .flatMap((message) => message.parts)
                    .flatMap((part) =>
                      part.type === "tool-result"
                        ? (artifactDeltaFromMeta((part.metadata as ToolResultMetadata | undefined)?.meta)?.mutations ??
                          [])
                        : [],
                    );
                  childMutations.set(ctx.subagentRunId, mutations);
                },
              },
            );
          },
        }),
      ];
    });
    const stream = chat({
      adapter,
      messages: hooks.resume?.length ? messages : withoutAbandonedCalls(messages),
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
      modelOptions: client.chatModelOptions(model, { ...hooks.options, summary: hooks.options?.summary ?? "auto" }),
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
    if (adapter.needsMessageSnapshot) {
      // AG-UI text deltas cannot rewrite prior content. Publish TanStack's
      // canonical transcript after an authoritative replacement or replay
      // recovery, so the client and persistence see the same messages.
      yield { type: "MESSAGES_SNAPSHOT", messages: uiMessagesToWire(snapshot()) } as StreamChunk;
    }
    if (failure) {
      await finish("failed", failure);
      return;
    }
    await finish(aborted ? "aborted" : terminal?.outcome?.type === "interrupt" ? "interrupted" : "completed");
    if (terminal) yield terminal;
  } catch (error) {
    const aborted = abortController.signal.aborted || isAbortError(error);
    await finish(aborted ? "aborted" : "failed", error);
    if (!aborted) {
      const info = getErrorInfo(error);
      yield { type: "RUN_ERROR", message: info.message, code: info.code } as StreamChunk;
    }
  } finally {
    cleanup();
  }
}

/** One-shot callers collect the native stream without an interactive ChatClient. */
export async function run(
  client: Client,
  model: string,
  instructions: string,
  messages: UIMessage[],
  tools: Tool[],
  hooks: RunHooks = {},
): Promise<AgentRunResult> {
  const sidecar = new RunSidecar();
  let result: AgentRunResult | undefined;
  const processor = new StreamProcessor({ initialMessages: messages });
  await processor.process(
    streamRun(client, model, instructions, messages, tools, {
      ...hooks,
      sidecar,
      onComplete: (value) => {
        result = value;
      },
    }),
  );
  if (!result) throw new Error("Agent stream did not finish");
  return { ...result, messages: sidecar.apply(processor.getMessages()) };
}

export async function runMessages(...args: Parameters<typeof run>): Promise<UIMessage[]> {
  const result = await run(...args);
  if (result.status === "failed")
    throw Object.assign(new Error(result.error?.message ?? "Agent run failed"), { code: result.error?.code });
  if (result.status === "interrupted") throw new Error("This operation requires an interactive chat to continue.");
  if (result.status === "aborted") throw new DOMException("Agent run was cancelled.", "AbortError");
  return result.messages;
}
