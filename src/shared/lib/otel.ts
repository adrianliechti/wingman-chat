import { context, metrics, trace } from "@opentelemetry/api";
import { otelMiddleware } from "@tanstack/ai/middlewares/otel";
import type { AgentContext } from "../types/telemetry";

const tracer = trace.getTracer("wingman");
const meter = metrics.getMeter("wingman");

/** Native spans own their lifecycle; explicit contexts also work without a browser async context manager. */
export function aiTelemetry(operation: string, parentContext?: AgentContext) {
  const tools = new Map<string, AgentContext>();
  const middleware = otelMiddleware({
    tracer: {
      startSpan: (name, options, parent) => {
        const parentCtx = parent ?? parentContext ?? context.active();
        const span = tracer.startSpan(name, options, parentCtx);
        const callId = options?.attributes?.["gen_ai.tool.call.id"];
        if (typeof callId === "string") tools.set(callId, trace.setSpan(parentCtx, span));
        return span;
      },
      startActiveSpan: tracer.startActiveSpan.bind(tracer),
    },
    meter,
    captureContent: false,
    attributeEnricher: () => ({ "wingman.operation.name": operation }),
    onSpanEnd: (info) => {
      if (info.kind === "tool") tools.delete(info.toolCallId);
    },
  });
  return Object.assign(middleware, {
    toolContext: (callId: string) => tools.get(callId) ?? parentContext,
  });
}
