# Group 10: OTel + HyperDX observability (backend + frontend)

## What You're Doing

Wire end-to-end distributed tracing into the existing ClickStack / HyperDX deployment. Backend traces every non-`/health` request via `@elysiajs/opentelemetry`. Frontend ships traces + console + network capture to HyperDX via `@hyperdx/browser`. A single trace spans browser → api on a representative dashboard request.

OTLP endpoint is `http://127.0.0.1:4318` locally; same in production over the docker network DNS. Dev uses a Vite proxy so the browser hits same-origin and avoids CORS.

---

## Required Reading

1. **The PRD section** for this group: `docs/MANTINE-MIGRATION-PRD.md` lines 727-760 (Group 7).
2. The **OTel + HyperDX observability** subsection in the PRD's Architecture block.
3. **basalt-ui-playground reference files** (read them before writing your own — they are the template):
   - `basalt-ui-playground/apps/api/src/telemetry.ts` (lines 1–17)
   - `basalt-ui-playground/apps/api/src/app.ts` (lines 38–44 for plugin wiring, 94–112 for onError span enrichment)
   - `basalt-ui-playground/apps/web/src/lib/hyperdx.ts` (lines 1–37)
   - `basalt-ui-playground/apps/web/vite.config.ts` (lines 16–24 for the OTLP proxy)
   - `basalt-ui-playground/apps/api/src/env.ts` for the Zod env pattern
4. `@elysiajs/opentelemetry` docs: https://elysiajs.com/plugins/opentelemetry.html
5. `@hyperdx/browser` docs / npm: https://www.npmjs.com/package/@hyperdx/browser

---

## What to Implement

### Backend (`apps/api`)

#### 1. `apps/api/src/env.ts` — Zod-validated env

```ts
import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  API_SECRET: z.string().min(1),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().default('http://127.0.0.1:4318'),
  OTEL_SERVICE_NAME: z.string().default('argo-api'),
  OTEL_SERVICE_VERSION: z.string().default('0.0.0'),
  // …any other vars currently read via process.env.X
});

export const env = Env.parse(process.env);
```

Migrate every `process.env.X` lookup in `apps/api/src/**` to read from `env.X`. The only legitimate raw `process.env` access remaining is inside `env.ts` itself.

#### 2. `apps/api/src/telemetry.ts`

```ts
import { trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { env } from './env';

const exporter = new OTLPTraceExporter({
  url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
});

export const telemetryConfig = {
  serviceName: env.OTEL_SERVICE_NAME,
  spanProcessors: [new BatchSpanProcessor(exporter)],
};

export const tracer = trace.getTracer(env.OTEL_SERVICE_NAME, env.OTEL_SERVICE_VERSION);
```

Mirror basalt-ui-playground's exact dep set — `@opentelemetry/api`, `@opentelemetry/exporter-trace-otlp-proto`, `@opentelemetry/sdk-trace-base`.

#### 3. Wire `@elysiajs/opentelemetry` in `apps/api/src/index.ts`

Add the plugin early in the chain, **before route registrations**:

```ts
import { opentelemetry } from '@elysiajs/opentelemetry';
import { telemetryConfig } from './telemetry';

app.use(opentelemetry(telemetryConfig));
```

Filter `/health` out of span names (the plugin docs show the filter hook).

#### 4. Global `onError` span enrichment

The plugin records inbound spans but does **not** auto-attach exceptions on `onError`. Add:

```ts
import { trace, SpanStatusCode } from '@opentelemetry/api';

app.onError(({ error }) => {
  const span = trace.getActiveSpan();
  if (span) {
    span.recordException(error as Error);
    span.setStatus({ code: SpanStatusCode.ERROR });
  }
  // … existing error response handling
});
```

#### 5. Outbound `clients/*` fetch wrapping — defer

If `apps/api/src/clients/*` makes outbound HTTP calls (Garmin, etc.), do **not** rewrite them to `tracedFetch` in this group. Note them in `RALPH_NOTES.md` as a follow-up TODO. Inbound spans are sufficient for this milestone.

### Frontend (`apps/dashboard`)

#### 6. Add `@hyperdx/browser` dep

```bash
bun add --cwd apps/dashboard @hyperdx/browser
```

#### 7. `apps/dashboard/src/lib/hyperdx.ts`

Replace the Group 3 placeholder with:

```ts
import HyperDX from '@hyperdx/browser';

const endpoint = import.meta.env.VITE_HYPERDX_ENDPOINT ?? '/';
const apiKey   = import.meta.env.VITE_HYPERDX_API_KEY;
const service  = import.meta.env.VITE_HYPERDX_SERVICE_NAME ?? 'argo-dashboard';

if (apiKey) {
  HyperDX.init({
    apiKey,
    service,
    url: endpoint,
    tracePropagationTargets: [/\/api\//],
    consoleCapture: true,
    advancedNetworkCapture: true,
  });
}

export { HyperDX };
```

Match basalt-ui-playground's `apps/web/src/lib/hyperdx.ts` for the exact init shape — verify any field changes in the current SDK via `/research` before committing.

#### 8. `main.tsx` import order

```ts
import './lib/hyperdx';            // MUST be the literal first line — patches fetch
import '@mantine/core/styles.css';
// …rest
```

Document in `apps/dashboard/.claude/rules/observability.md`:

```
# Observability

`apps/dashboard/src/main.tsx`'s first line is `import './lib/hyperdx'`. The
HyperDX browser SDK monkey-patches `fetch` on init — if any module imports
that uses `fetch` (Eden Treaty, TanStack Query) loads before HyperDX, its
network calls do not get traced.

The OTLP endpoint is reached via Vite proxy (`/v1/traces`, `/v1/logs` → `127.0.0.1:4318`)
in dev. Production passes `VITE_HYPERDX_ENDPOINT` + `VITE_HYPERDX_API_KEY` at build
time via Docker `--build-arg`.
```

#### 9. `apps/dashboard/vite.config.ts` proxy

```ts
server: {
  port: 5173,
  strictPort: true,
  proxy: {
    '/v1/traces': { target: 'http://127.0.0.1:4318', changeOrigin: true },
    '/v1/logs':   { target: 'http://127.0.0.1:4318', changeOrigin: true },
    '/api':       { target: 'http://localhost:3000', rewrite: (p) => p.replace(/^\/api/, '') },
  },
},
```

#### 10. Env vars + Dockerfile

`apps/dashboard/.env.local.tpl`:
```
VITE_API_URL=http://localhost:3000
VITE_HYPERDX_ENDPOINT=/
VITE_HYPERDX_API_KEY=<see 1Password>
VITE_HYPERDX_SERVICE_NAME=argo-dashboard
```

`apps/dashboard/Dockerfile` accepts `VITE_HYPERDX_ENDPOINT` + `VITE_HYPERDX_API_KEY` as `ARG`s in the build stage, passes them as `ENV` so Vite picks them up at build time.

#### 11. `apps/dashboard/CLAUDE.md` — dev story

Append a short section explaining: run ClickStack locally on `:4318`, then `bun --cwd apps/dashboard dev`. Same-origin proxy means no CORS dance.

### Cross-boundary verification

After everything is wired:
1. Start ClickStack/HyperDX locally on `:4318`.
2. Start the api and the dashboard.
3. Hit any cheap endpoint from the dashboard (e.g. `/exercises`).
4. Open HyperDX. Confirm the trace shows `browser → /api/exercises (server span) → drizzle query`. The `traceparent` header should be visible on the request.

---

## Validation

```bash
bun install
bun --cwd apps/api typecheck
bun --cwd apps/dashboard typecheck
bun --cwd apps/dashboard build
bun run lint
bun run format:check

# Confirm no raw process.env outside env.ts:
grep -rE "process\.env\." apps/api/src/ | grep -v 'src/env.ts'   # must be empty

# Manual: cross-boundary trace (see Cross-boundary verification above)
```

Confirm `/health` requests do **not** produce spans.

---

## Commit

```
feat(api): add zod-validated env + opentelemetry tracing
feat(dashboard): wire hyperdx browser sdk + otlp proxy
docs(dashboard): document hyperdx first-import rule
```

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then output as the literal last line:

```
RALPH_TASK_COMPLETE: Group 10
```
