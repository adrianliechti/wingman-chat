import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Client } from "./client";
import { runMessages } from "./agent";
import { assistant, calls, finished, output, response, textItem, testClient, user } from "./test-support/ai";
import { trace, type Span } from "@opentelemetry/api";
import { chat } from "@tanstack/ai";
import { aiTelemetry } from "./otel";

const telemetry = vi.hoisted(() => ({
  spans: [] as {
    name: string;
    attributes: Record<string, unknown>;
    parent?: unknown;
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
        startSpan: (
          name: string,
          options: { attributes?: Record<string, unknown> } = {},
          parent?: Parameters<typeof api.trace.getSpan>[0],
        ) => {
          const attributes = { ...options.attributes };
          const spanId = (telemetry.spans.length + 1).toString(16).padStart(16, "0");
          const span = {
            name,
            attributes,
            parent: parent && api.trace.getSpan(parent),
            end: vi.fn(),
            setStatus: vi.fn(),
            recordException: vi.fn(),
            addEvent: vi.fn(),
            isRecording: () => true,
            spanContext: () => ({ traceId: "1".repeat(32), spanId, traceFlags: 1 }),
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
    if (operation === "chat") await runMessages(client, "model", "Private instructions", [user("Private input")], []);
    else
      await chat({
        adapter: client.textAdapter("model"),
        messages: [{ role: "user", content: "Private input" }],
        stream: false,
        middleware: [aiTelemetry(operation)],
      });
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
  await expect(runMessages(new Client(), "model", "", [], [])).rejects.toThrow();
  expect(telemetry.spans.length).toBeGreaterThan(0);
  for (const span of telemetry.spans) expect(span.end).toHaveBeenCalledOnce();
  expect(telemetry.spans.some((span) => span.setStatus.mock.calls.some(([status]) => status.code === 2))).toBe(true);
});

it("uses one native tool span and parents delegated calls to it without an async context manager", async () => {
  const answer = assistant("Private answer");
  const complete = vi
    .fn<Parameters<typeof testClient>[0]>()
    .mockResolvedValueOnce(calls(["delegate-1", "delegate"]))
    .mockResolvedValue(answer);
  let toolSpan: Span | undefined;
  await runMessages(
    testClient(complete),
    "model",
    "",
    [],
    [
      {
        name: "delegate",
        parameters: { type: "object", properties: {} },
        function: async (_args, context) => {
          toolSpan = context?.agentContext && trace.getSpan(context.agentContext);
          await Promise.resolve();
          await runMessages(testClient(complete), "child", "", [], [], {
            agentName: "child",
            parentContext: context?.agentContext,
            context: context?.invocationContext,
          });
          return output("Private tool result");
        },
      },
    ],
  );
  const toolSpans = telemetry.spans.filter((span) => span.attributes["gen_ai.tool.call.id"] === "delegate-1");
  expect(toolSpans).toHaveLength(1);
  expect(toolSpan).toBe(toolSpans[0]);
  expect(telemetry.spans.find((span) => span.attributes["wingman.operation.name"] === "child")?.parent).toBe(toolSpan);
  expect(telemetry.spans.some((span) => span.name.startsWith("invoke_agent"))).toBe(false);
  for (const span of telemetry.spans) expect(span.end).toHaveBeenCalledOnce();
  expect(JSON.stringify(telemetry.spans.map((span) => span.attributes))).not.toContain("Private");
});

it("closes failed tool spans through the native error lifecycle", async () => {
  const complete = vi
    .fn<Parameters<typeof testClient>[0]>()
    .mockResolvedValueOnce(calls(["failed-1", "fail"]))
    .mockResolvedValue(assistant("The tool failed."));
  await runMessages(
    testClient(complete),
    "model",
    "",
    [],
    [
      {
        name: "fail",
        parameters: { type: "object", properties: {} },
        function: async () => {
          throw new Error("Tool failed");
        },
      },
    ],
  );
  const spans = telemetry.spans.filter((span) => span.attributes["gen_ai.tool.call.id"] === "failed-1");
  expect(spans).toHaveLength(1);
  expect(spans[0].attributes["tanstack.ai.tool.outcome"]).toBe("error");
  expect(spans[0].setStatus).toHaveBeenCalledWith(expect.objectContaining({ code: 2 }));
  for (const span of telemetry.spans) expect(span.end).toHaveBeenCalledOnce();
});
