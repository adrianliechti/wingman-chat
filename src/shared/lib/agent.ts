import { EventType, type AGUIEvent, type RunFinishedEvent } from "@ag-ui/core";
import { EventSchema } from "@ag-ui/core/schemas";
import {
  chat,
  combineStrategies,
  defineAgent,
  normalizeToUIMessage,
  normalizeStreamChunk,
  modelMessagesToUIMessages,
  uiMessagesToWire,
  maxIterations,
  StreamProcessor,
  toolDefinition,
  untilFinishReason,
  type AgentLoopStrategy,
  type ChatMiddleware,
  type ContentPart,
  type ModelMessage,
  type RunAgentResumeItem,
  type TextPart,
  type ToolExecutionContext,
  type UIMessage,
} from "@tanstack/ai";
import type { AgentRunContext, MessageError, MessageUsage, Tool, ToolContext } from "../types/chat";
import type { AgentContext } from "../types/telemetry";
import type { Client, ClientRequestOptions } from "./client";
import { followAbortSignal } from "./abortSignals";
import {
  describeToolMessages,
  mapMessages,
  messageMetadata,
  textMetadata,
  textParts,
  userMessage,
  withTextPhases,
  type MessageMetadata,
  type ToolResultMetadata,
} from "./messages";
import { artifactDelta, artifactDeltaFromMeta, type ArtifactMutation } from "../types/artifact";
import { captureRequestContext, injectRequestContext } from "./requestContext";
import { aiDebug, isIntermediateToolTurn } from "./aiStream";
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
export type ChatOptions = NonNullable<Parameters<Client["chatOptions"]>[1]> & ClientRequestOptions;

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
 * Application data attached to the native transcript: tool display data and
 * rich error content, plus the run and usage of every model turn.
 */
export class RunSidecar {
  private readonly results = new Map<string, { metadata: ToolResultMetadata; content?: ContentPart[] }>();
  private readonly turns = new Map<string, Pick<MessageMetadata, "runId" | "usage">>();
  private readonly rejectedReasoning = new Set<string>();
  /** The gateway's output phases per assistant message; a snapshot rebuilt from the provider view loses them. */
  private readonly phasedText = new Map<string, TextPart[]>();

  result(toolCallId: string, metadata: ToolResultMetadata, content?: ContentPart[]) {
    const previous = this.results.get(toolCallId);
    this.results.set(toolCallId, {
      ...previous,
      metadata: { ...previous?.metadata, ...metadata },
      ...(content !== undefined ? { content } : {}),
    });
  }

  toolMeta(toolCallId: string) {
    return this.results.get(toolCallId)?.metadata.meta;
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

  captureTextParts(messages: ReadonlyMap<string, TextPart[]>) {
    for (const [id, parts] of messages) this.phasedText.set(id, parts);
  }

  captureHistory(messages: UIMessage[]) {
    mapMessages(messages, (message) => {
      const parts = textParts(message);
      if (parts.some((part) => textMetadata(part).phase)) this.phasedText.set(message.id, parts);
      else this.phasedText.delete(message.id);
      return message;
    });
  }

  /** Native all-text conversion drops part metadata; restore it only for matching provider context. */
  applyModelPhases(messages: ModelMessage[]): ModelMessage[] {
    return messages.map((message) => {
      const parts = message.id ? this.phasedText.get(message.id) : undefined;
      return message.role === "assistant" &&
        parts?.some((part) => textMetadata(part).phase) &&
        typeof message.content === "string" &&
        message.content === parts.map((part) => part.content).join("")
        ? { ...message, content: parts }
        : message;
    });
  }

  apply(messages: UIMessage[]): UIMessage[] {
    if (!this.results.size && !this.turns.size && !this.rejectedReasoning.size && !this.phasedText.size)
      return messages;
    return mapMessages(messages, (message) => {
      const turn = this.turns.get(message.id);
      const phased = this.phasedText.get(message.id);
      if (phased) message = withTextPhases(message, phased);
      const parts = message.parts.map((part) => {
        if (part.type === "tool-call") {
          const meta = this.results.get(part.id)?.metadata.meta;
          if (meta) return { ...part, metadata: { ...(part.metadata as Record<string, unknown>), meta } };
        }
        if (part.type === "tool-result") {
          const data = this.results.get(part.toolCallId);
          return data
            ? {
                ...part,
                ...(data.content !== undefined ? { content: data.content } : {}),
                metadata: { ...part.metadata, ...data.metadata },
              }
            : part;
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
      if (!turn && parts.every((part, index) => part === message.parts[index])) return message;
      return {
        ...message,
        parts,
        ...(turn ? { metadata: { ...message.metadata, ...turn } } : {}),
      };
    });
  }
}

export interface StreamRunHooks extends RunHooks {
  threadId: string;
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

function withSubagentApprovals(messages: UIMessage[], tools: Tool[]): UIMessage[] {
  const approvals = new Set(approvalTools(tools).map((tool) => tool.name));
  return mapMessages(messages, (message) => {
    const started = new Set(
      message.parts.flatMap((part) => (part.type === "subagent" ? [part.subagent.parentToolCallId] : [])),
    );
    return {
      ...message,
      parts: message.parts.map((part) =>
        part.type === "tool-call" && approvals.has(part.name) && started.has(part.id)
          ? {
              ...part,
              state: "approval-responded",
              approval: { id: part.approval?.id ?? part.id, needsApproval: true, approved: true },
            }
          : part,
      ),
    };
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
): AsyncGenerator<AGUIEvent> {
  const { controller: abortController, cleanup } = followAbortSignal(hooks.context?.signal, hooks.options?.signal);
  const invocation: AgentRunContext = {
    ...hooks.context,
    signal: abortController.signal,
  };
  const runId = hooks.runId ?? crypto.randomUUID();
  const { sidecar } = hooks;
  sidecar.captureHistory(messages);
  const childCalls = new Map<string, string>();
  const childMutations = new Map<string, ArtifactMutation[]>();
  let snapshot = () => messages;
  const finish = async (status: AgentRunResult["status"], error?: unknown, messages = snapshot()) => {
    await hooks.onComplete?.({ status, messages, ...(error ? { error: getErrorInfo(error) } : {}) });
  };

  try {
    abortController.signal.throwIfAborted();
    const telemetry = aiTelemetry(hooks.agentName ?? "chat", hooks.parentContext);
    const adapter = client.textAdapter(model, abortController.signal, telemetry.requestContext);
    let terminal: RunFinishedEvent | undefined;
    let failure: Error | undefined;
    let aborted = false;
    const captureAdapterMetadata = () => {
      sidecar.rejectReasoning(adapter.rejectedReasoning ?? []);
      if (adapter.textParts) sidecar.captureTextParts(adapter.textParts);
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
        if (ctx.phase !== "beforeModel") return;
        const providerMessages = describeToolMessages(
          sidecar.applyModelPhases(config.providerMessages ?? config.messages),
        );
        return {
          providerMessages: hooks.prepareMessages
            ? await hooks.prepareMessages(providerMessages, abortController.signal)
            : providerMessages,
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
          let error: MessageError | undefined;
          const signal = execution.abortSignal ?? abortController.signal;
          // Keep TanStack's per-run context identity: file observations belong
          // to this actor across tool calls, with native middleware cancellation.
          execution.context.signal = signal;
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
              invocationContext: execution.context,
              signal,
              agentContext: telemetry.toolContext(call.id),
              setMeta,
              setError: (next) => {
                error = next;
              },
            },
          });
          signal.throwIfAborted();
          // TanStack emits its error response when execution throws; restore
          // the tool's rich details as native content in the displayed transcript.
          sidecar.result(call.id, { meta }, error ? output : undefined);
          if (error) throw Object.assign(new Error(error.message), { code: error.code });
          // TanStack treats an empty array as JSON data rather than content.
          return output.length ? output : "";
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
            const input = ctx.input as { prompt: string };
            // The brief carries focus and recency with the one approved prompt.
            const prompt = (spec.brief?.(ctx.input as Record<string, unknown>) ?? input.prompt).trim();
            const childModel = spec.model ?? model;
            const parentSignal = ctx.abortSignal ?? abortController.signal;
            const signal = spec.timeoutMs
              ? AbortSignal.any([parentSignal, AbortSignal.timeout(spec.timeoutMs)])
              : parentSignal;
            signal.throwIfAborted();
            let direct: string | undefined;
            try {
              direct = await spec.direct?.(ctx.input as Record<string, unknown>, {
                model: childModel,
                signal,
                interruptible: true,
                runId: ctx.runId,
              });
              signal.throwIfAborted();
            } catch (error) {
              const info = getErrorInfo(signal.aborted ? signal.reason : error);
              if (info.code === "TIMEOUT") throw Object.assign(new Error(info.message), { code: info.code });
              throw error;
            }
            if (direct !== undefined) {
              // Keep the same native approval/result boundary, but return
              // retrieval text without starting a child model generation.
              return (async function* (): AsyncGenerator<AGUIEvent> {
                const messageId = `${ctx.subagentRunId}-direct`;
                yield { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" };
                if (direct) yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: direct };
                yield { type: EventType.TEXT_MESSAGE_END, messageId };
                yield { type: EventType.RUN_FINISHED, runId: ctx.runId, threadId: ctx.threadId, result: direct };
              })();
            }
            const isolated = spec.inheritHistory === false;
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
              isolated
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
                sharedMiddleware: isolated ? undefined : hooks.sharedMiddleware,
                agentName: tool.name,
                runId: ctx.runId,
                threadId: ctx.threadId,
                parentRunId: ctx.parentRunId,
                subagentRunId: ctx.subagentRunId,
                resume: ctx.resume,
                context: { ...(isolated ? {} : invocation), subagentRunId: ctx.subagentRunId },
                options: { signal },
                ...(spec.maxIterations ? { agentLoopStrategy: maxIterations(spec.maxIterations) } : {}),
                parentContext: telemetry.toolContext(childCalls.get(ctx.subagentRunId) ?? ctx.subagentRunId),
                createToolContext: isolated ? undefined : hooks.createToolContext,
                onToolMeta: hooks.onToolMeta,
                prepareMessages: async (messages, signal) =>
                  hooks.prepareMessages && !isolated
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
      messages: hooks.resume?.length ? withSubagentApprovals(messages, tools) : withoutAbandonedCalls(messages),
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
      ...client.chatOptions(model, { ...hooks.options, summary: hooks.options?.summary ?? "auto" }),
      // A cut answer ends the run. Otherwise TanStack asks again after a
      // truncated tool call until the iteration budget runs out. The gateway's
      // Responses adapter reports truncation as RUN_ERROR, so this guards
      // adapters that finish with "length".
      agentLoopStrategy: combineStrategies([
        hooks.agentLoopStrategy ?? maxIterations(100),
        untilFinishReason(["length"]),
      ]),
      middleware: [
        telemetry,
        // Checkpoints must see the canonical transcript. Request-only context
        // and attachment loading then operate on the compacted provider view.
        ...(hooks.sharedMiddleware?.(abortController.signal, invocation) ?? []),
        middleware,
        ...(hooks.middleware ?? []),
      ],
    });
    for await (const output of stream) {
      abortController.signal.throwIfAborted();
      captureAdapterMetadata();
      // TanStack restores legacy usage objects on its in-process iterable.
      // Normalize its extensions and validate the public events against the
      // SDK so browser-local consumers receive the same AG-UI wire shapes.
      for (const normalized of normalizeStreamChunk(output)) {
        let chunk = EventSchema.parse(normalized);
        if (chunk.type === EventType.RUN_ERROR) {
          // ChatClient's Error drops event metadata, including retryAfterMs.
          // Format the advertised delay before crossing that boundary.
          const info = getErrorInfo(chunk);
          if (info.code === "RATE_LIMIT_ERROR") chunk = { ...chunk, ...info };
        }
        if (chunk.type === EventType.SUBAGENT_STARTED && chunk.parentToolCallId)
          childCalls.set(chunk.subagentRunId, chunk.parentToolCallId);
        if (
          chunk.type === EventType.RUN_FINISHED &&
          (!("subagentRunId" in chunk) || chunk.subagentRunId === hooks.subagentRunId) &&
          !isIntermediateToolTurn(chunk)
        ) {
          terminal = chunk;
          continue;
        }
        if (
          chunk.type === EventType.RUN_ERROR &&
          (!("subagentRunId" in chunk) || chunk.subagentRunId === hooks.subagentRunId)
        ) {
          failure = Object.assign(new Error(chunk.message), {
            code: chunk.code,
            rawEvent: chunk.rawEvent,
            metadata: chunk.metadata,
          });
        }
        yield chunk;
      }
    }
    abortController.signal.throwIfAborted();
    if (adapter.needsMessageSnapshot) {
      // AG-UI text deltas cannot rewrite prior content. Publish TanStack's
      // canonical transcript after an authoritative replacement or replay
      // recovery, so the client and persistence see the same messages.
      yield { type: EventType.MESSAGES_SNAPSHOT, messages: uiMessagesToWire(snapshot()) };
    }
    if (failure) {
      await finish("failed", failure);
      return;
    }
    await finish(aborted ? "aborted" : terminal?.outcome?.type === "interrupt" ? "interrupted" : "completed");
    if (terminal) yield terminal;
  } catch (error) {
    const reason = abortController.signal.aborted ? abortController.signal.reason : error;
    const info = getErrorInfo(reason);
    const aborted = info.code !== "TIMEOUT" && (abortController.signal.aborted || isAbortError(reason));
    await finish(aborted ? "aborted" : "failed", reason);
    if (!aborted) {
      yield { type: EventType.RUN_ERROR, message: info.message, code: info.code };
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
      threadId: hooks.threadId ?? crypto.randomUUID(),
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
