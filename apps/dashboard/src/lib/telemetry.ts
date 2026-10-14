import { isSpanContextValid, type Span, SpanStatusCode, trace } from '@opentelemetry/api'
import type { BasaltEvent, ChatTurnTrace, Telemetry } from 'basalt-ui'

// `@opentelemetry/api` is pinned to 1.8.0, the version `@hyperdx/browser` registers its global
// provider under: the API ignores a global registered by a LOWER minor than its own, so 1.9.x here
// silently yields a no-op tracer (observed live in the Wave 4 evidence run).
// `@hyperdx/browser` registers the global tracer provider inside `HyperDX.init`
// (`@hyperdx/otel-web` `provider.register`), so this tracer exports through it. Without init the
// API hands back a no-op tracer and `telemetry` is inert. `ProxyTracer` resolves the provider
// lazily, so module order against `lib/hyperdx.ts` does not matter.
const tracer = trace.getTracer('basalt-ui')

// Open `chat.turn` spans by thread. `settle` runs right after the turn's `chat.turn` event, so the
// event decorates the span `startChatTurn` opened instead of becoming a second span for the turn.
const openTurns = new Map<string, Span>()

function onEvent(e: BasaltEvent): void {
  const open =
    e.type === 'chat.turn' ? openTurns.get(e.attributes['basalt.chat.thread_id']) : undefined
  if (open) {
    open.setAttributes({ ...e.attributes })
    if (e.failed) open.setStatus({ code: SpanStatusCode.ERROR })
    return
  }
  const span = tracer.startSpan(e.type, { startTime: e.start, attributes: { ...e.attributes } })
  if (e.failed) span.setStatus({ code: SpanStatusCode.ERROR })
  span.end('duration' in e ? e.start + e.duration : e.start)
}

/** Opens the turn's `chat.turn` span and hands its W3C `traceparent` to the chat request. */
function startChatTurn({ threadId }: { threadId: string }): ChatTurnTrace | undefined {
  const span = tracer.startSpan('chat.turn', { attributes: { 'basalt.chat.thread_id': threadId } })
  openTurns.set(threadId, span)
  const settle: ChatTurnTrace['settle'] = (end) => {
    if (end === 'failed') span.setStatus({ code: SpanStatusCode.ERROR })
    if (openTurns.get(threadId) === span) openTurns.delete(threadId)
    span.end()
  }
  const ctx = span.spanContext()
  // A no-op tracer yields the all-zero invalid context: send no header, still settle.
  if (!isSpanContextValid(ctx)) return { settle }
  const flags = (ctx.traceFlags & 0xff).toString(16).padStart(2, '0')
  return { headers: { traceparent: `00-${ctx.traceId}-${ctx.spanId}-${flags}` }, settle }
}

/** `BasaltProvider telemetry` sink: one span per `BasaltEvent`, ids/hashes/counts/durations only. */
export const telemetry: Telemetry = Object.assign(onEvent, { startChatTurn })
