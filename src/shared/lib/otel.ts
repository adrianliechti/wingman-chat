import { context, metrics, propagation, trace } from "@opentelemetry/api";
import { otelMiddleware } from "@tanstack/ai/middlewares/otel";
import type { AgentContext, AgentIdentity, ToolTelemetry } from "../types/telemetry";

const toolSpans = new WeakMap<object, Map<string, AgentContext>>();

/** Annotate one native tool call using its run context, never async global state. */
export function annotateToolCall(ctx: object, callId: string, attributes: Record<string, string>) {
  const parent = toolSpans.get(ctx)?.get(callId);
  if (parent) trace.getSpan(parent)?.setAttributes(attributes);
}

/** Propagate the request's trace context across asynchronous work. */
export function telemetryHeaders(parent: AgentContext, headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  propagation.inject(parent, result, { set: (carrier, key, value) => carrier.set(key, String(value)) });
  return result;
}

/** Browser spans describe chat activity; gateway provider spans own accounting. */
export function aiTelemetry(
  operation: string,
  parentContext?: AgentContext,
  options: {
    conversationId?: string;
    agent?: AgentIdentity;
    tools?: readonly { name: string; telemetry?: ToolTelemetry }[];
  } = {},
) {
  const tracer = trace.getTracer("wingman");
  const base = parentContext ?? context.active();
  const tools = new Map<string, AgentContext>();
  const identities = new Map(options.tools?.map((tool) => [tool.name, tool.telemetry]));
  const outcomes = new WeakMap<object, string>();
  const agentAttributes = (agent?: AgentIdentity) =>
    agent
      ? {
          "gen_ai.agent.id": agent.id,
          "gen_ai.agent.name": agent.name,
          "wingman.agent.kind": agent.kind,
        }
      : {};
  let requestContext = base;
  const middleware = otelMiddleware({
    tracer: {
      startSpan: (name, options, parent) => {
        const parentCtx = parent ?? base;
        const span = tracer.startSpan(name, options, parentCtx);
        const spanContext = trace.setSpan(parentCtx, span);
        const callId = options?.attributes?.["gen_ai.tool.call.id"];
        if (typeof callId === "string") tools.set(callId, spanContext);
        else requestContext = spanContext;
        return span;
      },
      startActiveSpan: tracer.startActiveSpan.bind(tracer),
    },
    meter: metrics.getMeter("wingman"),
    captureContent: false,
    attributeEnricher: (info) => {
      if (info.kind === "tool") toolSpans.set(info.ctx, tools);
      const identity = info.kind === "tool" ? identities.get(info.toolName) : undefined;
      return {
        "wingman.operation.name": operation,
        ...(options.conversationId ? { "gen_ai.conversation.id": options.conversationId } : {}),
        ...agentAttributes(options.agent),
        ...(info.kind === "chat" && options.agent?.kind === "configured"
          ? { "gen_ai.operation.name": "invoke_agent" }
          : {}),
        ...(info.kind === "tool" ? { "gen_ai.operation.name": "execute_tool" } : {}),
        ...(identity?.serverId ? { "wingman.mcp.server.id": identity.serverId } : {}),
        ...(identity?.serverName ? { "wingman.mcp.server.name": identity.serverName } : {}),
        ...(identity?.pluginId ? { "wingman.plugin.id": identity.pluginId } : {}),
        ...(identity?.agent
          ? {
              "gen_ai.transfer.target.name": identity.agent.name,
              "gen_ai.transfer.mode": "return_to_caller",
              "wingman.transfer.target.id": identity.agent.id,
              "wingman.transfer.target.kind": identity.agent.kind,
            }
          : {}),
      };
    },
    onSpanEnd: (info, span) => {
      if (info.kind === "tool") tools.delete(info.toolCallId);
      if (info.kind === "chat" && options.agent?.kind === "configured")
        span.setAttribute("wingman.agent.outcome", outcomes.get(info.ctx) ?? "unknown");
    },
  });
  const { onFinish, onError, onAbort } = middleware;
  return Object.assign(middleware, {
    onFinish: (...args: Parameters<NonNullable<typeof onFinish>>) => {
      outcomes.set(args[0], "success");
      return onFinish?.(...args);
    },
    onError: (...args: Parameters<NonNullable<typeof onError>>) => {
      outcomes.set(args[0], "error");
      return onError?.(...args);
    },
    onAbort: (...args: Parameters<NonNullable<typeof onAbort>>) => {
      outcomes.set(args[0], "aborted");
      return onAbort?.(...args);
    },
    requestContext: () => requestContext,
    // Native subagents can start before their streamed parent-call ID arrives.
    // Keep those children under this run's model span, rather than a new trace.
    toolContext: (callId: string) => tools.get(callId) ?? requestContext,
  });
}
