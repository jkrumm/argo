# API runtime and observability

Moved from `apps/api/AGENTS.md`. Read before changing OTel setup, env vars, the native mini runtime or the production LaunchAgent.

## Observability

OpenTelemetry traces + logs ship to ClickStack via `@elysiajs/opentelemetry`. `src/telemetry.ts` is the single entry point — exports `telemetryConfig`, `tracer`, and a structured `log` helper. Outgoing fetch must go through `src/lib/traced-fetch.ts`; Drizzle is auto-instrumented in `src/db/index.ts` via `@kubiks/otel-drizzle`. Cron ticks wrap each tick in `context.with(ROOT_CONTEXT, …)` so they don't chain into one giant trace.

See `.claude/rules/observability.md` for the full pattern — when to add manual spans, the CORS allowlist for W3C propagation, cron naming convention, and the verification checklist.

### Env vars

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318  # base URL — SDK appends /v1/traces and /v1/logs
OTEL_SERVICE_NAME=argo-api                         # service.name resource attribute
OTEL_SERVICE_VERSION=                              # optional; falls back to package.json version (resource: first 7 chars)
OTEL_HOST_NAME=                                    # optional; host.name (the mini's plist sets `mini`, dev leaves it unset)
```

Resource attributes (`telemetry.ts` `resourceAttributes`, contract vps `docs/observability.md`): `service.namespace=argo`, `deployment.environment.name` = `prod` when `NODE_ENV=production` else `dev`. The old `deployment.environment` key is no longer sent.

Logs: the registry expects argo-api logs, so the cron jobs' run lines (start, done, failures) go through `log.*` from `telemetry.ts`, inside the tick's span (a TraceId on each run line; vps `make telemetry-lint` holds `untraced-logs` to 5 % for argo-api). Boot-time lines (cron registered, `api running`) stay on `console` because no span is active at boot.

All env vars are validated at startup via Zod in `src/env.ts`. Missing required vars cause a fail-fast error on boot.

## Native runtime (mini)

One Bun process on `127.0.0.1:7737` behind a path-agnostic reverse proxy (tailscale serve / Caddy). Env: `HOST` (listen address; unset it is `127.0.0.1` when `DASHBOARD_DIR` is set and `0.0.0.0` otherwise, an explicit value wins), `DASHBOARD_DIR` (built SPA directory; empty = feature off, API at the root as on Docker), `CRONS_ENABLED` (`true`/`false` strings only, default `true`; `false` skips `registerCronJobs()`, `uptimeKumaClient.start()` stays on). Crons are off on the mini until the cutover wave. Outgoing OTLP auth needs no code: the exporters read `OTEL_EXPORTER_OTLP_HEADERS` themselves (`authorization=<ingestion key>`; pinned by `src/otlp-headers.test.ts`); unset on Docker.

With `DASHBOARD_DIR` set, `index.ts` serves through `Bun.serve` with `createDashboardHandler` (`src/serve-dashboard.ts`) instead of `app.listen`; same `idleTimeout` 255 and 8 MB body cap. `app` / `App` stay unchanged. The handler does what nginx + Traefik did:

- `/api` and `/api/*` go to `app.handle` with the prefix stripped (`/api/health` is `/health`; routing, auth and tracing see the stripped path). The API's own 404s stay 404s, never the SPA. Paths outside `/api` are not API routes (root `/health` is the SPA fallback).
- `POST /v1/traces` and `POST /v1/logs` are relayed to `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/…` (method, body, `content-type`, `content-encoding`; the upstream credential is the process's own `OTEL_EXPORTER_OTLP_HEADERS`, a client `authorization` is dropped, never forwarded); upstream status returned (null-body statuses 204/205/304 passed through bodiless), 502 on network failure or upstream timeout, 408 when the client's body read outruns the deadline (one 10 s deadline covers body read and upstream call), no retry; body capped at 2 MB (413, checked on `content-length` and while reading); a failure logs one stderr line per path per minute (error class only). Other methods and `/v1/*` GETs are 404.
- GET/HEAD for a file under `DASHBOARD_DIR`: `/assets/*` is `public, max-age=31536000, immutable`; `index.html`, `sw.js`, `registerSW.js`, `site.webmanifest`, `workbox-*.js` are `no-cache`; the rest `public, max-age=3600`. Any other extension-less GET/HEAD falls back to `index.html` (`no-cache`); a missing file with an extension, and any non-GET/HEAD, is 404.
- Traversal (`..`, encoded `%2e%2e`/`%2f`, absolute paths, NUL, bad escapes) is resolved against the directory and answered 404 when it leaves it. Files are served only when their `realpath` stays inside the real directory, so a symlink pointing out of it is 404.

Tests: `src/serve-dashboard.test.ts` (runs the real `app`, no database), `src/otlp-headers.test.ts`, `src/env.test.ts`.

## Production (the Mac mini)

The API runs as the LaunchAgent `com.jkrumm.argo` on `127.0.0.1:7737`; `make deploy` from the repo root ships `origin/master`
(see the root `AGENTS.md` §Deploy). Nothing runs on the VPS any more.
