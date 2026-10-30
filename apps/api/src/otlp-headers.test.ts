import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { SimpleLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs'
import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'

// On the native runtime the OTLP endpoint is the authenticated public tier. The exporters
// built in telemetry.ts pass only `url`, so the ingestion key must come from the standard
// OTEL_EXPORTER_OTLP_HEADERS env var that the installed exporters read themselves.
// These tests pin that behaviour against a local receiver.

const KEY = 'ingest-key-for-test'
const received: Array<{ path: string; authorization: string | null }> = []
let upstream: ReturnType<typeof Bun.serve>
let previousHeaders: string | undefined

beforeAll(() => {
  previousHeaders = process.env['OTEL_EXPORTER_OTLP_HEADERS']
  upstream = Bun.serve({
    port: 0,
    fetch(request) {
      received.push({
        path: new URL(request.url).pathname,
        authorization: request.headers.get('authorization'),
      })
      return new Response(null, { status: 200 })
    },
  })
})

afterAll(() => {
  upstream.stop(true)
  if (previousHeaders === undefined) delete process.env['OTEL_EXPORTER_OTLP_HEADERS']
  else process.env['OTEL_EXPORTER_OTLP_HEADERS'] = previousHeaders
})

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition() && Date.now() < deadline) await Bun.sleep(10)
}

describe('OTLP exporters and OTEL_EXPORTER_OTLP_HEADERS', () => {
  it('sends the authorization header from the env var on traces and logs', async () => {
    process.env['OTEL_EXPORTER_OTLP_HEADERS'] = `authorization=${KEY}`
    received.length = 0
    const base = `http://127.0.0.1:${upstream.port}`

    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [
        new SimpleSpanProcessor(new OTLPTraceExporter({ url: `${base}/v1/traces` })),
      ],
    })
    tracerProvider.getTracer('test').startSpan('probe').end()
    await tracerProvider.forceFlush()

    const loggerProvider = new LoggerProvider({
      processors: [
        new SimpleLogRecordProcessor({ exporter: new OTLPLogExporter({ url: `${base}/v1/logs` }) }),
      ],
    })
    loggerProvider.getLogger('test').emit({ body: 'probe' })
    await loggerProvider.forceFlush()
    await waitFor(() => received.length >= 2)

    expect(received.map((r) => r.path).toSorted()).toEqual(['/v1/logs', '/v1/traces'])
    expect(received.every((r) => r.authorization === KEY)).toBe(true)
  })

  it('sends no authorization header when the env var is unset', async () => {
    delete process.env['OTEL_EXPORTER_OTLP_HEADERS']
    received.length = 0

    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [
        new SimpleSpanProcessor(
          new OTLPTraceExporter({ url: `http://127.0.0.1:${upstream.port}/v1/traces` }),
        ),
      ],
    })
    tracerProvider.getTracer('test').startSpan('probe').end()
    await tracerProvider.forceFlush()

    expect(received).toHaveLength(1)
    expect(received[0]?.authorization).toBeNull()
  })
})
