import { SpanStatusCode, trace } from '@opentelemetry/api'
import type { BasaltEvent } from 'basalt-ui'

// `@hyperdx/browser` registers the global tracer provider inside `HyperDX.init`
// (`@hyperdx/otel-web` `provider.register`), so this tracer exports through it. Without init the
// API hands back a no-op tracer and `telemetry` is inert. `ProxyTracer` resolves the provider
// lazily, so module order against `lib/hyperdx.ts` does not matter.
const tracer = trace.getTracer('basalt-ui')

/** `BasaltProvider telemetry` sink: one span per `BasaltEvent`, ids/hashes/counts/durations only. */
export function telemetry(e: BasaltEvent): void {
  const span = tracer.startSpan(e.type, { startTime: e.start, attributes: { ...e.attributes } })
  if (e.failed) span.setStatus({ code: SpanStatusCode.ERROR })
  span.end('duration' in e ? e.start + e.duration : e.start)
}
