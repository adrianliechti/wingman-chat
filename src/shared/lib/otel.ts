import { context, metrics, propagation, trace } from "@opentelemetry/api";
import { otelMiddleware } from "@tanstack/ai/middlewares/otel";
import type { AgentContext } from "../types/telemetry";

/** Propagate the request's trace context across asynchronous work. */
export function telemetryHeaders(parent: AgentContext, headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  propagation.inject(parent, result, { set: (carrier, key, value) => carrier.set(key, String(value)) });
  return result;
}

/** Browser spans describe chat activity; gateway provider spans own accounting. */
export function aiTelemetry(operation: string, parentContext?: AgentContext) {
  const tracer = trace.getTracer("wingman");
  const base = parentContext ?? context.active();
  const tools = new Map<string, AgentContext>();
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
    attributeEnricher: () => ({ "wingman.operation.name": operation }),
    onSpanEnd: (info) => {
      if (info.kind === "tool") tools.delete(info.toolCallId);
    },
  });
  return Object.assign(middleware, {
    requestContext: () => requestContext,
    toolContext: (callId: string) => tools.get(callId) ?? base,
  });
}
