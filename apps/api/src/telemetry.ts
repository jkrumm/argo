import { trace, type Attributes } from '@opentelemetry/api'
import { logs, SeverityNumber } from '@opentelemetry/api-logs'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs'
import pkg from '../package.json' with { type: 'json' }
import { env } from './env.js'

const base = env.OTEL_EXPORTER_OTLP_ENDPOINT

export const resource = resourceFromAttributes({
  'service.name': env.OTEL_SERVICE_NAME,
  'service.version': env.OTEL_SERVICE_VERSION || pkg.version,
  'deployment.environment': env.NODE_ENV,
})

// Traces — passed to the @elysiajs/opentelemetry plugin (NodeSDK under the hood).
export const telemetryConfig = {
  serviceName: env.OTEL_SERVICE_NAME,
  resource,
  spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: `${base}/v1/traces` }))],
}

// Logs — separate LoggerProvider registered globally so `logs.getLogger()` works.
// Not piped through the elysia plugin's NodeSDK because the sdk-logs version
// shipped transitively by NodeSDK drifts from ours and TS rejects the union.
const loggerProvider = new LoggerProvider({
  resource,
  processors: [new BatchLogRecordProcessor(new OTLPLogExporter({ url: `${base}/v1/logs` }))],
})
logs.setGlobalLoggerProvider(loggerProvider)

export const tracer = trace.getTracer(env.OTEL_SERVICE_NAME, pkg.version)

const logger = logs.getLogger(env.OTEL_SERVICE_NAME, pkg.version)

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const severityMap: Record<LogLevel, { number: SeverityNumber; text: string }> = {
  debug: { number: SeverityNumber.DEBUG, text: 'DEBUG' },
  info: { number: SeverityNumber.INFO, text: 'INFO' },
  warn: { number: SeverityNumber.WARN, text: 'WARN' },
  error: { number: SeverityNumber.ERROR, text: 'ERROR' },
}

function emit(level: LogLevel, body: string, attributes?: Attributes): void {
  const { number, text } = severityMap[level]
  logger.emit(
    attributes
      ? { severityNumber: number, severityText: text, body, attributes }
      : { severityNumber: number, severityText: text, body },
  )
}

/**
 * Structured logger that emits OTel log records (correlated with the active
 * trace via SDK context) AND writes to console for terminal visibility.
 * Prefer this over bare `console.*` in new code so logs show up in HyperDX.
 */
export const log = {
  debug(message: string, attributes?: Attributes): void {
    // eslint-disable-next-line no-console
    console.debug(message, attributes ?? '')
    emit('debug', message, attributes)
  },
  info(message: string, attributes?: Attributes): void {
    // eslint-disable-next-line no-console
    console.info(message, attributes ?? '')
    emit('info', message, attributes)
  },
  warn(message: string, attributes?: Attributes): void {
    // eslint-disable-next-line no-console
    console.warn(message, attributes ?? '')
    emit('warn', message, attributes)
  },
  error(message: string, err?: unknown, attributes?: Attributes): void {
    const errAttrs: Attributes =
      err instanceof Error
        ? {
            'exception.type': err.name,
            'exception.message': err.message,
            'exception.stacktrace': err.stack ?? '',
          }
        : err !== undefined
          ? { 'exception.message': String(err) }
          : {}
    // eslint-disable-next-line no-console
    console.error(message, err ?? '', attributes ?? '')
    emit('error', message, { ...errAttrs, ...attributes })
  },
}
