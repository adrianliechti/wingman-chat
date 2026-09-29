import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Client } from "./client";
import { finished, response, textItem } from "./test-support/ai";

const telemetry = vi.hoisted(() => ({
  spans: [] as {
    name: string;
    attributes: Record<string, unknown>;
    end: ReturnType<typeof vi.fn>;
    setStatus: ReturnType<typeof vi.fn>;
  }[],
  histogram: vi.fn(),
}));
vi.mock("@opentelemetry/api", async (importOriginal) => {
  const api = await importOriginal<typeof import("@opentelemetry/api")>();
  return {
    ...api,
    trace: {
      getSpan: (ctx: Parameters<typeof api.trace.getSpan>[0]) => api.trace.getSpan(ctx),
      setSpan: (ctx: Parameters<typeof api.trace.setSpan>[0], span: Parameters<typeof api.trace.setSpan>[1]) =>
        api.trace.setSpan(ctx, span),
      getTracer: () => ({
        startActiveSpan: vi.fn(),
        startSpan: (name: string, options: { attributes?: Record<string, unknown> } = {}) => {
          const attributes = { ...options.attributes };
          const span = {
            name,
            attributes,
            end: vi.fn(),
            setStatus: vi.fn(),
            recordException: vi.fn(),
            addEvent: vi.fn(),
            isRecording: () => true,
            spanContext: () => ({ traceId: "1".repeat(32), spanId: "2".repeat(16), traceFlags: 1 }),
            setAttribute: (key: string, value: unknown) => {
              attributes[key] = value;
            },
            setAttributes: (values: Record<string, unknown>) => Object.assign(attributes, values),
          };
          telemetry.spans.push(span);
          return span;
        },
      }),
    },
    metrics: {
      getMeter: () => ({
        createHistogram: (name: string) => ({ record: (...args: unknown[]) => telemetry.histogram(name, ...args) }),
      }),
    },
  };
});

beforeEach(() => {
  telemetry.spans.length = 0;
  vi.clearAllMocks();
  vi.stubGlobal("window", { location: new URL("http://localhost") });
});
afterEach(() => vi.unstubAllGlobals());

it.each(["chat", "summarize_history"])(
  "records native %s usage without capturing conversation content",
  async (operation) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          finished(response([textItem(operation === "chat" ? "Private answer" : '{"summary":"Private summary"}')])),
        ),
    );
    const client = new Client();
    if (operation === "chat")
      await client.complete(
        "model",
        "Private instructions",
        [{ role: "user", content: [{ type: "text", text: "Private input" }] }],
        [],
      );
    else await client.summarizeHistory("model", [{ role: "user", content: [{ type: "text", text: "Private input" }] }]);
    expect(telemetry.spans.length).toBeGreaterThan(0);
    for (const span of telemetry.spans) expect(span.end).toHaveBeenCalledOnce();
    expect(
      telemetry.spans.some(
        (span) =>
          span.attributes["gen_ai.usage.input_tokens"] === 10 && span.attributes["gen_ai.usage.output_tokens"] === 5,
      ),
    ).toBe(true);
    expect(telemetry.spans.some((span) => span.attributes["wingman.operation.name"] === operation)).toBe(true);
    expect(JSON.stringify(telemetry.spans.map((span) => span.attributes))).not.toContain("Private");
    expect(telemetry.histogram).toHaveBeenCalledWith(
      "gen_ai.client.token.usage",
      5,
      expect.objectContaining({ "gen_ai.token.type": "output" }),
    );
  },
);

it("closes native spans when generation fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        finished(response([], { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })),
      ),
  );
  await expect(new Client().complete("model", "", [], [])).rejects.toThrow();
  expect(telemetry.spans.length).toBeGreaterThan(0);
  for (const span of telemetry.spans) expect(span.end).toHaveBeenCalledOnce();
  expect(telemetry.spans.some((span) => span.setStatus.mock.calls.some(([status]) => status.code === 2))).toBe(true);
});
