// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { context, logs, metrics, propagation, trace } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { AggregationTemporality, DataPointType, type HistogramMetricData } from "@opentelemetry/sdk-metrics";
import { recordClassification } from "@/features/chat/lib/classificationTelemetry";
import { Client } from "@/shared/lib/client";
import { runMessages } from "@/shared/lib/agent";
import { callItem, finished, output, response, textItem } from "@/shared/lib/test-support/ai";
import { z } from "zod";
import { initTelemetry } from "./telemetry";

vi.mock("@opentelemetry/instrumentation", () => ({ registerInstrumentations: vi.fn() }));
let providers: ReturnType<typeof initTelemetry> | undefined;
afterEach(async () => {
  await providers?.shutdown();
  metrics.disable();
  trace.disable();
  logs.disable();
  context.disable();
  propagation.disable();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("exports classifications immediately and leaves model usage on its own interval", async () => {
  const exported: HistogramMetricData[][] = [];
  vi.spyOn(OTLPTraceExporter.prototype, "export").mockImplementation((_spans, callback) => callback({ code: 0 }));
  vi.spyOn(OTLPMetricExporter.prototype, "export").mockImplementation((resourceMetrics, callback) => {
    exported.push(
      resourceMetrics.scopeMetrics.flatMap((scope) =>
        scope.metrics.filter(
          (metric): metric is HistogramMetricData => metric.dataPointType === DataPointType.HISTOGRAM,
        ),
      ),
    );
    callback({ code: 0 });
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () =>
      Response.json({
        answers: { category: { type: "choice", choice: "legal", confidence: 0.9, probabilities: { legal: 0.9 } } },
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    ),
  );
  providers = initTelemetry("wingman-chat");
  const client = new Client();
  const rules = {
    categories: [{ id: "legal", name: "Legal", description: "Private criterion" }],
    risks: [],
    threshold: 0.6,
  };
  const reporting = { conversationId: "chat-1", model: "classifier" };
  for (let interval = 0; interval < 2; interval++) {
    const result = await client.classifyChat(
      "classifier",
      [{ id: "prompt", role: "user", parts: [{ type: "text", content: "Private prompt" }] }],
      [{ id: "legal", description: "Private criterion" }],
    );
    recordClassification(result, rules, reporting);
    await vi.waitFor(() => expect(exported).toHaveLength(interval + 1));
  }

  expect(exported).toHaveLength(2);
  for (const batch of exported) {
    expect(batch.map((metric) => metric.descriptor.name).sort()).toEqual(["wingman.classification.score"]);
    for (const metric of batch) {
      expect(metric.aggregationTemporality).toBe(AggregationTemporality.DELTA);
      expect(metric.dataPoints).toHaveLength(1);
      expect(metric.dataPoints[0].value.count).toBe(1);
    }
    const classification = batch.find((metric) => metric.descriptor.name === "wingman.classification.score")!;
    expect(classification.dataPoints[0].value.sum).toBe(0.9);
    expect(classification.dataPoints[0].attributes).toMatchObject({
      "gen_ai.conversation.id": "chat-1",
      "wingman.classification.event_id": expect.any(String),
      "wingman.classification.id": "legal",
      "wingman.classification.matched": true,
    });
  }
  const ids = exported.map((batch) => batch[0].dataPoints[0].attributes["wingman.classification.event_id"]);
  expect(new Set(ids).size).toBe(2);
  await providers.meterProvider.forceFlush();
  expect(exported).toHaveLength(3);
  expect(exported[2].map((metric) => metric.descriptor.name)).toEqual(["wingman.chat.client.operation.duration"]);
  expect(exported[2][0].dataPoints[0].value.count).toBe(2);
});

it("reports the given service name", async () => {
  const names: unknown[] = [];
  vi.spyOn(OTLPMetricExporter.prototype, "export").mockImplementation((resourceMetrics, callback) => {
    names.push(resourceMetrics.resource.attributes["service.name"]);
    callback({ code: 0 });
  });

  providers = initTelemetry("acme-assistant");
  metrics.getMeter("test").createCounter("test.counter").add(1);
  await providers.meterProvider.forceFlush();
  expect(names).toEqual(["acme-assistant"]);
});

it("parents SDK requests to each model iteration across an asynchronous tool call", async () => {
  const exported: { attributes: Record<string, unknown>; spanContext: () => { spanId: string } }[] = [];
  vi.spyOn(OTLPTraceExporter.prototype, "export").mockImplementation((spans, callback) => {
    exported.push(...spans);
    callback({ code: 0 });
  });
  vi.spyOn(OTLPMetricExporter.prototype, "export").mockImplementation((_batch, callback) => callback({ code: 0 }));
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(finished(response([callItem("tool-1", "lookup")])))
    .mockResolvedValueOnce(finished(response([textItem("Done")])));
  vi.stubGlobal("fetch", fetchMock);
  providers = initTelemetry("custom-chat-service");
  await runMessages(
    new Client(),
    "model",
    "",
    [],
    [
      {
        name: "lookup",
        description: "Look up information",
        inputSchema: z.object({}),
        execute: async () => {
          await Promise.resolve();
          return output("Tool result");
        },
      },
    ],
  );
  await providers.tracerProvider.forceFlush();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const parents = fetchMock.mock.calls.map(([, init]) => {
    const headers = new Headers(init.headers);
    expect(headers.has("X-Wingman-Conversation-Id")).toBe(false);
    expect(headers.get("Content-Type")).toBe("application/json");
    const spanId = headers.get("traceparent")?.split("-")[2];
    const span = exported.find((span) => span.spanContext().spanId === spanId);
    expect(span?.attributes["gen_ai.operation.name"]).toBe("chat");
    expect(span?.attributes["gen_ai.conversation.id"]).toEqual(expect.any(String));
    return spanId;
  });
  expect(new Set(parents).size).toBe(2);
});
