import { metrics } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { AggregationTemporalityPreference, OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { defaultResource, resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor, StackContextManager, WebTracerProvider } from "@opentelemetry/sdk-trace-web";

import { installClassificationMetrics } from "@/shared/lib/classificationMetrics";

// Provider requests carry explicit model/tool context. Automatic fetch tracing
// would overwrite their traceparent with an unrelated browser HTTP span.
const IGNORE_URLS = [/\/telemetry\//, /\/api\/v1(?:\/|$)/];

export function initTelemetry(serviceName: string) {
  const resource = defaultResource().merge(
    resourceFromAttributes({
      "service.name": serviceName,
      "user_agent.original": navigator.userAgent,
    }),
  );

  const traceExporter = new OTLPTraceExporter({ url: "/telemetry/v1/traces" });
  const tracerProvider = new WebTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(traceExporter)],
  });
  // StackContextManager only tracks context synchronously — every parent
  // relationship is established by passing `AgentContext` explicitly via
  // `parentContext` (see `otel.ts` and `agent.ts`). This is the pattern OTel
  // maintainers recommend for browser apps until the TC39 AsyncContext
  // proposal lands:
  // https://github.com/open-telemetry/opentelemetry-js/discussions/2060
  tracerProvider.register({
    contextManager: new StackContextManager(),
  });

  // Insights sums incoming counts/sums, so each export must contain only new observations.
  const metricExporter = new OTLPMetricExporter({
    url: "/telemetry/v1/metrics",
    temporalityPreference: AggregationTemporalityPreference.DELTA,
  });
  const meterProvider = new MeterProvider({
    resource,
    // Preserve client-loop measurements separately from gateway provider calls.
    views: ["gen_ai.client.operation.duration", "gen_ai.client.token.usage"].map((instrumentName) => ({
      instrumentName,
      name: instrumentName.replace("gen_ai.", "wingman.chat."),
    })),
    readers: [
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 60_000,
      }),
    ],
  });

  const classificationMeterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: "/telemetry/v1/metrics",
          temporalityPreference: AggregationTemporalityPreference.DELTA,
        }),
        exportIntervalMillis: 60_000,
      }),
    ],
  });
  const disposeClassifications = installClassificationMetrics(classificationMeterProvider);

  const logExporter = new OTLPLogExporter({ url: "/telemetry/v1/logs" });
  const loggerProvider = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor({ exporter: logExporter })],
  });

  registerInstrumentations({
    instrumentations: [
      new FetchInstrumentation({
        ignoreUrls: IGNORE_URLS,
      }),
    ],
  });

  metrics.setGlobalMeterProvider(meterProvider);
  logs.setGlobalLoggerProvider(loggerProvider);

  return {
    tracerProvider,
    meterProvider,
    loggerProvider,
    classificationMeterProvider,
    shutdown: async () => {
      disposeClassifications();
      await Promise.all([
        classificationMeterProvider.shutdown(),
        meterProvider.shutdown(),
        tracerProvider.shutdown(),
        loggerProvider.shutdown(),
      ]);
    },
  };
}
