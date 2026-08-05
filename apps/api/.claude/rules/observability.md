---
paths:
  - apps/api/**
---

# Observability (apps/api)

OpenTelemetry traces + logs ship to **ClickStack** (HyperDX). The Elysia OpenTelemetry plugin (`@elysiajs/opentelemetry`) wires NodeSDK internally — we layer manual instrumentation on top of it.

Local dev mirrors prod: both use ClickStack's unauthed `:4319` receiver (added via the same custom config merge — `vps/clickstack/otel-custom.yaml` — in both `vps/compose.dev.yml` and the prod monitoring stack). No ingestion key in the API path on either side. See `~/SourceRoot/vps/docs/observability.md` for the architecture.

| Environment | Endpoint                                         | Auth |
| ----------- | ------------------------------------------------ | ---- |
| Local dev   | `http://localhost:4319` (from `compose.dev.yml`) | none |
| Prod        | `http://clickstack:4319` (over `monitoring-net`) | none |

## Files

| File                      | Role                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/telemetry.ts`        | Exports `telemetryConfig` (resource + processors), `tracer`, and `log` helper. **The OTel entry point.** |
| `src/lib/traced-fetch.ts` | Drop-in `fetch` replacement that emits a CLIENT span + injects W3C `traceparent`.                        |
| `src/db/index.ts`         | Drizzle client wrapped with `instrumentDrizzleClient` (`@kubiks/otel-drizzle`) → CLIENT spans per query. |
| `src/cron/*.ts`           | Cron ticks wrapped in `tracedTick()` (`context.with(ROOT_CONTEXT, …)`) so each tick is a fresh trace.    |
| `src/index.ts`            | Mounts `opentelemetry(...)` plugin first, then `cors(...)` with traceparent allowed, then routes.        |

## Env vars

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4319  # local; prod sets http://clickstack:4319
OTEL_SERVICE_NAME=argo-api                         # service.name resource attribute
OTEL_SERVICE_VERSION=                              # optional; falls back to package.json version
```

No `OTEL_EXPORTER_OTLP_HEADERS` — the `:4319` receiver doesn't enforce auth. The endpoint must be the **base origin only**. Do not include `/v1/traces` — the exporter appends it. If you ever see `/v1/traces/v1/traces` in network logs, that's the bug.

The bundled `:4317` (gRPC) and `:4318` (HTTP) receivers still enforce `bearertokenauth` in both envs, but nothing in argo's API path uses them. See `~/SourceRoot/vps/docs/observability.md` for the two-tier rationale.

## Plugin order in `src/index.ts`

```ts
export const app = new Elysia()
  .use(opentelemetry({
    ...telemetryConfig,
    checkIfShouldTrace: (req) => {
      const u = new URL(req.url)
      return u.pathname !== '/'
          && u.pathname !== '/health'
          && !u.pathname.startsWith('/openapi')
    },
  }))
  .onError(({ error }) => {
    const span = trace.getActiveSpan()
    if (span) {
      span.recordException(error as Error)
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
    }
  })
  .use(cors({
    origin: [...],
    allowedHeaders: ['Authorization', 'Content-Type', 'traceparent', 'tracestate', 'baggage'],
    exposeHeaders: ['x-total-count'],
  }))
```

**CORS must allow `traceparent`, `tracestate`, `baggage`.** Without them the browser preflight strips W3C trace context and frontend/backend traces will have different `trace_id`s — distributed tracing breaks silently.

**`checkIfShouldTrace` must skip the discovery surfaces** (`/`, `/health`, `/openapi`, `/openapi/json`). They are polled frequently and generate noise. Extend this list whenever you add a public probe route.

## Outgoing HTTP — always `tracedFetch`

Never call bare `fetch` from a `clients/*` module, a route handler, or a cron tick. Use `tracedFetch` from `src/lib/traced-fetch.ts`:

```ts
import { tracedFetch } from '../lib/traced-fetch.js'

const res = await tracedFetch(url, { headers: { Authorization: `Bearer ${token}` } })
```

What you get:

- CLIENT span named `${method} ${host}${path}` with `http.request.method`, `url.full`, `server.address`, `http.response.status_code`.
- W3C `traceparent` injected into outgoing headers — the receiving service (if it runs OTel) continues the trace.
- 4xx/5xx auto-marked as error spans.

For Hey-API-generated clients (`@hey-api/client-fetch`), pass `tracedFetch` to `createConfig`:

```ts
export const ticktickClient = createClient(
  createConfig({
    baseUrl: 'https://ticktick.com',
    fetch: (req) => tracedFetch(req),
  }),
)
```

That instruments every generated SDK call, not just bare-fetch.

### Streaming responses — body-tapping is opt-in via `streamLifecycle`

A CLIENT span created for a response WITH a body only stays open past `fetch` resolving (TTFB) when the caller opts in with `streamLifecycle: true`. This is deliberately **opt-in, not opt-out**: most `tracedFetch` call sites (fire-and-forget pings, `.ok`-only health checks, `ensureHermesSession`'s 201 whose body is never read) never drain their body at all, so tapping by default silently reclassified every one of them — each held a span, a watchdog timer, and the connection open for up to `watchdogMs` for routine traffic that was never meant to be a stream. That was a real defect (fixed in A2): `notifications/initialized` fire-and-forget POSTs, the Garmin `pingHeartbeat` cron ping, `GET /hermes/health`, and `ensureHermesSession` (runs on every chat turn) were all accidentally reclassified as streams and force-closed `abandoned` after 10 minutes instead of ending at header time like every non-streaming call.

With `streamLifecycle: true` (and a body present and `response.ok`), `tracedFetch` taps `response.body` and ends the span on whichever terminal event happens first:

| `argo.stream.outcome` | Trigger                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `complete`            | The body was read to `done: true` (a normal `.json()`/`.text()`/manual read to completion).                                                                                                                        |
| `cancelled`           | The consumer called `.cancel()` on the returned response's body (walked away deliberately).                                                                                                                        |
| `error`               | A read on the underlying body threw (upstream connection dropped, abort mid-read, etc.) — also sets `recordException` + `setStatus(ERROR)`.                                                                        |
| `abandoned`           | No chunk flowed through the tap for the idle window (default 10 minutes) — a force-end so an ignored stream can't retain the span (and its closure) forever. See "The watchdog is idle, not total-duration" below. |

`argo.stream.bytes` (byte count of what was actually read) is set alongside `argo.stream.outcome` on every one of those four paths. None of the four are set on the immediate-end path (no body, non-2xx, or `streamLifecycle` not `true`, which is the default) — the two are mutually exclusive by construction, not by convention.

A response with **no body**, a **non-2xx status**, or the caller simply not passing `streamLifecycle: true` (the default) ends the span immediately at header time — a non-streaming JSON call still gets its span closed essentially at header time (draining a small buffered body is sub-millisecond, not a meaningful duration change).

**Current opt-in call sites** — set `streamLifecycle: true` because they genuinely stream a body the caller consumes over time:

- `apps/api/src/routes/ai.ts` — the `/ai/v1/chat/completions` passthrough and the three `/ai/v1/audio/*` proxies (transcriptions, speech, podcast).
- `apps/api/src/routes/hermes.ts` — the Hermes chat-stream call. (`ensureHermesSession` in `hermes-upstream.ts` deliberately stays on the default — it never reads its 201 body.)

Everything else stays on the default. Don't flip `streamLifecycle: true` on a call site unless its caller actually consumes the body over time (streams it to a client, or reads it to completion as part of the request) — flipping it on a fire-and-forget or `.ok`-only call reintroduces the exact defect this opt-in exists to prevent.

The third, fully optional argument carries this:

```ts
type TraceOptions = {
  spanName?: string
  attributes?: Record<string, string | number | boolean>
  onSpan?: (span: Span) => void // reach the span mid-stream — see below
  streamLifecycle?: boolean // opt IN to tapping; default false (span ends at header time)
  watchdogMs?: number // override the idle window; default 10 minutes
}

const res = await tracedFetch(url, init, {
  streamLifecycle: true,
  attributes: { 'argo.hermes.thread_id': threadId },
})
```

**`onSpan` is the only way to reach the span mid-stream.** Once `tracedFetch` returns, its span is no longer `trace.getActiveSpan()` — the caller has moved on to consuming the returned `Response`. An id that only becomes known partway through a stream (Hermes' `run_id`, the only id it puts on the wire, arrives on the first SSE event) can still be attached via the handle `onSpan` hands you:

```ts
let hermesSpan: Span | undefined
const res = await tracedFetch(url, init, {
  attributes: { 'argo.hermes.thread_id': threadId, 'argo.hermes.stream_id': streamId },
  onSpan: (span) => {
    hermesSpan = span
  },
})
// ...later, once the first event lands...
hermesSpan?.setAttribute('argo.hermes.run_id', runId)
```

The handle stays valid until one of the four terminal paths above ends it — setting an attribute after that is a no-op on an ended span, not an error.

**Attribute ownership** — don't reinvent these names:

| Attribute                | Set by                          | Purpose                                             |
| ------------------------ | ------------------------------- | --------------------------------------------------- |
| `argo.hermes.thread_id`  | caller, via `attributes`        | ClickHouse join key                                 |
| `argo.hermes.stream_id`  | caller, via `attributes`        | correlates POST → resume → stop                     |
| `argo.hermes.session_id` | caller, via `attributes`        | Hermes-side correlation                             |
| `argo.hermes.run_id`     | caller, via `onSpan` mid-stream | the only id on the Hermes wire                      |
| `argo.stream.bytes`      | `tracedFetch` itself            | payload size actually read                          |
| `argo.stream.outcome`    | `tracedFetch` itself            | `complete` \| `cancelled` \| `error` \| `abandoned` |

**This is the CLIENT side only.** The matching SERVER-side gap (an Elysia route handler's span also closes at TTFB when it returns a streaming `Response`, since the body streams out after the handler function returns) is a separate fix in the route layer — see whichever route wraps a streaming response for its own stream-lifecycle span. Don't assume fixing `tracedFetch` alone makes a Hermes turn's full generation visible in a trace; both halves are needed.

**The watchdog is idle, not total-duration — do not "simplify" it back to a single timer.** It re-arms on every chunk that flows through the tap (debounced: only when at least a quarter of `watchdogMs`, capped at 30s, has passed since the last (re)arm — cheap enough for SSE-rate traffic without re-arming on literally every byte). This lane exists to trace Hermes agent generations, and a Hermes run chaining tool calls can plausibly run past 10 minutes of wall clock while streaming perfectly healthily; a timer armed once at header time and never reset would force-close and mislabel that span `abandoned` mid-flight, corrupting exactly the telemetry this fix produces. The condition it detects is "no bytes for `watchdogMs`", never "alive for `watchdogMs`" — a long-but-healthy stream never trips it no matter how long it runs in total.

**The watchdog deliberately does not cancel the underlying body reader — only the span.** When it fires, it has only proven silence for `watchdogMs`, not that the stream is dead; cancelling would sever a connection that might still resume. This is not a new leak: an undrained-forever body already held its connection open before this watchdog existed (a caller that never calls `.json()`/`.text()`/reads/cancels its response was already leaking that resource) — the watchdog closes the span-retention half of that failure mode, it does not (and is not trying to) reach in and fix connection cleanup too. Don't "fix" this by adding a `.cancel()` call at the watchdog site.

**Don't reintroduce the watchdog risk.** Every new terminal path (if you ever add one) needs to call the same claim-once gate `tracedFetch` uses internally, and must clear the watchdog on that path — a stream tapped but never terminated is exactly the closure-retention bug this contract exists to prevent.

## Database — auto-traced via @kubiks/otel-drizzle

`src/db/index.ts` wraps Drizzle once at module load:

```ts
export const db = instrumentDrizzleClient(drizzle(client, { schema }), {
  dbSystem: 'postgresql',
})
```

Every query becomes a CLIENT span with `db.statement`, `db.operation`, duration. **Don't add manual spans around Drizzle queries** — that double-spans. If you need extra context, set attributes on the active span:

```ts
trace.getActiveSpan()?.setAttribute('argo.user_id', userId)
const result = await db.select().from(workouts).where(eq(workouts.user_id, userId))
```

## Cron jobs — ROOT_CONTEXT + named span

Cron ticks have no parent request context, but croner uses `setTimeout` which can carry async context across ticks. **Always wrap with `context.with(ROOT_CONTEXT, …)`** so each tick is its own trace, otherwise long-running ticks can become parents of subsequent ticks.

Pattern (see `src/cron/garmin-sync.ts` for the working example):

```ts
import { context, ROOT_CONTEXT, SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { tracer } from '../telemetry.js'

async function tracedTick(
  name: string,
  attributes: Record<string, string>,
  fn: () => Promise<unknown>,
) {
  await context.with(ROOT_CONTEXT, () =>
    tracer.startActiveSpan(name, { kind: SpanKind.INTERNAL, attributes }, async (span) => {
      try {
        await fn()
        span.setStatus({ code: SpanStatusCode.OK })
      } catch (err) {
        span.recordException(err as Error)
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
        throw err
      } finally {
        span.end()
      }
    }),
  )
}

new Cron('0 */6 * * *', () => {
  void tracedTick('cron.garmin-sync.scheduled', { 'cron.schedule': '0 */6 * * *' }, () =>
    runGarminSync('scheduled'),
  )
})
```

**Naming convention**: `cron.<job>.<flavor>` (e.g. `cron.garmin-sync.scheduled`, `cron.garmin-sync.manual-refresh`). Child spans inside a tick use the regular CLIENT/INTERNAL conventions (`http.client.garmin.activities`, `db.upsert.daily-metrics`).

## Structured logging

`src/telemetry.ts` exports a `log` helper that emits OTel log records (correlated with the active span via SDK context) AND writes to console for terminal visibility:

```ts
import { log } from '../telemetry.js'

log.info('garmin-sync starting', { reason, backfill_days: BACKFILL_DAYS })
log.warn('heartbeat ping failed', { url: HEARTBEAT_URL })
log.error('upsert daily-metrics failed', err, { date: m.date })
```

Severities map to OTel `SeverityNumber` so HyperDX shows them with proper icons. Errors emitted via `log.error(msg, err)` auto-attach `exception.type`, `exception.message`, `exception.stacktrace`.

**New code should use `log` instead of bare `console.*`.** Existing `console.log/warn/error` calls still work (uncaught errors are captured via the active span's `recordException` in `onError`) — migrate opportunistically, don't refactor pre-existing code just for logging.

## Manual spans (sparingly)

For meaningful units of work that aren't covered by the route span / DB span / fetch span, use `tracer.startActiveSpan`. Only add these when the trace tree would be missing a leg:

```ts
import { trace, SpanStatusCode } from '@opentelemetry/api'
import { tracer } from '../telemetry.js'

return tracer.startActiveSpan('strength.compute-e1rm', async (span) => {
  try {
    const result = computeE1RM(sets)
    span.setAttribute('strength.set_count', sets.length)
    return result
  } catch (err) {
    span.recordException(err as Error)
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
    throw err
  } finally {
    span.end()
  }
})
```

Don't wrap simple synchronous helpers — spans cost more than they're worth for sub-millisecond ops.

## What NOT to do

- ❌ Bare `fetch(...)` in any module that runs server-side. Always `tracedFetch`.
- ❌ Manual spans around Drizzle queries (already instrumented via `@kubiks/otel-drizzle`).
- ❌ `OTEL_EXPORTER_OTLP_ENDPOINT=http://host/v1/traces` — the SDK appends the path; you'll double up.
- ❌ Removing `traceparent` / `tracestate` / `baggage` from `cors.allowedHeaders` — breaks browser→API trace linkage.
- ❌ Adding new routes to the trace-filter (`checkIfShouldTrace`) unless they're public-poll/probe endpoints. Skipping business endpoints hides bugs.
- ❌ Calling `tracer.startActiveSpan` from a cron without `context.with(ROOT_CONTEXT, …)` — ticks will chain.
- ❌ Catching errors silently inside a traced span without `span.recordException` + `setStatus(ERROR)`. The span will report green even though work failed.
- ❌ `@opentelemetry/instrumentation-fs` under Bun — hangs the runtime. We don't use auto-instrumentations, so this is not a current risk; flag it if anyone proposes moving to `@opentelemetry/sdk-node`.

## Verifying locally

> **Port correction (2026-08-05):** this section previously said ClickStack "starts on `127.0.0.1:4318`" and that `bun dev` needs `OTEL_EXPORTER_OTLP_HEADERS` to reach the API exporter. Neither matches reality: `apps/api/.env.local.tpl` sets `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4319` (the unauthed receiver — matches the table at the top of this file and prod's `http://clickstack:4319` in `vps/apps/argo/compose.yml`), and `apps/api/src/env.ts` has no `OTEL_EXPORTER_OTLP_HEADERS` field at all — the API's own traces need no ingestion key. `compose.dev.yml` starts BOTH receivers (`:4318` authed, `:4319` unauthed); the API targets `:4319`. `env.ts`'s schema default for `OTEL_EXPORTER_OTLP_ENDPOINT` (`http://127.0.0.1:4318`) is a vestigial fallback that real local dev never hits, since `.env.local.tpl` always overrides it — don't treat that default as the source of truth for which port is live.

1. `cd ~/SourceRoot/vps && make up` — starts ClickStack (both the authed `:4318` and unauthed `:4319` receivers), UI at `https://hyperdx.test`.
2. **First-run only**: visit `https://hyperdx.test`, create the admin account, then Team Settings → Ingestion API Keys → copy. Save in 1Password: `op item edit argo --account tkrumm --vault vps "HYPERDX_API_KEY_LOCAL[password]=<paste>"`. This key is for the **dashboard's** browser-side traces (`VITE_HYPERDX_API_KEY`, sent over the authed `:4318` receiver since the browser needs a real credential) — the API's own traces need no key (see the correction above).
3. `bun dev` — API on `:4040`, dashboard via Vite proxy. `VITE_HYPERDX_API_KEY` reaches the browser; the API talks to `:4319` with no headers.
4. Hit a real endpoint (not `/health`): `curl -H "Authorization: Bearer $API_SECRET" https://argo.test/api/workouts`.
5. Open `https://hyperdx.test` → Services → `argo-api`. Expect a trace with route span → drizzle span(s) → tracedFetch span(s) if the route calls out.
6. Click a workout in the dashboard → expect ONE trace with `argo-dashboard` (CLIENT) → `argo-api` (SERVER) → child spans. Different `trace_id`s on the two sides = CORS or propagation regex bug.

**Sanity probe** — verify ClickStack's authed receiver accepts your key (this checks the receiver the dashboard uses, `:4318` — it does not exercise the API's own `:4319` unauthed path):

```bash
KEY=$(op read "op://vps/argo/HYPERDX_API_KEY_LOCAL" --account tkrumm)
curl -sS -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:4318/v1/traces \
  -H "Content-Type: application/json" \
  -H "authorization: $KEY" \
  -d '{"resourceSpans":[]}'
# expect: 200 (empty payload accepted). 401 = key missing/wrong. 400 = key OK, payload format issue (which is fine for this probe).
```
