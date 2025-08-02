import {
    ConsoleSpanExporter,
    SimpleSpanProcessor,
    WebTracerProvider,
} from '@opentelemetry/sdk-trace-web';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { registerInstrumentations } from '@opentelemetry/instrumentation';

export function initTelemetry() {
    const provider = new WebTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())]
    });

    provider.register({
        contextManager: new ZoneContextManager(),
    });

    registerInstrumentations({
        instrumentations: [new FetchInstrumentation()],
    });
}