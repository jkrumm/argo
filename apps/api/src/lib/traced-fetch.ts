import { context, propagation, SpanKind, SpanStatusCode, type Span } from '@opentelemetry/api'
import { tracer } from '../telemetry.js'

/**
 * Fetch wrapper that creates an OTel CLIENT span for outgoing HTTP requests
 * and injects W3C traceparent so the downstream service can continue the
 * trace. Use in clients/* and any other place that calls an external HTTP
 * service from inside a request handler or a cron tick.
 *
 * Drop-in replacement for `fetch` for the (input, init) shape — the third,
 * optional `traceOptions` argument is purely additive, so no existing call
 * site needs to change.
 *
 * Streaming contract: `streamLifecycle: true` on a response WITH a body (and
 * `response.ok`) keeps its span open past header time — reachable via
 * `onSpan` — until the body is fully drained (`argo.stream.outcome=complete`),
 * the consumer cancels it (`cancelled`), a read errors (`error`), or the
 * IDLE watchdog fires because no chunk has flowed for `watchdogMs`
 * (`abandoned`). The watchdog is an idle timeout, not a total-duration one —
 * it re-arms on every chunk, so a long-but-healthy stream (a Hermes run
 * chaining tool calls for many minutes) never trips it; only genuine silence
 * does. Every other case — no body, a non-2xx status, or `streamLifecycle`
 * not set (the default) — ends the span immediately at header time. Opting
 * in is deliberate: most call sites never drain their body (fire-and-forget
 * pings, `.ok`-only health checks), and tapping those by default would hold
 * a span, its watchdog timer, and the connection open for up to
 * `watchdogMs` for routine traffic — see `shouldTap` below for the precise
 * condition.
 */
export type TraceOptions = {
  /** Override the span name (default: `${method} ${host}${path}`). */
  spanName?: string
  /** Extra attributes set on the span at creation (merged with the standard ones). */
  attributes?: Record<string, string | number | boolean>
  /**
   * Called once, synchronously, with the live span handle — before the
   * upstream `fetch` even resolves. This is the only way to reach the span
   * once it stops being `trace.getActiveSpan()` (e.g. mid-stream, once an
   * upstream id becomes known from the first SSE event): the handle stays
   * valid until one of the terminal paths above ends it.
   */
  onSpan?: (span: Span) => void
  /**
   * Opt IN to a stream-lifecycle span: when true (and the response has a
   * body and is ok), the span stays open until the body is
   * drained/cancelled/errors, or the watchdog fires — see the module
   * docstring. Default false: the span ends at header time, same as a
   * caller that never touches this option. Only set this for a call site
   * that genuinely streams a body the caller will consume over time (a
   * Hermes/chat/audio passthrough) — never for a fire-and-forget ping or an
   * `.ok`-only health check, which would otherwise hold a span (and a
   * connection) open for up to `watchdogMs` for no reason.
   */
  streamLifecycle?: boolean
  /**
   * Idle-timeout duration (ms): force-ends the span if no chunk has flowed
   * through the tap for this long. Re-armed on every chunk (debounced — see
   * `tracedFetch`), so a long but genuinely healthy stream (a multi-minute
   * Hermes tool-call chain, say) never trips it no matter how long it runs in
   * total — only silence trips it. Default 10 minutes. Exposed so tests can
   * drive a short duration instead of waiting out the real default.
   */
  watchdogMs?: number
}

const DEFAULT_WATCHDOG_MS = 10 * 60 * 1000

type StreamOutcome = 'complete' | 'cancelled' | 'error'

/**
 * Wraps `response.body` in a manually constructed `ReadableStream` that
 * counts bytes and reports exactly one terminal outcome — normal drain
 * (`complete`), consumer-initiated cancellation (`cancelled`), or a read
 * error (`error`, e.g. the upstream connection drops or an abort fires mid-read).
 *
 * Deliberately NOT a `TransformStream`: the `Transformer` object a
 * `TransformStream` takes only supports `start`/`transform`/`flush` in the
 * standard Streams API (see `lib.dom.d.ts`'s `Transformer` interface) — it has
 * no `cancel` hook, so it can never distinguish "the consumer walked away"
 * from "the body finished". `UnderlyingSource` (what a `ReadableStream`
 * takes) does have `cancel`, which is exactly what this tap needs.
 */
function tapBody(
  body: ReadableStream<Uint8Array>,
  onTerminal: (outcome: StreamOutcome, bytes: number, error?: unknown) => void,
  onChunk: () => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  let bytes = 0
  let settled = false
  const settle = (outcome: StreamOutcome, error?: unknown): void => {
    if (settled) return
    settled = true
    onTerminal(outcome, bytes, error)
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          settle('complete')
          return
        }
        bytes += value.byteLength
        controller.enqueue(value)
        onChunk()
      } catch (error) {
        controller.error(error)
        settle('error', error)
      }
    },
    async cancel(reason) {
      settle('cancelled')
      await reader.cancel(reason).catch(() => {
        // The upstream reader may already be closed/errored — cancelling it
        // is best-effort cleanup, not part of the outcome we report.
      })
    },
  })
}

export async function tracedFetch(
  input: string | URL | Request,
  init?: RequestInit,
  traceOptions?: TraceOptions,
): Promise<Response> {
  const url =
    typeof input === 'string' ? new URL(input) : input instanceof URL ? input : new URL(input.url)
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET')

  return tracer.startActiveSpan(
    traceOptions?.spanName ?? `${method} ${url.hostname}${url.pathname}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'http.request.method': method,
        'url.full': url.href,
        'server.address': url.hostname,
        'url.scheme': url.protocol.replace(':', ''),
        ...traceOptions?.attributes,
      },
    },
    async (span) => {
      traceOptions?.onSpan?.(span)

      // Exactly-once span end, shared by every terminal path (immediate end,
      // catch, tap flush/cancel/error, watchdog). `claimEnd` is the single
      // gate: only the first caller gets `true` back, so a race between two
      // terminal triggers (e.g. the watchdog firing right as the body
      // finishes draining) can never set attributes twice or call
      // `span.end()` twice — the loser's attributes (which would otherwise
      // silently overwrite the winner's, e.g. flipping 'abandoned' back to
      // 'complete') are never applied at all.
      let ended = false
      let watchdog: ReturnType<typeof setTimeout> | undefined
      const clearWatchdog = (): void => {
        if (watchdog !== undefined) clearTimeout(watchdog)
        watchdog = undefined
      }
      const claimEnd = (): boolean => {
        if (ended) return false
        ended = true
        clearWatchdog()
        return true
      }

      try {
        const traceHeaders: Record<string, string> = {}
        propagation.inject(context.active(), traceHeaders)

        const mergedHeaders = new Headers(
          init?.headers ?? (input instanceof Request ? input.headers : undefined),
        )
        for (const [key, value] of Object.entries(traceHeaders)) {
          mergedHeaders.set(key, value)
        }

        const response = await fetch(input, { ...init, headers: mergedHeaders })
        span.setAttribute('http.response.status_code', response.status)
        if (response.status >= 400) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${response.status}` })
        }

        const shouldTap =
          traceOptions?.streamLifecycle === true && response.body !== null && response.ok
        if (!shouldTap) {
          if (claimEnd()) span.end()
          return response
        }

        // Arm an IDLE watchdog — not a total-duration one. A caller that never
        // drains the body (never calls .json()/.text()/reads the stream, and
        // never cancels it either) would otherwise retain this span — and its
        // closure — forever, so a fallback end is mandatory. But this lane
        // traces Hermes agent generations, which can legitimately chain tool
        // calls for many minutes while streaming perfectly healthily — a
        // total-duration timer would force-close and mislabel that span
        // `abandoned` mid-flight, corrupting exactly the telemetry this fix
        // exists to produce. So the timer re-arms on every chunk (`noteActivity`,
        // wired into `tapBody`'s `onChunk`) — the condition it actually
        // detects is "no bytes for `watchdogMs`", not "alive for `watchdogMs`".
        // unref() so a pending watchdog alone can never hold the process open.
        //
        // Re-arming a `setTimeout` on literally every chunk is wasteful on a
        // high-throughput body, so the re-arm itself is debounced: only when
        // at least a quarter of the idle window (capped at 30s) has passed
        // since the timer was last (re)armed. At the 10-minute default that's
        // a 30s debounce — a single, simpler knob than a periodic-checker
        // alternative, and it scales down automatically with an injected
        // (test) `watchdogMs` instead of needing a second one.
        const watchdogMs = traceOptions?.watchdogMs ?? DEFAULT_WATCHDOG_MS
        const rearmDebounceMs = Math.min(30_000, Math.max(1, Math.floor(watchdogMs / 4)))
        let lastArmedAt = 0
        const armWatchdog = (): void => {
          clearWatchdog()
          watchdog = setTimeout(() => {
            if (!claimEnd()) return
            // Deliberately does NOT cancel the underlying body reader — only
            // the span. Cancelling would sever a stream that might resume
            // (this is an idle timeout, not proof of death), and this only
            // fires after real silence, so there's no healthy stream left to
            // protect. An undrained body already leaked its connection before
            // this watchdog existed; ending the span doesn't add that leak,
            // and reaching in to fix it here is a different, larger change
            // than this lane's scope (span lifecycle) — don't "fix" it by
            // adding a cancel call.
            span.setAttribute('argo.stream.outcome', 'abandoned')
            span.end()
          }, watchdogMs)
          watchdog.unref?.()
          lastArmedAt = Date.now()
        }
        const noteActivity = (): void => {
          if (Date.now() - lastArmedAt >= rearmDebounceMs) armWatchdog()
        }
        armWatchdog()

        const tapped = tapBody(
          response.body,
          (outcome, bytes, error) => {
            if (!claimEnd()) return
            span.setAttribute('argo.stream.bytes', bytes)
            span.setAttribute('argo.stream.outcome', outcome)
            if (outcome === 'error') {
              span.recordException(error as Error)
              span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
            }
            span.end()
          },
          noteActivity,
        )

        // fetch has already decoded the body — a byte-identical passthrough
        // keeps content-length valid, so encoding headers are NOT stripped
        // here (contrast the Hermes route's tap in routes/hermes.ts, which
        // REWRITES the body via filterToolProgress and must strip them).
        return new Response(tapped, {
          status: response.status,
          statusText: response.statusText,
          headers: new Headers(response.headers),
        })
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
        span.recordException(error as Error)
        if (claimEnd()) span.end()
        throw error
      }
    },
  )
}
