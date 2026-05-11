import { trace } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { env } from './env.js'

const exporter = new OTLPTraceExporter({
  url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
})

export const telemetryConfig = {
  serviceName: env.OTEL_SERVICE_NAME,
  spanProcessors: [new BatchSpanProcessor(exporter)],
}

export const tracer = trace.getTracer(env.OTEL_SERVICE_NAME, env.OTEL_SERVICE_VERSION)
