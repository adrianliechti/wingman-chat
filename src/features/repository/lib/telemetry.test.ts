// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { metrics, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { AggregationTemporality, DataPointType, type HistogramMetricData } from "@opentelemetry/sdk-metrics";
import { recordClassification } from "@/features/chat/lib/classificationTelemetry";
import { Client } from "@/shared/lib/client";
import { initTelemetry } from "./telemetry";

vi.mock("@opentelemetry/instrumentation", () => ({ registerInstrumentations: vi.fn() }));
let providers: ReturnType<typeof initTelemetry> | undefined;
afterEach(async () => {
  await Promise.all([
    providers?.meterProvider.shutdown(),
    providers?.tracerProvider.shutdown(),
    providers?.loggerProvider.shutdown(),
  ]);
  metrics.disable();
  trace.disable();
  logs.disable();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("exports classification and model usage as new observations on each metrics interval", async () => {
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
  providers = initTelemetry();
  const client = new Client();
  const rules = { categories: [{ name: "Legal", description: "Private criterion" }], risks: [], threshold: 0.6 };
  const reporting = { conversationId: "chat-1", model: "classifier" };
  for (let interval = 0; interval < 2; interval++) {
    const result = await client.classifyChat(
      "classifier",
      [{ id: "prompt", role: "user", parts: [{ type: "text", content: "Private prompt" }] }],
      [{ id: "legal", description: "Private criterion" }],
    );
    recordClassification(result, rules, reporting);
    await providers.meterProvider.forceFlush();
  }

  expect(exported).toHaveLength(2);
  for (const batch of exported) {
    expect(batch.map((metric) => metric.descriptor.name).sort()).toEqual([
      "gen_ai.client.operation.duration",
      "wingman.classification.score",
    ]);
    for (const metric of batch) {
      expect(metric.aggregationTemporality).toBe(AggregationTemporality.DELTA);
      expect(metric.dataPoints).toHaveLength(1);
      expect(metric.dataPoints[0].value.count).toBe(1);
    }
    const classification = batch.find((metric) => metric.descriptor.name === "wingman.classification.score")!;
    expect(classification.dataPoints[0].value.sum).toBe(0.9);
    expect(classification.dataPoints[0].attributes).toMatchObject({
      "gen_ai.conversation.id": "chat-1",
      "wingman.classification.id": "legal",
      "wingman.classification.matched": true,
    });
  }
});
