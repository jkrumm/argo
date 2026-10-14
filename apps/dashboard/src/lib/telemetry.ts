import { SpanStatusCode, trace } from '@opentelemetry/api'
import type { BasaltEvent } from 'basalt-ui'

// `@opentelemetry/api` is pinned to 1.8.0, the version `@hyperdx/browser` registers its global
// provider under: the API ignores a global registered by a LOWER minor than its own, so 1.9.x here
// silently yields a no-op tracer (observed live in the Wave 4 evidence run).
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
