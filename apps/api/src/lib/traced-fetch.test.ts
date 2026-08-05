import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { trace, type Span } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { tracedFetch } from './traced-fetch.js'

// Real (non-global-side-effecting) tracer provider wired to an in-memory
// exporter — `../telemetry.js`'s `tracer` export is `trace.getTracer(...)`,
// which returns a proxy that resolves its delegate lazily from the globally
// registered provider on every call. Registering a test provider here makes
// every span `tracedFetch` creates land in `exporter` once `span.end()` runs,
// with no need to mock the telemetry module itself.
const exporter = new InMemorySpanExporter()

beforeAll(() => {
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })
  trace.setGlobalTracerProvider(provider)
})

beforeEach(() => {
  exporter.reset()
})

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

/** A ReadableStream<Uint8Array> whose enqueue/close/error are driven externally. */
function controllableStream(): {
  stream: ReadableStream<Uint8Array>
  push: (chunk: Uint8Array) => void
  close: () => void
  error: (err: unknown) => void
} {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller
    },
  })
  return {
    stream,
    push: (chunk) => ctrl.enqueue(chunk),
    close: () => ctrl.close(),
    error: (err) => ctrl.error(err),
  }
}

function stubFetch(handler: (input: string | URL | Request, init?: RequestInit) => Response): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) =>
    handler(input, init)) as unknown as typeof fetch
}

/** Wraps a captured span's `end()` so tests can assert exactly-once ending. */
function spyEnd(span: Span): { calls: () => number } {
  const original = span.end.bind(span)
  let count = 0
  const patched: Span['end'] = (...args) => {
    count += 1
    original(...args)
  }
  ;(span as unknown as { end: Span['end'] }).end = patched
  return { calls: () => count }
}

function findExported(span: Span): ReadableSpan | undefined {
  const ctx = span.spanContext()
  return exporter.getFinishedSpans().find((s) => s.spanContext().spanId === ctx.spanId)
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader()
  // eslint-disable-next-line no-constant-condition -- drain-to-completion loop
  while (true) {
    const { done } = await reader.read()
    if (done) return
  }
}

describe('tracedFetch', () => {
  it('non-streaming response (no body): span ends immediately, argo.stream.* not set', async () => {
    stubFetch(() => new Response(null, { status: 200 }))
    let captured: Span | undefined
    const res = await tracedFetch('https://example.test/health', undefined, {
      onSpan: (span) => {
        captured = span
      },
    })
    expect(res.status).toBe(200)
    expect(captured).toBeDefined()
    expect(captured?.isRecording()).toBe(false)
    const exported = findExported(captured!)
    expect(exported).toBeDefined()
    expect(exported?.attributes['argo.stream.outcome']).toBeUndefined()
    expect(exported?.attributes['argo.stream.bytes']).toBeUndefined()
  })

  it('!response.ok with a body: span ends immediately, does not wait on the body', async () => {
    const { stream } = controllableStream() // deliberately never pushed/closed
    stubFetch(() => new Response(stream, { status: 500 }))
    let captured: Span | undefined
    const res = await tracedFetch('https://example.test/broken', undefined, {
      onSpan: (span) => {
        captured = span
      },
    })
    expect(res.status).toBe(500)
    expect(captured?.isRecording()).toBe(false)
    const exported = findExported(captured!)
    expect(exported?.attributes['argo.stream.outcome']).toBeUndefined()
  })

  it('streaming response with streamLifecycle: true: span does NOT end when headers arrive', async () => {
    const { stream } = controllableStream()
    stubFetch(() => new Response(stream, { status: 200 }))
    let captured: Span | undefined
    const res = await tracedFetch('https://example.test/stream', undefined, {
      streamLifecycle: true,
      onSpan: (span) => {
        captured = span
      },
    })
    // Headers have arrived (tracedFetch resolved) — the span must still be open.
    expect(res.status).toBe(200)
    expect(captured?.isRecording()).toBe(true)
  })

  it('streaming response with streamLifecycle: true, fully drained: ends in flush with outcome=complete and correct byte count', async () => {
    const { stream, push, close } = controllableStream()
    stubFetch(() => new Response(stream, { status: 200 }))
    let captured: Span | undefined
    const res = await tracedFetch('https://example.test/stream', undefined, {
      streamLifecycle: true,
      onSpan: (span) => {
        captured = span
      },
    })
    expect(captured?.isRecording()).toBe(true)

    push(new Uint8Array([1, 2, 3]))
    push(new Uint8Array([4, 5]))
    close()
    await drain(res.body!)

    expect(captured?.isRecording()).toBe(false)
    const exported = findExported(captured!)
    expect(exported?.attributes['argo.stream.outcome']).toBe('complete')
    expect(exported?.attributes['argo.stream.bytes']).toBe(5)
  })

  it('streamLifecycle: true, consumer cancels mid-body: span ends with outcome=cancelled', async () => {
    const { stream, push } = controllableStream()
    stubFetch(() => new Response(stream, { status: 200 }))
    let captured: Span | undefined
    const res = await tracedFetch('https://example.test/stream', undefined, {
      streamLifecycle: true,
      onSpan: (span) => {
        captured = span
      },
    })
    push(new Uint8Array([1, 2]))
    await res.body!.cancel('caller went away')

    expect(captured?.isRecording()).toBe(false)
    const exported = findExported(captured!)
    expect(exported?.attributes['argo.stream.outcome']).toBe('cancelled')
  })

  it('streamLifecycle: true, upstream errors mid-body: recordException + ERROR status + outcome=error, ends exactly once', async () => {
    const { stream, push, error } = controllableStream()
    stubFetch(() => new Response(stream, { status: 200 }))
    let captured: Span | undefined
    const res = await tracedFetch('https://example.test/stream', undefined, {
      streamLifecycle: true,
      onSpan: (span) => {
        captured = span
      },
    })
    const endSpy = spyEnd(captured!)
    push(new Uint8Array([9]))
    error(new Error('upstream connection reset'))

    await expect(drain(res.body!)).rejects.toThrow()

    expect(captured?.isRecording()).toBe(false)
    expect(endSpy.calls()).toBe(1)
    const exported = findExported(captured!)
    expect(exported?.attributes['argo.stream.outcome']).toBe('error')
    expect(exported?.status.code).toBe(2 /* SpanStatusCode.ERROR */)
    expect(exported?.events.some((e) => e.name === 'exception')).toBe(true)
  })

  it('transport throws before headers: span ends, error rethrown', async () => {
    globalThis.fetch = (async () => {
      throw new Error('DNS resolution failed')
    }) as unknown as typeof fetch
    let captured: Span | undefined
    await expect(
      tracedFetch('https://example.test/unreachable', undefined, {
        onSpan: (span) => {
          captured = span
        },
      }),
    ).rejects.toThrow('DNS resolution failed')

    expect(captured?.isRecording()).toBe(false)
    const exported = findExported(captured!)
    expect(exported?.status.code).toBe(2 /* SpanStatusCode.ERROR */)
    expect(exported?.events.some((e) => e.name === 'exception')).toBe(true)
  })

  it('streamLifecycle: true, idle watchdog: a stream silent past the idle window trips it with outcome=abandoned', async () => {
    const { stream } = controllableStream() // never drained, never cancelled — genuine silence
    stubFetch(() => new Response(stream, { status: 200 }))
    let captured: Span | undefined
    await tracedFetch('https://example.test/stream', undefined, {
      streamLifecycle: true,
      watchdogMs: 20,
      onSpan: (span) => {
        captured = span
      },
    })
    expect(captured?.isRecording()).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(captured?.isRecording()).toBe(false)
    const exported = findExported(captured!)
    expect(exported?.attributes['argo.stream.outcome']).toBe('abandoned')
  })

  it('streamLifecycle: true, idle watchdog is reset by activity: a stream that keeps emitting past the idle window does NOT trip it', async () => {
    const { stream, push, close } = controllableStream()
    stubFetch(() => new Response(stream, { status: 200 }))
    let captured: Span | undefined
    const res = await tracedFetch('https://example.test/stream', undefined, {
      streamLifecycle: true,
      // watchdogMs=200 -> rearmDebounceMs derives to 50ms (min(30_000, 200/4)).
      // This is the regression the idle-reset behavior prevents: a
      // total-duration timer would have fired at 200ms, well before this
      // loop's total ~240ms (4 * 60ms) elapses. Each chunk, arriving 60ms
      // after the last (re)arm (> the 50ms debounce), pushes the 200ms
      // deadline back out, so the span must stay open the entire time —
      // mirroring a long-but-healthy Hermes run that keeps streaming
      // tool-call output well past 10 minutes. Margins here (60ms sleep vs
      // 50ms debounce, 200ms deadline vs a fresh 200ms window each rearm)
      // are generous specifically to absorb real-timer jitter under a busy
      // test runner.
      watchdogMs: 200,
      onSpan: (span) => {
        captured = span
      },
    })
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 60))
      push(new Uint8Array([i]))
      expect(captured?.isRecording()).toBe(true)
    }
    close()
    await drain(res.body!)

    expect(captured?.isRecording()).toBe(false)
    const exported = findExported(captured!)
    expect(exported?.attributes['argo.stream.outcome']).toBe('complete')
  })

  it('streamLifecycle: true, watchdog-then-drain: still ends exactly once, keeps the abandoned outcome', async () => {
    const { stream, push, close } = controllableStream()
    stubFetch(() => new Response(stream, { status: 200 }))
    let captured: Span | undefined
    const res = await tracedFetch('https://example.test/stream', undefined, {
      streamLifecycle: true,
      watchdogMs: 15,
      onSpan: (span) => {
        captured = span
      },
    })
    const endSpy = spyEnd(captured!)
    await new Promise((resolve) => setTimeout(resolve, 40)) // let the watchdog fire

    // A late drain must not resurrect or double-end the span, nor flip its outcome.
    push(new Uint8Array([1, 2, 3]))
    close()
    await drain(res.body!)

    expect(endSpy.calls()).toBe(1)
    const exported = findExported(captured!)
    expect(exported?.attributes['argo.stream.outcome']).toBe('abandoned')
  })

  it('streamLifecycle: true, drain-then-cancel: ends exactly once (the later cancel is a no-op)', async () => {
    const { stream, push, close } = controllableStream()
    stubFetch(() => new Response(stream, { status: 200 }))
    let captured: Span | undefined
    const res = await tracedFetch('https://example.test/stream', undefined, {
      streamLifecycle: true,
      onSpan: (span) => {
        captured = span
      },
    })
    const endSpy = spyEnd(captured!)
    push(new Uint8Array([1]))
    close()
    await drain(res.body!)
    await res.body!.cancel('too late').catch(() => {})

    expect(endSpy.calls()).toBe(1)
    const exported = findExported(captured!)
    expect(exported?.attributes['argo.stream.outcome']).toBe('complete')
  })

  // Regression guard for the whole defect this fix round addresses: body-tapping
  // used to be the DEFAULT, which silently reclassified every pre-existing 2xx
  // call site that never drains its body (fire-and-forget pings, `.ok`-only
  // health checks) into holding a span + watchdog + connection open for up to
  // `watchdogMs`. Tapping is now opt-in via `streamLifecycle: true` — this test
  // is the explicit assertion that the DEFAULT (the option omitted entirely)
  // ends the span at header time and never touches the body.
  it('DEFAULT (no streamLifecycle): a 2xx streaming response ends its span at header time and does not tap the body', async () => {
    const { stream } = controllableStream() // deliberately never pushed/closed/cancelled
    stubFetch(() => new Response(stream, { status: 200 }))
    let captured: Span | undefined
    const res = await tracedFetch('https://example.test/stream', undefined, {
      onSpan: (span) => {
        captured = span
      },
    })
    expect(res.status).toBe(200)
    expect(captured?.isRecording()).toBe(false)
    const exported = findExported(captured!)
    expect(exported?.attributes['argo.stream.outcome']).toBeUndefined()
    expect(exported?.attributes['argo.stream.bytes']).toBeUndefined()
    // The untouched original body still streams through untapped — a caller
    // that never reads it (the exact fire-and-forget shape this default
    // protects) is not blocked or altered by tracedFetch either way.
    expect(res.body).toBeDefined()
  })

  // Same defect, the other visible symptom: an undrained body without the flag
  // must not arm the idle watchdog (a fallback timer with nothing to fall back
  // FOR, since the span already ended at header time). A short watchdogMs is
  // used so a leaked timer would fire well within the test's lifetime if one
  // were armed.
  it('DEFAULT (no streamLifecycle): a body that is never drained arms no watchdog and leaves no open span', async () => {
    const { stream } = controllableStream() // never drained, never cancelled
    stubFetch(() => new Response(stream, { status: 200 }))
    let captured: Span | undefined
    const endSpyHolder: { calls: () => number } = { calls: () => 0 }
    await tracedFetch('https://example.test/stream', undefined, {
      watchdogMs: 15,
      onSpan: (span) => {
        captured = span
        const spy = spyEnd(span)
        endSpyHolder.calls = spy.calls
      },
    })
    expect(captured?.isRecording()).toBe(false)
    expect(endSpyHolder.calls()).toBe(1) // ended once, at header time

    // Wait past what would have been the watchdog window — a leaked/armed
    // timer would call span.end() a second time here.
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(endSpyHolder.calls()).toBe(1)
  })

  it('preserves status, statusText and headers on the returned (tapped) Response', async () => {
    const { stream, close } = controllableStream()
    stubFetch(
      () =>
        new Response(stream, {
          status: 201,
          statusText: 'Created',
          headers: { 'content-type': 'application/x-custom', 'x-request-id': 'abc123' },
        }),
    )
    const res = await tracedFetch('https://example.test/create')
    expect(res.status).toBe(201)
    expect(res.statusText).toBe('Created')
    expect(res.headers.get('content-type')).toBe('application/x-custom')
    expect(res.headers.get('x-request-id')).toBe('abc123')
    close()
    await drain(res.body!)
  })

  it('streamLifecycle: true, onSpan attribute set mid-stream (after headers, before drain) lands on the exported span', async () => {
    const { stream, push, close } = controllableStream()
    stubFetch(() => new Response(stream, { status: 200 }))
    const res = await tracedFetch(
      'https://example.test/stream',
      {},
      {
        streamLifecycle: true,
        attributes: { 'argo.hermes.thread_id': 'thr_1', 'argo.hermes.stream_id': 'strm_1' },
        onSpan: (span) => {
          // Simulate the route setting the run_id once it's known from the
          // first SSE event — well after tracedFetch itself has returned.
          span.setAttribute('argo.hermes.run_id', 'run_42')
        },
      },
    )
    push(new Uint8Array([1, 2]))
    close()
    await drain(res.body!)

    // Recover the span via a second onSpan-free call is not possible here, so
    // assert via the exporter directly: exactly one finished span, carrying
    // both the caller-supplied and the mid-stream attribute.
    const [exported] = exporter.getFinishedSpans()
    expect(exported?.attributes['argo.hermes.thread_id']).toBe('thr_1')
    expect(exported?.attributes['argo.hermes.stream_id']).toBe('strm_1')
    expect(exported?.attributes['argo.hermes.run_id']).toBe('run_42')
  })
})
