import { trace, type Attributes, type Context } from '@opentelemetry/api'
import { logs, SeverityNumber } from '@opentelemetry/api-logs'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  BatchSpanProcessor,
  type ReadableSpan,
  type Span,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs'
import pkg from '../package.json' with { type: 'json' }
import { env } from './env.js'

const base = env.OTEL_EXPORTER_OTLP_ENDPOINT

export const resource = resourceFromAttributes({
  'service.name': env.OTEL_SERVICE_NAME,
  'service.version': env.OTEL_SERVICE_VERSION || pkg.version,
  'deployment.environment': env.NODE_ENV,
})

// D21 — credential-bearing headers must never reach the exporter. Header
// span attributes (`http.request.header.*` / `http.response.header.*`) are
// produced by @elysiajs/opentelemetry, which ships no config to narrow
// header capture (verified against its installed types — the only knob is
// `checkIfShouldTrace`, which decides IF a request is traced, not WHAT gets
// captured). So the defense sits one layer down, at span-processing time,
// where it holds regardless of which instrumentation set the attribute.
const REDACTED_ATTRIBUTE_VALUE = '[redacted]'

// Header names redacted outright, matched case-insensitively. Keep this in
// sync with any new credential-style header the API starts accepting.
export const REDACTED_HEADER_NAMES: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
])

// Anything else whose header name contains "token" or "secret" is also
// redacted (covers ad hoc headers like `x-refresh-token`, `x-webhook-secret`).
const SENSITIVE_HEADER_NAME_PATTERN = /token|secret/i

const HEADER_ATTRIBUTE_PREFIXES = ['http.request.header.', 'http.response.header.']

function isSensitiveHeaderName(headerName: string): boolean {
  const lower = headerName.toLowerCase()
  return REDACTED_HEADER_NAMES.has(lower) || SENSITIVE_HEADER_NAME_PATTERN.test(lower)
}

/**
 * Pure scrubber: given a span (or log record) attributes object, returns an
 * attributes object where every credential-bearing `http.request.header.*`
 * / `http.response.header.*` value is replaced with a fixed redaction
 * marker. The key is kept — losing "this request was authenticated" is a
 * bigger loss to debuggability than the header value is a secret, once the
 * value itself is gone.
 *
 * Case-insensitive on the header-name segment. Non-header attributes
 * (`http.route`, `http.request.method`, `url.*`, `client.address`, …) pass
 * through untouched. Never throws on a non-string attribute value.
 *
 * Returns the same object reference when nothing needed redacting.
 */
export function redactHeaderAttributes(attributes: Attributes): Attributes {
  let redacted: Record<string, Attributes[string]> | undefined

  for (const key of Object.keys(attributes)) {
    const lowerKey = key.toLowerCase()
    const prefix = HEADER_ATTRIBUTE_PREFIXES.find((p) => lowerKey.startsWith(p))
    if (!prefix) continue

    const headerName = lowerKey.slice(prefix.length)
    if (!isSensitiveHeaderName(headerName)) continue

    redacted ??= { ...attributes }
    redacted[key] = REDACTED_ATTRIBUTE_VALUE
  }

  return redacted ?? attributes
}

/**
 * Wraps another SpanProcessor and scrubs credential-bearing header
 * attributes off every span in `onEnd`, before it reaches the wrapped
 * processor (and therefore the exporter). Sits at the span-processing
 * layer so it holds no matter which instrumentation set the attribute —
 * see the D21 comment above `redactHeaderAttributes`.
 */
class ScrubbingSpanProcessor implements SpanProcessor {
  constructor(private readonly next: SpanProcessor) {}

  onStart(span: Span, parentContext: Context): void {
    this.next.onStart(span, parentContext)
  }

  onEnd(span: ReadableSpan): void {
    const redacted = redactHeaderAttributes(span.attributes)
    if (redacted !== span.attributes) {
      for (const [key, value] of Object.entries(redacted)) {
        span.attributes[key] = value
      }
    }
    this.next.onEnd(span)
  }

  forceFlush(): Promise<void> {
    return this.next.forceFlush()
  }

  shutdown(): Promise<void> {
    return this.next.shutdown()
  }
}

// Traces — passed to the @elysiajs/opentelemetry plugin (NodeSDK under the hood).
export const telemetryConfig = {
  serviceName: env.OTEL_SERVICE_NAME,
  resource,
  spanProcessors: [
    new ScrubbingSpanProcessor(
      new BatchSpanProcessor(new OTLPTraceExporter({ url: `${base}/v1/traces` })),
    ),
  ],
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
