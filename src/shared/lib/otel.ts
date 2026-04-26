import { metrics, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";

const tracer = trace.getTracer("wingman");
const meter = metrics.getMeter("wingman");

// --- GenAI / OpenAI semantic conventions ---
// https://opentelemetry.io/docs/specs/semconv/gen-ai/openai/

const genaiDuration = meter.createHistogram("gen_ai.client.operation.duration", {
  description: "GenAI operation duration",
  unit: "s",
});

const genaiTokens = meter.createHistogram("gen_ai.client.token.usage", {
  description: "GenAI token usage",
  unit: "{token}",
});

export interface GenAIRequestOptions {
  effort?: string;
  verbosity?: string;
  toolCount?: number;
}

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
 * Wraps an async GenAI operation in a span following the OpenAI semantic conventions.
 * Span name: `{operation} {model}` (e.g. "chat gpt-4o")
 *
 * Callers never touch the span directly — pass request options up front and
 * return response info from the callback.
 */
export async function traceGenAI<T>(
  operation: string,
  model: string,
  fn: () => Promise<{ result: T; response?: GenAIResponseInfo }>,
  requestOptions?: GenAIRequestOptions,
): Promise<T> {
  return tracer.startActiveSpan(`${operation} ${model}`, { kind: SpanKind.CLIENT }, async (span) => {
    span.setAttribute("gen_ai.operation.name", operation);
    span.setAttribute("gen_ai.system", "wingman");
    span.setAttribute("gen_ai.request.model", model);

    if (requestOptions?.effort) span.setAttribute("gen_ai.request.reasoning_effort", requestOptions.effort);
    if (requestOptions?.verbosity) span.setAttribute("gen_ai.request.verbosity", requestOptions.verbosity);
    if (requestOptions?.toolCount) span.setAttribute("gen_ai.request.tool_count", requestOptions.toolCount);

    const start = performance.now();
    let responseModelForDuration = model;
    try {
      const { result, response } = await fn();

      if (response) {
        const responseModel = response.model || model;

        if (response.id) span.setAttribute("gen_ai.response.id", response.id);
        if (response.model) span.setAttribute("gen_ai.response.model", response.model);
        if (response.finishReasons) span.setAttribute("gen_ai.response.finish_reasons", response.finishReasons);

        // Metric dimensions match the Go server: operation, request_model, response_model
        const metricAttrs = {
          "gen_ai.operation.name": operation,
          "gen_ai.request.model": model,
          "gen_ai.response.model": responseModel,
        };

        if (response.inputTokens != null) {
          span.setAttribute("gen_ai.usage.input_tokens", response.inputTokens);
          genaiTokens.record(response.inputTokens, { ...metricAttrs, "gen_ai.token.type": "input" });
        }
        if (response.cachedInputTokens != null) {
          span.setAttribute("gen_ai.usage.cached_input_tokens", response.cachedInputTokens);
          genaiTokens.record(response.cachedInputTokens, { ...metricAttrs, "gen_ai.token.type": "cached" });
        }
        if (response.outputTokens != null) {
          span.setAttribute("gen_ai.usage.output_tokens", response.outputTokens);
          genaiTokens.record(response.outputTokens, { ...metricAttrs, "gen_ai.token.type": "output" });
        }
        if (response.reasoningTokens != null) {
          span.setAttribute("gen_ai.usage.reasoning_tokens", response.reasoningTokens);
          genaiTokens.record(response.reasoningTokens, { ...metricAttrs, "gen_ai.token.type": "reasoning" });
        }

        responseModelForDuration = responseModel;
      }

      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      span.setAttribute("error.type", error instanceof Error ? error.constructor.name : "Error");
      throw error;
    } finally {
      const durationS = (performance.now() - start) / 1000;
      genaiDuration.record(durationS, {
        "gen_ai.operation.name": operation,
        "gen_ai.request.model": model,
        "gen_ai.response.model": responseModelForDuration,
      });
      span.end();
    }
  });
}

// --- MCP semantic conventions ---
// https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/

const mcpDuration = meter.createHistogram("mcp.client.operation.duration", {
  description: "MCP client operation duration",
  unit: "s",
});

export interface MCPOptions {
  toolName?: string;
  serverAddress?: string;
  sessionId?: string;
}

/**
 * Wraps an async MCP operation in a span following the MCP semantic conventions.
 * Span name: `{method} {target}` (e.g. "tools/call myTool")
 */
export async function traceMCP<T>(method: string, target: string, opts: MCPOptions, fn: () => Promise<T>): Promise<T> {
  const spanName = target ? `${method} ${target}` : method;

  return tracer.startActiveSpan(spanName, { kind: SpanKind.CLIENT }, async (span) => {
    span.setAttribute("mcp.method.name", method);
    if (opts.toolName) {
      span.setAttribute("gen_ai.tool.name", opts.toolName);
      span.setAttribute("gen_ai.operation.name", "execute_tool");
    }
    if (opts.serverAddress) span.setAttribute("server.address", opts.serverAddress);
    if (opts.sessionId) span.setAttribute("mcp.session.id", opts.sessionId);

    const start = performance.now();
    try {
      return await fn();
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      span.setAttribute("error.type", error instanceof Error ? error.constructor.name : "Error");
      throw error;
    } finally {
      const durationS = (performance.now() - start) / 1000;
      mcpDuration.record(durationS, { "mcp.method.name": method });
      span.end();
    }
  });
}
