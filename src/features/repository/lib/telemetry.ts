import {
    BatchSpanProcessor,
    WebTracerProvider,
} from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
    MeterProvider,
    PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import {
    BatchLogRecordProcessor,
    LoggerProvider,
} from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { trace } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

const IGNORE_URLS = [/\/api\/v1\/otel\//];

export function initTelemetry() {
    // Traces
    const traceExporter = new OTLPTraceExporter({ url: '/api/v1/otel/traces' });
    const tracerProvider = new WebTracerProvider({
        spanProcessors: [new BatchSpanProcessor(traceExporter)],
    });
    tracerProvider.register({
        contextManager: new ZoneContextManager(),
    });

    // Metrics
    const metricExporter = new OTLPMetricExporter({ url: '/api/v1/otel/metrics' });
    const meterProvider = new MeterProvider({
        readers: [
            new PeriodicExportingMetricReader({
                exporter: metricExporter,
                exportIntervalMillis: 60_000,
            }),
        ],
    });

    // Logs
    const logExporter = new OTLPLogExporter({ url: '/api/v1/otel/logs' });
    const loggerProvider = new LoggerProvider({
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

    // Register the logger provider so the logs API can find it
    logs.setGlobalLoggerProvider(loggerProvider);

    // Send a test log and trace so you can verify in Grafana
    sendTestTelemetry();

    return { tracerProvider, meterProvider, loggerProvider };
}

function sendTestTelemetry() {
    // Test trace
    const tracer = trace.getTracer('wingman-test');
    const span = tracer.startSpan('test-span');
    span.setAttribute('test', true);
    span.setAttribute('message', 'Hello from Wingman telemetry');
    span.end();

    // Test log
    const logger = logs.getLogger('wingman-test');
    logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: 'INFO',
        body: 'Wingman telemetry initialized',
        attributes: { test: true },
    });
}
