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

1. `cd ~/SourceRoot/vps && make up` — starts ClickStack on `127.0.0.1:4318`, UI at `https://hyperdx.test`.
2. **First-run only**: visit `https://hyperdx.test`, create the admin account, then Team Settings → Ingestion API Keys → copy. Save in 1Password: `op item edit argo --account tkrumm --vault vps "HYPERDX_API_KEY_LOCAL[password]=<paste>"`. Without this `op run` will fail (the ref is unresolvable) AND ClickStack would 401 the traces.
3. `bun dev` — API on `:4000`, dashboard via Vite proxy. Both env files are loaded so `VITE_HYPERDX_API_KEY` reaches the browser and `OTEL_EXPORTER_OTLP_HEADERS` reaches the API exporter.
4. Hit a real endpoint (not `/health`): `curl -H "Authorization: Bearer $API_SECRET" https://argo.test/api/workouts`.
5. Open `https://hyperdx.test` → Services → `argo-api`. Expect a trace with route span → drizzle span(s) → tracedFetch span(s) if the route calls out.
6. Click a workout in the dashboard → expect ONE trace with `argo-dashboard` (CLIENT) → `argo-api` (SERVER) → child spans. Different `trace_id`s on the two sides = CORS or propagation regex bug.

**Sanity probe** — verify ClickStack accepts your key:

```bash
KEY=$(op read "op://vps/argo/HYPERDX_API_KEY_LOCAL" --account tkrumm)
curl -sS -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:4318/v1/traces \
  -H "Content-Type: application/json" \
  -H "authorization: $KEY" \
  -d '{"resourceSpans":[]}'
# expect: 200 (empty payload accepted). 401 = key missing/wrong. 400 = key OK, payload format issue (which is fine for this probe).
```
