import { metrics } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { defaultResource, resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import {
  BatchSpanProcessor,
  type Span,
  type SpanProcessor,
  StackContextManager,
  WebTracerProvider,
} from "@opentelemetry/sdk-trace-web";

// The OTLP exporters POST via fetch; without this the fetch instrumentation
// would trace each export, whose span triggers another export — a loop.
const IGNORE_URLS = [/\/telemetry\/v1\//];

// Query strings can carry credentials (signed URLs, SAS tokens), so fetch
// spans keep only origin + path. Runs in onStart: the fetch instrumentation
// sets http.url / url.full at span creation, before onStart fires.
const URL_ATTRIBUTES = ["http.url", "url.full"];

const urlRedactionProcessor: SpanProcessor = {
  onStart(span: Span) {
    for (const key of URL_ATTRIBUTES) {
      const value = span.attributes[key];
      if (typeof value !== "string") continue;
      const query = value.indexOf("?");
      if (query !== -1) span.setAttribute(key, value.slice(0, query));
    }
  },
  onEnd() {},
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};

const resource = defaultResource().merge(
  resourceFromAttributes({
    "service.name": "wingman-chat",
    "user_agent.original": navigator.userAgent,
  }),
);

export function initTelemetry() {
  // Traces
  const traceExporter = new OTLPTraceExporter({ url: "/telemetry/v1/traces" });
  const tracerProvider = new WebTracerProvider({
    resource,
    spanProcessors: [urlRedactionProcessor, new BatchSpanProcessor(traceExporter)],
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

  // Metrics
  const metricExporter = new OTLPMetricExporter({ url: "/telemetry/v1/metrics" });
  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 60_000,
      }),
    ],
  });

  // Logs
  const logExporter = new OTLPLogExporter({ url: "/telemetry/v1/logs" });
  const loggerProvider = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor(logExporter)],
  });

  // Instrumentations
  registerInstrumentations({
    instrumentations: [
      new FetchInstrumentation({
        ignoreUrls: IGNORE_URLS,
      }),
    ],
  });

  // Register providers so the global API can find them
  metrics.setGlobalMeterProvider(meterProvider);
  logs.setGlobalLoggerProvider(loggerProvider);

  return { tracerProvider, meterProvider, loggerProvider };
}
