---
paths:
  - apps/dashboard/**
---

# Observability (apps/dashboard)

The dashboard uses `@hyperdx/browser` to ship traces, logs, and session replay to **ClickStack** (HyperDX). The SDK monkey-patches `window.fetch` on init and auto-instruments fetch/XHR, console, errors, click, visibility, and session replay (rrweb).

## First-import constraint

`src/main.tsx`'s first line is `import './lib/hyperdx'`. The SDK monkey-patches `window.fetch` at init time — any module loaded before it (Eden Treaty, TanStack Query, anything that captures `fetch` at construction) will hold a reference to the unpatched function and won't be traced.

Never move this import. Never add an earlier import to `main.tsx`. CSS imports are fine (they don't touch fetch).

## Configuration (`src/lib/hyperdx.ts`)

```ts
HyperDX.init({
  apiKey,
  service: 'argo-dashboard',
  url: import.meta.env.VITE_HYPERDX_ENDPOINT || window.location.origin,
  tracePropagationTargets: [
    /argo\.jkrumm\.com\/api\//,
    /argo\.test\/api\//,
    /^https?:\/\/localhost:\d+\/api\//,
  ],
  consoleCapture: true,
  advancedNetworkCapture: false,
  disableReplay: import.meta.env.DEV,
  ignoreUrls: [/\/@vite\//, /\/__vite_ping/, /\.hot-update\./, /\/node_modules\/.vite\//],
  otelResourceAttributes: {
    'deployment.environment': import.meta.env.MODE,
    'app.version': __APP_VERSION__,
  },
})
```

### `url` — must be absolute

The SDK appends `/v1/traces` and `/v1/logs`. **Relative paths silently fail** — the underlying OTLP exporter falls back to HyperDX Cloud (`https://in-otel.hyperdx.io`) when given a relative URL, bypassing your local/self-hosted ClickStack.

`window.location.origin` is the right fallback because the dashboard origin proxies the OTLP paths back to ClickStack (same-origin → no CORS):

| Env  | How `/v1/traces` reaches ClickStack                                               |
| ---- | --------------------------------------------------------------------------------- |
| Dev  | Vite proxy in `vite.config.ts` forwards `/v1/traces` + `/v1/logs` to `:4318`.     |
| Prod | Traefik labels on `argo-dashboard` route those paths to `clickstack-otel@docker`. |

Never set `VITE_HYPERDX_ENDPOINT=/` (relative path → silent cloud fallback). To override, use the absolute origin: `VITE_HYPERDX_ENDPOINT=https://otel.jkrumm.com`.

### `tracePropagationTargets`

The SDK matches these regexes against the **absolute outgoing URL** (origin + path), not the relative URL passed to `fetch`. A miss = no `traceparent` header injected = frontend trace disconnected from backend trace.

When you add a new origin the dashboard talks to, add a regex for it. Test it mentally against the resolved URL string: `https://argo.jkrumm.com/api/workouts`, not `/api/workouts`.

### `ignoreUrls`

Vite dev-server probes (`/@vite/...`, `__vite_ping`, `.hot-update.*`) shouldn't show up as spans or unhandled errors. We already filter HMR errors in `unhandledrejection` capture, but `ignoreUrls` is the per-URL kill switch.

### Resource attributes

- `deployment.environment` = `import.meta.env.MODE` → `development` | `production`.
- `app.version` = `__APP_VERSION__` global injected by Vite via `define` in `vite.config.ts` (sourced from `package.json` `version`, override via `BUILD_VERSION` env at build time).

Filter by `deployment.environment` in HyperDX to separate dev noise from prod data; `app.version` lets you diff regressions across releases.

## Identifying users

Single-user app — `setGlobalAttributes({ userId: 'jkrumm' })` is set once at boot in `hyperdx.ts`. The exported `identifyUser({ id, email?, name? })` helper exists for multi-user evolutions.

## Capturing domain events

Use `HyperDX.addAction(name, payload?)` for meaningful UX events (workout logged, page-level errors, dashboard mode switches). They show up as structured log records alongside traces:

```ts
import { HyperDX } from './lib/hyperdx'

HyperDX.addAction('strength.workout.logged', { exercise, weight, reps })
```

Don't fire `addAction` from render or effect cleanup — only from event handlers / mutation `onSuccess` / explicit user actions.

## What NOT to do

- ❌ Move `import './lib/hyperdx'` away from being the first import in `main.tsx`.
- ❌ Use `VITE_HYPERDX_ENDPOINT=/` or any relative path. Always absolute, or unset (→ window.location.origin).
- ❌ Write `tracePropagationTargets: ['/api']` — substring match against the absolute URL works by accident, but a regex matching the origin is what we mean.
- ❌ Set `advancedNetworkCapture: true` in prod for any view that fetches large payloads (it captures full headers + bodies; bandwidth heavy).
- ❌ Enable session replay in dev — HMR causes constant DOM churn and you'll waste rrweb capture on noise.
- ❌ Import `@opentelemetry/api` to wrap things in spans on the client. HyperDX's auto-fetch is enough; manual spans usually double-instrument.

## Verifying locally

1. `cd ~/SourceRoot/vps && make up` — starts ClickStack.
2. `op run --account tkrumm --env-file=apps/dashboard/.env.local.tpl -- printenv VITE_HYPERDX_API_KEY` — confirm the key resolves.
3. `bun dev` — dashboard on `https://argo.test`.
4. Open DevTools → Network → filter `v1/traces`. Click around. Expect POST to `https://argo.test/v1/traces` returning 200.
5. `https://hyperdx.test` → Services → `argo-dashboard`. Click a recent trace. Expect a single trace spanning browser (`argo-dashboard`) → API (`argo-api`) → DB span(s). If trace IDs differ between dashboard and API, the W3C propagation chain is broken — check API CORS `allowedHeaders` and dashboard `tracePropagationTargets` regex.
