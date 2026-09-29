import { type Attributes, context, metrics, type Span, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { otelMiddleware } from "@tanstack/ai/middlewares/otel";
import type { AgentContext } from "../types/telemetry";

const PROVIDER_NAME = "wingman";

const tracer = trace.getTracer("wingman");
const meter = metrics.getMeter("wingman");

const operationDuration = meter.createHistogram("gen_ai.client.operation.duration", {
  description: "GenAI operation duration",
  unit: "s",
});

async function traceSpan<T>(
  setup: {
    name: string;
    kind: SpanKind;
    attrs: Attributes;
    metricAttrs: () => Attributes;
    parentContext?: AgentContext;
  },
  body: (span: Span, ctx: AgentContext) => Promise<T>,
): Promise<T> {
  if (import.meta.env.DEV && !setup.parentContext && trace.getSpan(context.active())) {
    console.warn(`[otel] ${setup.name}: no parentContext but an active span exists; nesting may be wrong`);
  }
  const parent = setup.parentContext ?? context.active();
  return tracer.startActiveSpan(setup.name, { kind: setup.kind, attributes: setup.attrs }, parent, async (span) => {
    const childContext = trace.setSpan(parent, span);
    const start = performance.now();
    let errorType: string | undefined;
    try {
      return await body(span, childContext);
    } catch (error) {
      errorType = error instanceof Error ? error.constructor.name : "Error";
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      span.setAttribute("error.type", errorType);
      throw error;
    } finally {
      const durationS = (performance.now() - start) / 1000;
      operationDuration.record(durationS, {
        ...setup.metricAttrs(),
        ...(errorType ? { "error.type": errorType } : {}),
      });
      span.end();
    }
  });
}

/** Use the framework's span and usage lifecycle, with the workspace's parent context. */
export function aiTelemetry(operation: string, parentContext?: AgentContext) {
  return otelMiddleware({
    tracer: {
      startSpan: (name, options, parent) => tracer.startSpan(name, options, parent ?? parentContext),
      startActiveSpan: tracer.startActiveSpan.bind(tracer),
    },
    meter,
    captureContent: false,
    attributeEnricher: () => ({ "wingman.operation.name": operation }),
  });
}

export async function traceInvokeAgent<T>(
  agentName: string | undefined,
  fn: (ctx: AgentContext) => Promise<T>,
  parentContext?: AgentContext,
): Promise<T> {
  const attrs: Attributes = {
    "gen_ai.operation.name": "invoke_agent",
    "gen_ai.provider.name": PROVIDER_NAME,
    ...(agentName ? { "gen_ai.agent.name": agentName } : {}),
  };

  return traceSpan(
    {
      name: agentName ? `invoke_agent ${agentName}` : "invoke_agent",
      kind: SpanKind.INTERNAL,
      attrs,
      metricAttrs: () => attrs,
      parentContext,
    },
    (_span, ctx) => fn(ctx),
  );
}

export interface ExecuteToolOptions {
  toolCallId?: string;
  toolDescription?: string;
  toolType?: string;
  parentContext?: AgentContext;
}

export async function traceExecuteTool<T>(
  toolName: string,
  opts: ExecuteToolOptions,
  fn: (ctx: AgentContext) => Promise<T>,
): Promise<T> {
  // Keep metrics bounded: tool.call.id and description stay span-only.
  const metricAttrs: Attributes = {
    "gen_ai.operation.name": "execute_tool",
    "gen_ai.provider.name": PROVIDER_NAME,
    "gen_ai.tool.name": toolName,
  };
  const attrs: Attributes = {
    ...metricAttrs,
    "gen_ai.tool.type": opts.toolType ?? "function",
    ...(opts.toolCallId ? { "gen_ai.tool.call.id": opts.toolCallId } : {}),
    ...(opts.toolDescription ? { "gen_ai.tool.description": opts.toolDescription } : {}),
  };

  return traceSpan(
    {
      name: `execute_tool ${toolName}`,
      kind: SpanKind.INTERNAL,
      attrs,
      metricAttrs: () => metricAttrs,
      parentContext: opts.parentContext,
    },
    (_span, ctx) => fn(ctx),
  );
}
