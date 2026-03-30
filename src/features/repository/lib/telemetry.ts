import { metrics } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { defaultResource, resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor, WebTracerProvider } from "@opentelemetry/sdk-trace-web";

const IGNORE_URLS = [/\/otel\//];

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
    spanProcessors: [new BatchSpanProcessor(traceExporter)],
  });
  tracerProvider.register({
    contextManager: new ZoneContextManager(),
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
