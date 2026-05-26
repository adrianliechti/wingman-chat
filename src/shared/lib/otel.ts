import { type Attributes, context, type Context, metrics, type Span, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";

const tracer = trace.getTracer("wingman");
const meter = metrics.getMeter("wingman");

const PROVIDER_NAME = "wingman";

// https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/
const operationDuration = meter.createHistogram("gen_ai.client.operation.duration", {
  description: "GenAI operation duration",
  unit: "s",
});

const tokenUsage = meter.createHistogram("gen_ai.client.token.usage", {
  description: "GenAI token usage",
  unit: "{token}",
});

/**
 * Common lifecycle for GenAI spans: start, run body, record ERROR status +
 * `error.type` on failure, emit duration metric (with conditional `error.type`),
 * end the span. `metricAttrs` is a thunk so callers can fill in late-binding
 * attrs (e.g. response.model) discovered inside the body.
 */
async function traceSpan<T>(
  setup: { name: string; kind: SpanKind; attrs: Attributes; metricAttrs: () => Attributes },
  body: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(setup.name, { kind: setup.kind, attributes: setup.attrs }, async (span) => {
    const start = performance.now();
    let errorType: string | undefined;
    try {
      return await body(span);
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

// --- Chat / inference spans ---
// https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/

export interface GenAIResponseInfo {
  id?: string;
  model?: string;
  finishReasons?: string[];
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
}

/**
 * Wraps a chat-style GenAI call in a span. Span name uses `operation` as a
 * descriptive label (e.g. "classify_chat gpt-4o") while `gen_ai.operation.name`
 * stays fixed to "chat" — every caller today is a chat completion, including
 * structured-output variants.
 */
export async function traceGenAI<T>(
  operation: string,
  model: string,
  fn: () => Promise<{ result: T; response?: GenAIResponseInfo }>,
): Promise<T> {
  const base: Attributes = {
    "gen_ai.operation.name": "chat",
    "gen_ai.provider.name": PROVIDER_NAME,
    "gen_ai.request.model": model,
  };
  let responseModel: string | undefined;

  return traceSpan(
    {
      name: `${operation} ${model}`,
      kind: SpanKind.CLIENT,
      attrs: base,
      metricAttrs: () => (responseModel ? { ...base, "gen_ai.response.model": responseModel } : base),
    },
    async (span) => {
      const { result, response } = await fn();
      if (!response) return result;

      responseModel = response.model;
      if (response.id) span.setAttribute("gen_ai.response.id", response.id);
      if (response.model) span.setAttribute("gen_ai.response.model", response.model);
      if (response.finishReasons) span.setAttribute("gen_ai.response.finish_reasons", response.finishReasons);

      const tokenAttrs: Attributes = responseModel ? { ...base, "gen_ai.response.model": responseModel } : base;

      if (response.inputTokens != null) {
        span.setAttribute("gen_ai.usage.input_tokens", response.inputTokens);
        tokenUsage.record(response.inputTokens, { ...tokenAttrs, "gen_ai.token.type": "input" });
      }
      if (response.outputTokens != null) {
        span.setAttribute("gen_ai.usage.output_tokens", response.outputTokens);
        tokenUsage.record(response.outputTokens, { ...tokenAttrs, "gen_ai.token.type": "output" });
      }
      // Subsets of input/output tokens — span-only, not split out on the metric.
      if (response.cachedInputTokens != null) {
        span.setAttribute("gen_ai.usage.cache_read.input_tokens", response.cachedInputTokens);
      }
      if (response.reasoningTokens != null) {
        span.setAttribute("gen_ai.usage.reasoning.output_tokens", response.reasoningTokens);
      }

      return result;
    },
  );
}

// --- Agent invocation ---
// https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/#invoke-agent-span

/**
 * Wraps an agent run (LLM ↔ tool loop) in an `invoke_agent` span. The callback
 * receives the span's `Context` so child operations can explicitly rebind it
 * via `context.with(ctx, …)` after awaits — necessary because zone-based
 * async context tracking is unreliable across native `await` in modern V8.
 */
export async function traceInvokeAgent<T>(
  agentName: string | undefined,
  fn: (ctx: Context) => Promise<T>,
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
    },
    (span) => fn(trace.setSpan(context.active(), span)),
  );
}

// --- Tool execution ---
// https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/#execute-tool-span

export interface ExecuteToolOptions {
  toolCallId?: string;
  toolDescription?: string;
  toolType?: string;
}

/**
 * Wraps a tool invocation in an `execute_tool` span. Use this around every
 * tool dispatch (MCP, local, anything else) so the trace tree shows the
 * agent → tool relationship uniformly. The callback receives the span's
 * `Context` so any nested agent runs inside the tool can rebind it across
 * awaits.
 */
export async function traceExecuteTool<T>(
  toolName: string,
  opts: ExecuteToolOptions,
  fn: (ctx: Context) => Promise<T>,
): Promise<T> {
  const attrs: Attributes = {
    "gen_ai.operation.name": "execute_tool",
    "gen_ai.provider.name": PROVIDER_NAME,
    "gen_ai.tool.name": toolName,
    "gen_ai.tool.type": opts.toolType ?? "function",
    ...(opts.toolCallId ? { "gen_ai.tool.call.id": opts.toolCallId } : {}),
    ...(opts.toolDescription ? { "gen_ai.tool.description": opts.toolDescription } : {}),
  };
  // Drop high-cardinality fields (call.id, description) from the metric.
  const metricAttrs: Attributes = {
    "gen_ai.operation.name": "execute_tool",
    "gen_ai.provider.name": PROVIDER_NAME,
    "gen_ai.tool.name": toolName,
  };

  return traceSpan(
    { name: `execute_tool ${toolName}`, kind: SpanKind.INTERNAL, attrs, metricAttrs: () => metricAttrs },
    (span) => fn(trace.setSpan(context.active(), span)),
  );
}
