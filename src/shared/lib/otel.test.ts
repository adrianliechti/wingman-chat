import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LengthFinishReasonError } from "openai/error";
import { z } from "zod/v3";
import { Client } from "./client";

const telemetry = vi.hoisted(() => ({
  startSpan: vi.fn(),
  histogram: vi.fn(),
  counter: vi.fn(),
  span: { setAttribute: vi.fn(), setStatus: vi.fn(), end: vi.fn() },
}));

vi.mock("@opentelemetry/api", async (importOriginal) => {
  const api = await importOriginal<typeof import("@opentelemetry/api")>();
  return {
    ...api,
    trace: {
      getSpan: (...args: Parameters<typeof api.trace.getSpan>) => api.trace.getSpan(...args),
      setSpan: (...args: Parameters<typeof api.trace.setSpan>) => api.trace.setSpan(...args),
      getTracer: () => ({
        startActiveSpan: (
          name: string,
          options: object,
          _context: unknown,
          body: (span: typeof telemetry.span) => unknown,
        ) => {
          telemetry.startSpan(name, options);
          return body(telemetry.span);
        },
      }),
    },
    metrics: {
      getMeter: () => ({
        createHistogram: (name: string) => ({ record: (...args: unknown[]) => telemetry.histogram(name, ...args) }),
        createCounter: (name: string) => ({ add: (...args: unknown[]) => telemetry.counter(name, ...args) }),
      }),
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", { location: new URL("http://localhost") });
});
afterEach(() => vi.unstubAllGlobals());

it.each([
  ["chat", "completed", 64_000],
  ["chat", "incomplete", 64_000],
  ["summarize_history", "completed", 16_000],
  ["summarize_history", "incomplete", 16_000],
])("records %s budget and usage when the response is %s", async (operation, status, budget) => {
  const response = {
    id: "resp_test",
    object: "response",
    created_at: 0,
    model: "gpt-6-astra",
    status,
    error: null,
    incomplete_details: status === "incomplete" ? { reason: "max_output_tokens" } : null,
    output: [],
    usage: {
      input_tokens: 12,
      output_tokens: budget,
      total_tokens: budget + 12,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 300 },
    },
  };
  const httpResponse =
    operation === "chat"
      ? new Response(
          [
            { type: "response.created", response: { ...response, status: "in_progress" } },
            { type: `response.${status}`, response },
          ]
            .map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`)
            .join(""),
          { headers: { "content-type": "text/event-stream" } },
        )
      : Response.json(response);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(httpResponse));
  const client = new Client();
  const result =
    operation === "chat"
      ? client.complete("gpt-6-astra", "", [], [])
      : client.parse("gpt-6-astra", "", "", z.object({ summary: z.string() }), operation);
  if (status === "incomplete") await expect(result).rejects.toBeInstanceOf(LengthFinishReasonError);
  else await result;

  expect(telemetry.startSpan).toHaveBeenCalledWith(
    `${operation} gpt-6-astra`,
    expect.objectContaining({
      attributes: expect.objectContaining({ "gen_ai.request.max_tokens": budget }),
    }),
  );
  expect(telemetry.span.setAttribute).toHaveBeenCalledWith("gen_ai.usage.reasoning.output_tokens", 300);
  expect(telemetry.histogram).toHaveBeenCalledWith(
    "gen_ai.client.token.usage",
    budget,
    expect.objectContaining({
      "gen_ai.token.type": "output",
      "wingman.operation.name": operation,
    }),
  );
  expect(telemetry.counter).toHaveBeenCalledExactlyOnceWith(
    "wingman.gen_ai.responses",
    1,
    expect.objectContaining({
      "gen_ai.request.model": "gpt-6-astra",
      "wingman.operation.name": operation,
      "wingman.response.finish_reason": status === "incomplete" ? "max_output_tokens" : "completed",
    }),
  );
  expect(telemetry.span.end).toHaveBeenCalledOnce();
});
