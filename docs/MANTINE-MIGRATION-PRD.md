# PRD: Argo Dashboard — Mantine v9 + TanStack Migration

> Greenfield rebuild of `packages/dashboard` as `apps/dashboard`. Vite + React 19 + Mantine v9 + TanStack Router (file-based) + TanStack Query + Eden Treaty. Retires Refine v5, Ant Design v5, and `react-router`. Keeps visx (extracted to `@argo/charts`). Migrates the API database from SQLite to Postgres (drizzle-kit migrations, dedicated `argo` Postgres schema via `pgSchema()`). Wires end-to-end OTel observability into the existing ClickStack/HyperDX deployment. Then cutover and prune.

## Problem

The dashboard runs Refine v5 + Ant Design v5 + a custom Eden Treaty data provider + `react-router` v7. Refine adds a CRUD-router-resource abstraction layer that is not earning its weight for a two-page Tailscale-only homelab dashboard. AntD is hard-pinned to v5 (Refine breaks on v6) and lacks first-class React 19 support (requires `@ant-design/v5-patch-for-react-19`). Existing visx infrastructure (`src/charts/{primitives,kinds,sparklines,hooks,tokens}`) is solid and worth keeping; the layer on top of it isn't. Claude Code patterns are documented in `packages/dashboard/CLAUDE.md` but Refine quirks (e.g. `useList` returning `{ result, query }`, v5 pagination `currentPage`) are agent-hostile.

## Goals

- **Migrate the API database from SQLite to Postgres** (on the VPS, same host as argo). All tables live in a dedicated `argo` Postgres schema declared via Drizzle's `pgSchema("argo")` (matches `basalt-ui-playground` pattern). Adopt drizzle-kit generate + migrate (explicit CLI step) for version-controlled schema evolution. One-shot script copies existing SQLite data into Postgres during cutover. Local dev runs its own Postgres container.
- **Wire end-to-end OTel observability** into the existing ClickStack/HyperDX deployment (`127.0.0.1:4318` locally, same address on the VPS docker network). Backend via `@elysiajs/opentelemetry` + a `telemetry.ts` module. Frontend via `@hyperdx/browser` initialized as the first import in `main.tsx`. Vite proxies OTLP for same-origin (no CORS). Distributed traces span browser → api on every dashboard interaction.
- Move to `apps/api` + `apps/dashboard` workspaces, with shared libs under `packages/*`. Extract the visx layer to `packages/charts` from day one (it already behaves like a library).
- Greenfield rewrite of the dashboard on **Vite + React 19 + Mantine v9 + TanStack Router (file-based) + TanStack Query + Eden Treaty + Zustand (minimal)**.
- Forms via `@mantine/form`; notifications, modals, dates, hooks via Mantine sub-packages.
- Keep **visx** infrastructure; rewire `useVxTheme` to Mantine's `useMantineColorScheme`.
- Light API cleanup: drop Refine-style `_start/_end/_sort/_order` + `x-total-count` in favor of a simple `?page=&limit=` convention and total in body; tag and document every Elysia route for a curated OpenAPI spec (Scalar).
- Strong Claude Code guardrails: project-scoped `.claude/rules/` for Mantine, TanStack Router, TanStack Query, forms, state, OpenAPI; oxlint overrides that enforce these via `no-restricted-imports` where expressible.
- **fallow** + lint + format + typecheck wired into a GitHub Actions `check.yml` running on `pull_request` and `push: master`. Fallow runs **report-only / non-blocking** initially — findings inform follow-up optimization work, they don't gate this migration.
- Cutover criterion: both existing pages at feature + visual parity (validated against the **live production deploy**, not a local legacy instance) in dark/light + mobile, all checks green; then swap Dockerfile path in `deploy.yml`, delete `packages/dashboard`, prune Refine / AntD / `react-router` / unused deps.

## Non-Goals

- **No SSR / TanStack Start.** Static SPA behind Traefik/nginx, as today.
- **No Tailwind.** Mantine-only for styling and layout.
- **No new dashboard pages.** Existing two pages (`garmin-health`, `strength-tracker` with the body-weight tab) only. Docker / Monitoring / Tasks remain placeholders.
- **No automated visual regression tests** (Playwright/screenshot diff).
- **No local side-by-side run of the legacy dashboard.** Visual diff is done against `https://argo.jkrumm.com` (live). Legacy code stays committed until cutover for reference; it does not need a dev server.
- **No API revamp** beyond the light cleanup above, the Postgres migration, and the new `/summary` endpoints. Domain logic, cron jobs, and external clients are unchanged.
- **No auth changes.** Bearer token + Tailscale-only stays as-is.
- **No replacement of oxlint with `@antfu/eslint-config`.** Stay oxlint + oxfmt; extend with plugins (`react`, `react-perf`, `typescript`, `import`, `unicorn`, `jsx-a11y`, `promise`, `oxc`, `jsdoc`, `n`) and project-specific `no-restricted-imports` rules.

## Stack Decisions

| Concern         | Choice                                         | Notes                                                                                                                       |
|-|-|-|
| Build           | Vite 5+                                        | `--strictPort` 5173                                                                                                         |
| Framework       | React 19                                       | Mantine v9 supports natively, no patch import                                                                               |
| UI              | Mantine v9                                     | `@mantine/core` + `@mantine/form` + `@mantine/notifications` + `@mantine/modals` + `@mantine/dates` + `@mantine/hooks`      |
| Charts package  | `packages/charts` (`@argo/charts`)             | visx primitives/kinds/sparklines/hooks/tokens extracted as a theme-agnostic package. Exposes `VxThemeProvider`/`useVxTheme`. |
| Charts bridge   | `apps/dashboard/src/charts-bridge.tsx`         | One-line wrapper that reads `useMantineColorScheme()` and passes `colorScheme` to `VxThemeProvider`. Only place Mantine touches visx. |
| Routing         | TanStack Router, file-based                    | `src/routes/__root.tsx`, `src/routes/<page>.tsx`; `@tanstack/router-plugin/vite` generates `routeTree.gen.ts`                |
| Server state    | TanStack Query                                 | Coordinated with router loaders via `ensureQueryData`; QueryClient passed through router context                            |
| API client      | Eden Treaty                                    | `treaty<App>(API_URL, { parseDate: false })`; imports `App` type from `apps/api`                                            |
| Client state    | Zustand (minimal, `persist` middleware)        | Theme, sidebar collapsed, last-selected filters — and nothing else. Enforced via CLAUDE.md + `.claude/rules/state.md`.        |
| Forms           | `@mantine/form`                                | Zod-resolved validation; dynamic-set list uses `form.insertListItem` / `form.removeListItem`                                |
| Lint / Format   | oxlint + oxfmt                                 | Plugins listed above; project-specific `no-restricted-imports` to ban legacy deps and enforce barrel patterns               |
| Schema lib (E2E) | **Zod** (single library, end-to-end)          | Elysia routes use Zod via Standard Schema (Elysia 1.4+). Frontend uses Zod for forms (`@mantine/form` `zodResolver`), search params (`zodValidator`), and env. `apps/api/src/env.ts` parses `process.env` with Zod. **Constraints:** use `z.enum([...])` for literal unions (not `z.union([z.literal()...])`); keep dates as ISO strings in responses (no `z.date()` / `z.transform()`); no branded types / `z.custom()` / `z.void()` (open issues in `@elysiajs/openapi` serialization). |
| OpenAPI         | `@elysiajs/openapi` (Scalar)                    | **Swap from `@elysiajs/swagger` to `@elysiajs/openapi`** (the newer plugin) to get Zod→JSON Schema serialization. Configure `mapJsonSchema: { zod: z.toJSONSchema }`. Every route adds `detail: { summary, description, tags, examples? }`; agents consume `/openapi.json`. |
| Date lib (FE)   | `date-fns`                                     | Tree-shakeable, idiomatic React. Used by `@mantine/dates` and any custom formatting. **No date lib on the backend** — ISO strings + Postgres `timestamp with time zone` / `text` columns; Drizzle returns the right types; Eden Treaty's `parseDate: false` preserves strings to the frontend. |
| Static analysis | fallow                                         | CI step (dead code, duplication, complexity). Report-only initially.                                                        |
| Database        | Postgres (VPS, same host)                      | `drizzle-orm/postgres-js` driver. Schema lives in a dedicated `argo` Postgres schema (already provisioned by user).         |
| Schema isolation | `pgSchema("argo")` in code                    | All tables defined via `dbSchema.table(...)`. Drizzle auto-emits `CREATE SCHEMA IF NOT EXISTS "argo"` in the generated migration. Connection string carries **no** `?schema=` / `search_path` param (postgres.js doesn't grok it; strip if present). Pattern from `basalt-ui-playground/apps/api/src/schema/auth-schema.ts:1-3`. |
| Migrations      | drizzle-kit generate + migrate                 | Files under `apps/api/drizzle/`. Applied via **explicit CLI step** (`bun --cwd apps/api db:migrate`) — not on api boot. Run on the VPS as part of deploy / cutover. Matches basalt-ui-playground pattern. |
| Dev DB          | Postgres in `apps/api/docker-compose.dev.yml`  | Throwaway local instance on a fixed port. `op run` injects dev credentials. Seeded via the same migrations.                  |
| Observability   | OTel → HyperDX / ClickStack                    | Backend: `@elysiajs/opentelemetry` + `apps/api/src/telemetry.ts` (OTLP exporter, service name/version, tracer export). Frontend: `@hyperdx/browser` initialized as the **first import** in `main.tsx`. Vite proxies `/v1/traces` + `/v1/logs` to `127.0.0.1:4318` (same-origin, no CORS). |
| Env validation  | Zod at module scope                            | `apps/api/src/env.ts` parses `process.env` with Zod, exports typed `env`. Boot fails fast on missing/malformed vars. Mirror pattern in `apps/dashboard/src/lib/env.ts` for `import.meta.env`. |
| TypeScript      | `tsconfig.base.json` at repo root              | Max strictness: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `isolatedModules`, `exactOptionalPropertyTypes`, `module: "ESNext"`, `moduleResolution: "bundler"`, `target: "ES2022"`. Each app/package extends. |
| Testing         | Bun test (unit + summary endpoints)            | Test files colocated as `*.test.ts`. Coverage target: 1RM formulas (Epley/Brzycki), summary aggregations (rolling averages, PR detection, trend logic), env parsing. No component tests in this PRD. Runs via `bun --cwd apps/api test` in `check.yml`. |
| React Compiler  | `babel-plugin-react-compiler` via Rolldown     | Enabled in `apps/dashboard/vite.config.ts` (basalt's pattern: a separate `babel()` pass alongside `viteReact()`). Auto-memoizes; manual `useMemo`/`useCallback` become exceptional. |
| Pre-commit      | Lefthook                                       | `lefthook.yml` at repo root. Staged-files only: oxlint on `*.ts(x)`, oxfmt `--check` on tracked. Installed via `bun lefthook install` once per clone. |

## Architecture

### Final workspace layout

```
argo/
├── apps/
│   ├── api/                          # was packages/api/ (rename in Group 1)
│   │   ├── src/
│   │   │   ├── db/                   # Postgres + drizzle-pg
│   │   │   │   ├── index.ts          # pool, drizzle(), migrate() on boot
│   │   │   │   └── schema.ts         # pgTable definitions
│   │   │   ├── routes/               # unchanged + new summary endpoints
│   │   │   └── …
│   │   ├── drizzle/                  # generated migration files
│   │   │   └── 0000_init.sql
│   │   ├── scripts/
│   │   │   └── migrate-sqlite-to-pg.ts
│   │   ├── docker-compose.dev.yml    # local Postgres container (dev only)
│   │   └── Dockerfile
│   └── dashboard/                    # new
│       ├── src/
│       │   ├── main.tsx              # Mantine + Router + QueryClientProvider + VxBridge
│       │   ├── charts-bridge.tsx     # Mantine ↔ @argo/charts theme wiring (only file that imports both)
│       │   ├── routes/               # file-based
│       │   │   ├── __root.tsx        # layout shell, sidebar
│       │   │   ├── index.tsx         # redirect → /garmin-health
│       │   │   ├── garmin-health.tsx
│       │   │   └── strength-tracker.tsx
│       │   ├── routeTree.gen.ts      # generated, gitignored
│       │   ├── components/           # app-specific UI; chart primitives live in @argo/charts
│       │   ├── lib/
│       │   │   ├── eden.ts           # treaty client
│       │   │   ├── query-client.ts   # QueryClient config
│       │   │   ├── store.ts          # Zustand UI store (persisted)
│       │   │   └── queries/          # query-key factories, one file per resource
│       │   └── styles/
│       │       └── theme.ts          # Mantine theme (light + dark)
│       ├── .claude/rules/            # mantine.md, tanstack-router.md, tanstack-query.md, forms.md, state.md, openapi.md
│       ├── CLAUDE.md                 # patterns + "how to add a page" walkthrough
│       ├── Dockerfile                # multi-stage bun build → nginx:alpine
│       ├── nginx.conf
│       ├── vite.config.ts
│       └── package.json
├── packages/
│   └── charts/                       # @argo/charts — theme-agnostic visx library
│       ├── src/
│       │   ├── primitives/           # ChartCard, ChartLegend, ChartTooltip, Axis*, HoverOverlay
│       │   ├── kinds/                # reusable shapes
│       │   ├── sparklines/           # tiny inline charts (exempt from primitive contract)
│       │   ├── hooks/                # useChartTooltip, useHoverSync
│       │   ├── tokens.ts             # VX semantic palette + per-metric series colors
│       │   ├── theme.tsx             # VxThemeProvider + useVxTheme (no Mantine import)
│       │   ├── hover-context.ts
│       │   └── index.ts              # barrel
│       ├── package.json              # peerDeps: react, @visx/*
│       └── tsconfig.json
├── .github/workflows/
│   ├── deploy.yml                    # path updated: apps/{api,dashboard}/Dockerfile
│   └── check.yml                     # NEW: lint + format:check + typecheck + fallow
├── .oxlintrc.json                    # extended plugins + bans
├── .oxfmtrc.json                     # unchanged
└── package.json                      # workspaces: ["apps/*", "packages/*"]
```

### Provider tree (root)

```tsx
<MantineProvider theme={theme} defaultColorScheme="dark">
  <VxBridge>
    <ModalsProvider>
      <Notifications />
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} context={{ queryClient }} />
      </QueryClientProvider>
    </ModalsProvider>
  </VxBridge>
</MantineProvider>
```

`VxBridge` (`apps/dashboard/src/charts-bridge.tsx`) is the **only** file in the codebase that imports from both `@mantine/core` and `@argo/charts`:

```tsx
import { useMantineColorScheme } from '@mantine/core'
import { VxThemeProvider } from '@argo/charts'

export function VxBridge({ children }: { children: React.ReactNode }) {
  const { colorScheme } = useMantineColorScheme()
  return <VxThemeProvider colorScheme={colorScheme}>{children}</VxThemeProvider>
}
```

### Data flow per page

1. Route `loader` calls `context.queryClient.ensureQueryData(qk.foo(params))` for critical data.
2. Component calls `useSuspenseQuery(qk.foo(params))` — reads from cache.
3. Mutations via `useMutation` + targeted `queryClient.invalidateQueries({ queryKey: qk.foo._def })` on success.
4. URL state (filters, date range) lives in TanStack Router search params with `validateSearch` (Zod).
5. Cross-page UI state (theme, sidebar) in Zustand `persist` store.

### `@argo/charts` boundary rules

- The package is **theme-agnostic**: it must not import from `@mantine/*`, `apps/dashboard`, or any consumer-specific code. Theme info enters only through `VxThemeProvider`'s `colorScheme` prop.
- The package owns its own `VX` tokens, semantic palette, and series colors. Consumers cannot extend the palette inline — new metrics or themes go into `packages/charts/src/tokens.ts` via a PR to the package.
- `useVxTheme()` reads from `VxThemeContext`, not from any consumer state. No upward imports.
- `peerDependencies`: `react`, `react-dom`, the `@visx/*` set we use today. Mantine is **not** a peer.
- An oxlint override on `packages/charts/src/**` bans imports from `@mantine/*` and `apps/**` (via `no-restricted-imports`).

### Postgres migration

**Server side (VPS) — already provisioned:**
- Database `argo`, schema `argo`, role `argo` exist on the VPS Postgres.
- Password lives at **`op://vps/argo/DB_PASSWORD`** (tkrumm account).
- Connection from argo-api: `DATABASE_URL=postgres://argo:<pw>@<host>:5432/argo?search_path=argo`. In compose, `<host>` is the Postgres service name on the Docker network; locally it's `127.0.0.1:5433` against the dev container.
- The migration agent does **not** run `CREATE DATABASE`/`CREATE ROLE`/`GRANT` statements — the instance is ready.

**Driver swap:**
- Remove `bun:sqlite`, `drizzle-orm/bun-sqlite`.
- Add `postgres` (postgres.js) + `drizzle-orm/postgres-js`.
- `apps/api/src/db/index.ts` becomes a connection pool + `drizzle(client, { schema })`.
- Run `migrate(db, { migrationsFolder: './drizzle' })` once on api startup, before routes mount. Fail-fast if migrations fail.

**Schema port (drizzle), with dedicated `argo` Postgres schema:**

```ts
// apps/api/src/db/schema.ts
import { pgSchema } from 'drizzle-orm/pg-core'

export const argoSchema = pgSchema('argo')

export const dailyMetrics = argoSchema.table('daily_metrics', { … })
export const workouts     = argoSchema.table('workouts', { … })
// etc.
```

Drizzle generates `CREATE SCHEMA IF NOT EXISTS "argo";` as the first statement of `0000_init.sql`, then qualifies every table/FK with the schema name. No need to set `search_path` in the connection string.

Type and idiom mapping:
- `sqliteTable` → `argoSchema.table` (PG).
- `text` (SQLite) → `text` (PG); `integer` → `integer`; `real` → `doublePrecision` (or `numeric(p,s)` for kg / weight precision if we want it).
- Integer-as-boolean (`is_bodyweight`, `completed`, `refresh_requested`, `in_progress`) → real `boolean`.
- `TEXT` `date` columns the dashboard already treats as strings → keep as `text` (avoids behaviour change; `parseDate: false` in Eden Treaty stays). `created_at`/`updated_at`/`synced_at` → `timestamp with time zone` defaulting to `now()`.
- `INSERT OR IGNORE` → `ON CONFLICT … DO NOTHING`. `INSERT OR REPLACE` → `ON CONFLICT … DO UPDATE SET …`.
- `AUTOINCREMENT` → `integer GENERATED ALWAYS AS IDENTITY` (preferred) or `serial`.
- Drop `PRAGMA foreign_keys = ON`; PG enforces by default. Keep `ON DELETE CASCADE` on `workout_sets.workout_id`.
- Re-add explicit indexes that were implicit in SQLite where needed.

**Connection string hygiene:**
- `DATABASE_URL=postgres://argo:<pw>@<host>:5432/argo` — **no** `?schema=` or `?search_path=` param. postgres.js doesn't recognise the Prisma-style param and the schema is enforced by `pgSchema()` in code.
- If a `DATABASE_URL` arrives with `?schema=` (legacy / mistake), `apps/api/src/db/index.ts` strips it before passing to `postgres()`. Pattern from `basalt-ui-playground/apps/api/src/db.ts:8-9`.

**Migrations folder:**
- `apps/api/drizzle/0000_init.sql` generated from the new schema. Future schema changes via `drizzle-kit generate` produce numbered files.
- Migrations are applied via **explicit CLI step**: `bun --cwd apps/api db:migrate`. This is what runs during deploy (Group 11) and as part of the dev container bootstrap. **Not** applied at api boot — a separate command keeps the boot path side-effect-free, lets us run migrations once per deploy, and matches `basalt-ui-playground`.
- Add to `apps/api/package.json`:
  - `"db:generate": "drizzle-kit generate"`
  - `"db:migrate": "bun run src/scripts/migrate.ts"` (small Bun script that imports drizzle's `migrate()` and applies once, then exits)
  - `"db:push": "drizzle-kit push"` for local rapid iteration

**Data migration script (one-shot):**
- `apps/api/scripts/migrate-sqlite-to-pg.ts` reads the existing `homelab.db` (mount in via env var) and inserts rows into Postgres via the same Drizzle schema. Tables in order: `exercises`, `user_profile`, `sync_control`, `daily_metrics`, `garmin_activities`, `workouts`, `workout_sets`, `weight_log`. Idempotent — re-runs are safe (uses `ON CONFLICT DO NOTHING` on natural keys; `id` columns inserted via `OVERRIDING SYSTEM VALUE` then sequences are reset to `max(id)+1` per table at end).
- Run during cutover (Group 11), before deploy switches over.

**Local dev:**
- `apps/api/docker-compose.dev.yml` runs a Postgres container on a fixed port (e.g. `5433` to avoid colliding with any host-installed instance). Volume mount for persistence between sessions.
- `apps/api/.env.local.tpl` includes `DATABASE_URL`. Dev runs via `op run --account tkrumm --env-file=.env.local.tpl -- bun --cwd apps/api start`.

### Observability: OTel → HyperDX / ClickStack

ClickStack runs locally on `127.0.0.1:4318` (OTLP HTTP) and on the VPS at the same address inside the docker network. Goal: every backend request emits a trace; every frontend page load + fetch + console error ships to HyperDX; spans propagate cleanly across the Eden Treaty boundary.

**Backend (`apps/api`):**

`apps/api/src/telemetry.ts` (new) — exporter + tracer module, copied conceptually from `basalt-ui-playground/apps/api/src/telemetry.ts:1-17`:

```ts
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { trace } from '@opentelemetry/api'
import { env } from './env.js'

export const traceExporter = new OTLPTraceExporter({
  url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
})
export const telemetryConfig = {
  serviceName: env.OTEL_SERVICE_NAME,
  traceExporter,
}
export const tracer = trace.getTracer(env.OTEL_SERVICE_NAME)
```

Wire `@elysiajs/opentelemetry` into `apps/api/src/index.ts`:

- `.use(opentelemetry(telemetryConfig))` early in the chain (before routes).
- Span-name filter to suppress `/health` noise.
- Manual `span.recordException(error)` + `span.setStatus({ code: SpanStatusCode.ERROR })` in the global `onError` hook (the plugin does not auto-record exceptions).

For outbound HTTP (the many `apps/api/src/clients/*` calls: Garmin, Slack, Gmail, weather, etc.), add a small `apps/api/src/lib/traced-fetch.ts` wrapper (pattern from basalt) that creates a CLIENT span per call and injects W3C trace-context headers via `propagation.inject()`. Migrate the existing clients one at a time as a follow-up — not blocking this PRD.

**Frontend (`apps/dashboard`):**

`apps/dashboard/src/lib/hyperdx.ts` (new):

```ts
import HyperDX from '@hyperdx/browser'

HyperDX.init({
  apiKey: import.meta.env.VITE_HYPERDX_API_KEY,
  service: import.meta.env.VITE_HYPERDX_SERVICE_NAME ?? 'argo-dashboard',
  url: import.meta.env.VITE_HYPERDX_ENDPOINT || window.location.origin,
  tracePropagationTargets: [/\/api\//],
  consoleCapture: true,
  advancedNetworkCapture: true,
})
```

**Critical:** this module must be imported **before** any other module in `apps/dashboard/src/main.tsx` — the HyperDX SDK monkey-patches `fetch`, and Eden Treaty's fetch must be wrapped at construction time. Lint rule: `apps/dashboard/.claude/rules/observability.md` documents the import-order constraint.

**Vite same-origin proxy** in `apps/dashboard/vite.config.ts`:

```ts
server: {
  port: 5173,
  strictPort: true,
  proxy: {
    '/v1/traces': { target: 'http://127.0.0.1:4318', changeOrigin: true },
    '/v1/logs':   { target: 'http://127.0.0.1:4318', changeOrigin: true },
  },
}
```

This keeps the browser SDK same-origin, avoiding CORS on ClickStack. Production: HyperDX endpoint is set explicitly via `VITE_HYPERDX_ENDPOINT` at build time (passed in `apps/dashboard/Dockerfile` via `--build-arg`).

**Trace propagation across Eden Treaty:**
- Browser side: HyperDX's fetch patch automatically injects W3C trace-context headers for any URL matching `tracePropagationTargets`. No code changes in `apps/dashboard/src/lib/eden.ts` required.
- Server side: Elysia's OTel plugin reads the incoming traceparent header and continues the trace.
- Result: a single distributed trace per user action, spanning `browser → vite proxy → api → outbound HTTP (once tracedFetch is adopted)`.

**Env vars:**

| Var | Where | Default | Notes |
|-|-|-|-|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | api | `http://127.0.0.1:4318` (dev), `http://clickstack:4318` (prod) | OTLP HTTP base URL — exporter appends `/v1/traces` |
| `OTEL_SERVICE_NAME` | api | `argo-api` | |
| `OTEL_SERVICE_VERSION` | api | from `package.json` | |
| `VITE_HYPERDX_API_KEY` | dashboard build | from `op://vps/hyperdx/api-key` | |
| `VITE_HYPERDX_SERVICE_NAME` | dashboard build | `argo-dashboard` | |
| `VITE_HYPERDX_ENDPOINT` | dashboard build | empty (dev: vite proxy), set explicit URL for prod | |

### Schema validation — Zod end-to-end

One schema lib, one mental model. Used in:

- `apps/api/src/env.ts` — boot-time env validation (`z.object({...}).parse(process.env)`).
- `apps/api/src/routes/**` — Elysia `body`, `query`, `params`, `response` validators via Standard Schema (Elysia 1.4+).
- `apps/api/src/db/schema.ts` — optional `drizzle-zod` `createInsertSchema` / `createSelectSchema` for one-line API schema derivation from Drizzle tables.
- `apps/dashboard/src/lib/queries/**` — response parsing on the boundary if needed.
- `apps/dashboard/src/routes/**` — TanStack Router `validateSearch: zodValidator(z.object({...}))`.
- `apps/dashboard/src/components/**` — `@mantine/form`'s `useForm({ validate: zodResolver(schema) })`.

**Conventions (constraints to avoid `@elysiajs/openapi` open issues):**
- Literal unions: `z.enum(['a','b','c'])` — **not** `z.union([z.literal('a'), z.literal('b')])`.
- Dates in responses: ISO `string()` — **not** `z.date()` or `z.transform()`. The dashboard parses with `date-fns` if needed.
- Avoid `z.custom()`, branded types, and `z.void()` in response schemas.
- Empty responses use `z.object({})` or `z.null()`.
- File uploads (if ever added) use Elysia's `fileType()` helper rather than a Zod schema.

**OpenAPI plugin config:**

```ts
import { openapi } from '@elysiajs/openapi'
import { z } from 'zod'

.use(openapi({
  mapJsonSchema: { zod: z.toJSONSchema },
  documentation: { info: { … }, components: { … } },
  provider: 'scalar',
  path: '/docs',
}))
```

### Date handling

- **Frontend:** `date-fns` for any formatting / arithmetic. `@mantine/dates` v9 accepts native `Date` natively — pass `new Date(isoString)` at the boundary.
- **Backend:** ISO strings on the wire. Postgres columns: `timestamp with time zone` for technical timestamps (`created_at`, `synced_at`); `text` for user-meaningful dates the dashboard treats as strings (e.g. `workouts.date`). Drizzle returns the typed value; Eden Treaty's `parseDate: false` preserves strings end-to-end.
- **No date lib in `apps/api`.**

### TypeScript baseline (`tsconfig.base.json`)

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true
  }
}
```

`apps/api/tsconfig.json`, `apps/dashboard/tsconfig.json`, `packages/charts/tsconfig.json` all extend this. Per-package files only set `lib`/`jsx`/`paths`/`types`/`outDir`.

### Testing surface

- **Coverage in this PRD:**
  - `apps/api/src/lib/formulas.test.ts` — Epley, Brzycki, average 1RM, pull-up total load, volume.
  - `apps/api/src/routes/*.summary.test.ts` — one test per `/summary` endpoint asserting trend rules + window math against a seeded Postgres (use the dev container in CI).
  - `apps/api/src/env.test.ts` — happy-path + missing-var failure mode.
- **Excluded from this PRD:** React component tests, E2E, visual regression. Future work.
- **CI:** `check.yml` runs `bun --cwd apps/api test`. Postgres comes up via `services: postgres` in the workflow.

### React Compiler

```ts
// apps/dashboard/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { babel } from 'vite-plugin-babel'

export default defineConfig({
  plugins: [
    react(),
    babel({
      filter: /\.[jt]sx?$/,
      babelConfig: {
        babelrc: false,
        configFile: false,
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
    // … TanStack Router plugin, Mantine, etc.
  ],
})
```

The compiler's defaults handle Mantine + visx + TanStack Router fine. Add `'use no memo'` directives only on exceptional files that the compiler can't analyze.

### Pre-commit (`lefthook.yml`)

```yaml
pre-commit:
  parallel: true
  commands:
    lint:
      glob: "*.{ts,tsx,js,jsx}"
      run: bunx oxlint {staged_files}
    format:
      glob: "*.{ts,tsx,js,jsx,json,md}"
      run: bunx oxfmt --check {staged_files}
```

One-time install: `bun add -D lefthook && bun lefthook install`. Documented in root `README.md` so a fresh clone reproduces.

### Rule & doc voice convention

All files under `**/CLAUDE.md` and `**/.claude/rules/*.md` are written in **descriptive present-tense voice** — they describe how the code currently works, not what is planned. The PRD (this file) is the only document that uses roadmap voice. Examples:

| ✗ Roadmap voice (PRD) | ✓ Rule voice (CLAUDE.md / rules) |
|-|-|
| "We will use Zod for route validators." | "Routes validate `body`/`query`/`params`/`response` with Zod via Standard Schema." |
| "Migrate to file-based routing." | "Routes are file-based under `src/routes/`. Adding a page = adding a file." |
| "Should ship with HyperDX init as first import." | "`apps/dashboard/src/main.tsx` imports `./lib/hyperdx` on its first line. Do not reorder." |

Group 10 establishes the initial rule files during the migration; Group 12 rewrites them in this descriptive voice against the as-built code once cutover lands.

### Deferred decisions (flagged, not blocking)

Implementing agents may add these as small follow-ups without blocking the migration:

- **Standard error response shape** — when a route needs structured errors, return `{ error: string, code?: string, details?: unknown }`. Default if a handler is silent.
- **Source-map upload to HyperDX** — production source maps are kept private; HyperDX backend job uploads them post-build. Not wired in this PRD.
- **Workout form draft autosave** — the gym use case warrants saving in-progress form state to Zustand `persist`. Mention in `apps/dashboard/CLAUDE.md` as a known opportunity.
- **Drizzle Studio** — `db:studio` script added to `apps/api/package.json` for browsing the local Postgres at `:4983`. Dev-only.
- **DB-aware health check** — `/health/ready` performs a `SELECT 1` against Postgres; `/health` stays liveness-only.
- **VITE_ env validation** — mirror `apps/api/src/env.ts` as `apps/dashboard/src/lib/env.ts` parsing `import.meta.env` with Zod at module load.

### Sweet patterns to adopt (from basalt-ui-playground)

- **Env validation with Zod at module scope** (`apps/api/src/env.ts`): `export const env = z.object({...}).parse(process.env)`. Fail-fast on boot if vars missing/malformed. Typed `env.X` everywhere instead of `process.env.X || throw`.
- **`tracedFetch()` wrapper** with W3C propagation header injection — adopt for outbound HTTP (`apps/api/src/clients/*`). Migrate piecemeal in a post-cutover follow-up; not a blocker.
- **`cached()` wrapper** with inflight request deduplication and stale-on-error fallback — useful for the Garmin / weather / external-API client cache layer if/when we tighten those.
- **`packages/schemas`** with shared Zod types — adopt **only if** form-validation Zod schemas need to be shared with API request validation. Skip for now; Eden Treaty handles compile-time types.
- **`Makefile`** with conventional targets (`dev`, `build`, `check`, `db-generate`, `db-migrate`, `up`, `down`, `kill`). Document in `apps/api/CLAUDE.md` and `apps/dashboard/CLAUDE.md`.

### Light API cleanup

For routes consumed by the dashboard (`workouts`, `workout-sets`, `exercises`, `daily-metrics`, `activities`, `weight-log`, `user-profile`):

- Replace `_start` / `_end` / `_sort` / `_order` query params with `page` / `limit` / `sort` / `order`.
- Return `{ data, total }` in body instead of `x-total-count` header (Eden Treaty types this naturally).
- Add `detail: { summary, description, tags }` to every Elysia route handler.
- Replace TypeBox schemas with Zod (see Group 6c). Use `.describe(...)` and `.openapi({ example: ... })` where helpful for agent consumption.
- Group routes by tag in Scalar UI.

Internal-only routes (`docker`, `slack`, `gmail`, `weather`, `ticktick`, `uptime-kuma`, `query`, `health`, `oauth`) get the tag/summary/description pass but no shape changes.

### Claude Code rule set (`apps/dashboard/.claude/rules/`)

| Rule file              | Enforces                                                                                                                                              |
|-|-|
| `mantine.md`           | Use Mantine components (Stack/Group/Grid) for layout. No raw hex in JSX. Color scheme via `useMantineColorScheme`. No inline `style={{}}` for theme-dependent values. |
| `tanstack-router.md`   | File-based routes, `loader` + `ensureQueryData`, search-param Zod validation, `<Link>` for navigation, `from` param for type narrowing.                |
| `tanstack-query.md`    | Query-key factories under `src/lib/queries/`, mutation invalidation, `useSuspenseQuery` in components.                                                 |
| `forms.md`             | `@mantine/form` with Zod resolver; dynamic lists via `insertListItem`/`removeListItem`; no controlled `useState` chains.                              |
| `state.md`             | Zustand only for cross-page persistent UI; URL state in router; server state in Query; component-local state in `useState`/`useReducer`.              |
| `openapi.md`           | Every route declares `detail: { summary, description, tags }`. Examples for agent-facing routes. New tags must be registered in `swagger` plugin docs. |

### oxlint extensions

```jsonc
{
  "plugins": ["react", "react-perf", "typescript", "import", "unicorn", "jsx-a11y", "promise", "oxc", "jsdoc"],
  "overrides": [
    {
      "files": ["apps/dashboard/src/**"],
      "rules": {
        "no-restricted-imports": ["error", {
          "paths": [
            { "name": "antd",                 "message": "Use Mantine — antd was removed in the migration." },
            { "name": "@ant-design/icons",    "message": "Use @tabler/icons-react." },
            { "name": "@refinedev/core",      "message": "Refine was removed in the migration." },
            { "name": "@refinedev/antd",      "message": "Refine was removed in the migration." },
            { "name": "react-router",         "message": "Use @tanstack/react-router." },
            { "name": "react-router-dom",     "message": "Use @tanstack/react-router." },
            { "name": "@visx/tooltip",        "message": "Use ChartTooltip + TooltipHeader/Row/Body from src/charts/primitives." }
          ],
          "patterns": [
            { "group": ["@refinedev/*"],      "message": "Refine was removed in the migration." }
          ]
        }]
      }
    }
  ]
}
```

## Migration Strategy

Greenfield `apps/dashboard` is built next to legacy `packages/dashboard`. Only the new app runs locally (port 5173). Legacy stays deployed at `https://argo.jkrumm.com` for visual reference but is not run as a local dev server — visual parity is judged against production. When both new pages reach feature + visual parity in dark/light + mobile and all CI checks are green, we swap `deploy.yml` to `apps/dashboard/Dockerfile`, run the data migration, delete `packages/dashboard`, prune unused deps, and ship as a single cutover release.

### Dependency DAG

```
                        ┌─────► 2 (Postgres) ────────┐
                        │                            │
1 (workspace move) ─────┼─────► 3 (scaffold) ───┐    │
                        │                       │    │
                        └─────► 6 (API cleanup, ─┼────┘ depends on 1+2
                                  Zod, OpenAPI)  │
                                                 │
        ┌────────────────────────────────────────┤
        │                                        │
        ▼                                        ▼
   4 (dashboard data layer)        5 (extract @argo/charts)
        │                                        │
        └────────────────┬───────────────────────┘
                         │
                         ▼
                7 (OTel + HyperDX)   ← depends on 2 + 3, parallel with 6
                         │
                         ▼
                8 (Garmin page)       ← depends on 3+4+5+6+7
                         │
                         ▼
                9 (Strength + bodyweight)  ← depends on 3+4+5+6+7+8
                         │
                         ▼
                10 (tooling, tests, rules, CI)  ← depends on 2+6+8+9
                         │
                         ▼
                11 (CUTOVER: data import + deploy swap + prune)
                         │
                         ▼
                12 (docs polish, descriptive-voice pass)
```

**Parallelism windows:**
- After Group 1: Groups 2 + 3 run in parallel.
- After Group 3: Groups 4 + 5 run in parallel.
- After Groups 2 + 3: Group 7 can start; Group 6 can start; they coordinate on `apps/api/src/index.ts` edits.
- Group 8 + 9 are sequential (Garmin sets the pattern; Strength follows).
- Group 10's TS-baseline / lefthook / React Compiler sub-tasks may be pulled forward to right after Group 3 if scheduling allows; tests / CI / rule polish stay at end.

### Production deploy pause

From Group 6 landing until Group 11 cutover, **no production deploys**. The new API shape is incompatible with the legacy production dashboard and the dashboard cutover ships in the same release. Document this in the migration PR description so a hurried merge doesn't trigger a broken deploy.

## Success Criteria

- [ ] Workspaces are `apps/{api,dashboard}` + `packages/charts`; legacy `packages/dashboard` removed at cutover.
- [ ] API runs against **Postgres** in prod and a **local Postgres container** in dev; SQLite is gone.
- [ ] `apps/api/drizzle/` contains generated migration files; api applies them on boot (no manual SQL).
- [ ] `DATABASE_URL` is sourced from `op://vps/argo/DB_PASSWORD` in prod (via `op run` or compose env) and from a local `.env.local.tpl` in dev.
- [ ] Cutover preserves all data: post-migration row counts match pre-cutover SQLite backup per table; sequences reset; SQLite backup retained at `/var/backups/argo/`.
- [ ] `apps/api/src/db/schema.ts` uses `pgSchema("argo")` for every table; generated migration emits `CREATE SCHEMA IF NOT EXISTS "argo";` and qualifies all identifiers.
- [ ] `DATABASE_URL` carries **no** `?schema=` / `?search_path=` param; `db/index.ts` strips it defensively if present.
- [ ] `apps/api/src/env.ts` Zod-validates all process env vars; boot fails fast on missing/malformed config; no raw `process.env.X` outside `env.ts` (and Vite config).
- [ ] OTel: backend produces server spans for every non-health request; frontend ships traces + console + network capture to HyperDX; a single trace spans browser → api on a representative dashboard request.
- [ ] `apps/dashboard/src/main.tsx` imports `./lib/hyperdx` as its first line (lint/docs-enforced).
- [ ] Vite dev proxies `/v1/traces` + `/v1/logs` to `127.0.0.1:4318`; production passes `VITE_HYPERDX_ENDPOINT` + `VITE_HYPERDX_API_KEY` via Docker `--build-arg`.
- [ ] Single schema lib: **Zod** is used end-to-end (env, route validators, forms, search params). `apps/api/src/` contains zero `t.*` (TypeBox) usages after Group 6.
- [ ] OpenAPI plugin is `@elysiajs/openapi` with `mapJsonSchema: { zod: z.toJSONSchema }`; Scalar renders all routes; spec round-trips through `openapi-typescript` cleanly.
- [ ] Frontend uses `date-fns` for any date formatting/arithmetic; backend has zero date-lib deps.
- [ ] `tsconfig.base.json` at repo root sets max strictness; all packages extend it; typecheck green everywhere.
- [ ] `bun --cwd apps/api test` runs unit tests for formulas + summary endpoints + env; CI runs them against a fresh Postgres.
- [ ] React Compiler is wired in `apps/dashboard/vite.config.ts`; build succeeds; no `'use no memo'` directives needed except documented edge cases.
- [ ] Lefthook installed; pre-commit runs `oxlint` + `oxfmt --check` on staged files.
- [ ] After Group 12: every `CLAUDE.md` and `.claude/rules/*.md` is in descriptive voice, the "add a page" + "add a route" walkthroughs are reproducible end-to-end, and the onboarding smoke test passes from a fresh context.
- [ ] `@argo/charts` is theme-agnostic: no Mantine imports inside `packages/charts/src/**` (lint-enforced).
- [ ] `apps/dashboard/src/charts-bridge.tsx` is the only place that wires Mantine's color scheme into `VxThemeProvider`.
- [ ] Dashboard runs on Vite + React 19 + Mantine v9 + TanStack Router (file-based) + TanStack Query + Eden Treaty + Zustand.
- [ ] No `@refinedev/*`, `antd`, `@ant-design/*`, `react-router`, or `react-router-dom` in `apps/dashboard/package.json`.
- [ ] Both pages render with parity (charts, forms, summary cards, dark/light, mobile breakpoints) against the same API.
- [ ] visx primitives + kinds + sparklines work under Mantine color scheme; theme toggle propagates without manual reloads.
- [ ] `@mantine/form` drives the strength-tracker dynamic-sets form including bodyweight subtab.
- [ ] API: every route has `detail: { summary, description, tags }`; pagination convention is `page`/`limit`/`sort`/`order` with `{ data, total }` body.
- [ ] `/summary` endpoints exist for `workouts`, `daily-metrics`, `weight-log`, `activities`; all accept `?window=` and `?from=/?to=`; trend rules documented in route descriptions.
- [ ] No client-side aggregation logic in `apps/dashboard` duplicates server math (rolling averages, PR detection, trend direction live on the server).
- [ ] oxlint config bans legacy imports and the visx tooltip; `bun run lint` and `bun run format:check` pass with zero warnings.
- [ ] `.github/workflows/check.yml` runs lint + format:check + typecheck + fallow on `pull_request` and `push: master`; `deploy.yml` paths updated to `apps/*`.
- [ ] `apps/dashboard/CLAUDE.md` + `.claude/rules/*.md` are comprehensive enough that "add a Docker containers dashboard page" is a single-prompt task.
- [ ] `bun install` from root succeeds; `bun run dev` in `apps/dashboard` boots a working app against the local API.

---

## Ralph Groups

> Each group is executed by an autonomous agent. The agent should research current best practices independently (Mantine v9, TanStack Router/Query, oxlint), use the references below as starting points (not hard constraints), and make implementation decisions on its own. No questions back — move forward with the best judgment. Use `/research` skill when unsure about library versions, APIs, or patterns.

### Group 1 — Workspace move & legacy preservation

**Scope:** Move `packages/api` → `apps/api`; root `package.json` workspaces become `["apps/*", "packages/*"]`; legacy dashboard stays at `packages/dashboard` and continues to build/deploy unchanged. Update `deploy.yml` API path to `apps/api/Dockerfile`. Update `apps/api`'s tsconfig path alias name to remain importable as `@argo/api`.

**Acceptance:** `bun install` clean; `bun --cwd apps/api start` works; `bun --cwd packages/dashboard dev` still works against the renamed API; `deploy.yml` (api job) still green; no behavior change in production.

**References:** Bun workspaces docs; current `package.json`; `.github/workflows/deploy.yml`.

### Group 2 — Postgres migration (driver + schema + data + dev)

**Scope:** Swap the API's persistence layer from SQLite to Postgres on the VPS, with proper drizzle-kit migrations, a local dev Postgres container, and a one-shot data migration script. **All API behavior must remain identical** from the dashboard's perspective — same routes, same shapes, same data after migration.

**Full surface to migrate (everything that touches SQLite today):**

- `apps/api/src/db/index.ts` — driver, connection, schema bootstrap.
- `apps/api/src/db/schema.ts` — every `sqliteTable` definition.
- `apps/api/src/routes/*.ts` — all 16 route files. SQLite-specific idioms (`INSERT OR IGNORE`, `datetime('now')`, raw `sqlite.query()`) become PG equivalents.
- `apps/api/src/routes/query.ts` — **special case**: uses raw `sqlite.query()`. Rewrite to use postgres.js's `sql.unsafe()` or a tagged query with the same SELECT-only safety check. Update the route description to say Postgres.
- `apps/api/src/cron/garmin-sync.ts` — performs DB writes; must use the new Drizzle/postgres-js layer.
- Any import of `Database` from `bun:sqlite` anywhere in `apps/api/src/**` — none should remain.

**Sub-tasks (in order):**

1. **Provisioning is already done.** The VPS Postgres has an `argo` database/schema and an `argo` role. Password is at `op://vps/argo/DB_PASSWORD` (tkrumm account). The migration agent does not run any `CREATE DATABASE`/`CREATE ROLE` SQL — it only consumes the existing instance. Record the resulting connection string format in `apps/api/CLAUDE.md` for future reference.
2. **Driver swap:** Remove `bun:sqlite` + `drizzle-orm/bun-sqlite`. Add `postgres` (postgres.js) + `drizzle-orm/postgres-js`. Rewrite `apps/api/src/db/index.ts` to a connection pool, `drizzle(client, { schema })`, and `migrate(db, { migrationsFolder: './drizzle' })` on boot.
3. **Schema port:** Convert every `sqliteTable` in `apps/api/src/db/schema.ts` to `pgTable`. Apply the type/constraint changes spelled out in the **Postgres migration** architecture section (boolean columns, `timestamp with time zone`, `serial`/`identity`, indexes, ON CONFLICT patterns in routes).
4. **Update route SQL idioms:** Replace `INSERT OR IGNORE` and `INSERT OR REPLACE` in routes/cron with `ON CONFLICT … DO NOTHING/UPDATE`. Replace any `datetime('now')` usage with `now()` or default column values.
5. **Generate initial migration:** `bun --cwd apps/api db:generate` produces `drizzle/0000_init.sql`. Add `db:generate` and `db:migrate` scripts to `apps/api/package.json`.
6. **Dev container:** Create `apps/api/docker-compose.dev.yml` running Postgres 16 on a non-standard host port (e.g. 5433) with a named volume. Create `apps/api/.env.local.tpl` with `DATABASE_URL` referencing `op://`. Document `make dev` or equivalent in `apps/api/CLAUDE.md`.
7. **Data migration script:** `apps/api/scripts/migrate-sqlite-to-pg.ts` reads `homelab.db` (path from env var, default `./data/homelab.db`) and inserts into Postgres for: `exercises`, `user_profile`, `sync_control`, `daily_metrics`, `garmin_activities`, `workouts`, `workout_sets`, `weight_log`. Idempotent (`ON CONFLICT DO NOTHING`). Resets sequences after insert so future inserts don't collide.
8. **Update prod deploy:** Add `DATABASE_URL` (and any related vars) to the VPS argo compose env (sourced from 1Password via `op run`). Remove the SQLite data volume mount from compose. Keep a backup of the SQLite file under `/var/backups/argo/homelab.db` before cutover.

**Depends on:** Group 1 (workspace rename so paths are stable).

**Acceptance:**
- `bun --cwd apps/api typecheck` passes after the swap.
- Local dev: `docker compose -f apps/api/docker-compose.dev.yml up -d` brings up Postgres; `op run … bun --cwd apps/api start` boots the api, applies the initial migration, and serves every existing route correctly.
- Smoke test: `GET /workouts`, `GET /daily-metrics`, `POST /workouts`, `GET /health`, `POST /query` (with a sample `SELECT * FROM argo.workouts LIMIT 5`), and one Garmin cron tick all behave as before.
- Data migration script: against a copy of production `homelab.db`, dry-run produces a populated Postgres with identical row counts per table.
- The deploy pipeline is **not** switched yet; production still runs SQLite. Production cutover happens in Group 11.

**References:** `drizzle-orm/postgres-js` docs, postgres.js docs, current `apps/api/src/db/index.ts`, current `apps/api/src/db/schema.ts`, current routes for SQLite-specific idioms.

### Group 3 — `apps/dashboard` scaffold

**Scope:** Create `apps/dashboard` with Vite + React 19, Mantine v9 core + sub-packages (`@mantine/form`, `@mantine/notifications`, `@mantine/modals`, `@mantine/dates`, `@mantine/hooks`), TanStack Router (file-based via `@tanstack/router-plugin/vite`), TanStack Query, Zustand, Eden Treaty (`@elysiajs/eden`), Zod, `@tabler/icons-react`. Light/dark theme via Mantine's `ColorSchemeScript` + `useMantineColorScheme`. Sidebar layout in `__root.tsx` matching legacy (active: Garmin Health + Strength Tracker; placeholders: Docker, Monitoring, Tasks). Empty `garmin-health.tsx` and `strength-tracker.tsx` route stubs. `Dockerfile`, `nginx.conf`, `vite.config.ts` on **port 5173** (legacy is not run locally), `tsconfig.json` with `@argo/api` and `@argo/charts` path aliases.

**Note:** legacy `packages/dashboard` keeps its scripts/Dockerfile but is **not** run as a local dev server — visual reference comes from the live production deploy.

**Can run in parallel with:** Groups 1 and 2 (frontend doesn't depend on the Postgres swap; both consume the same API shape).

**Acceptance:** `bun --cwd apps/dashboard dev` serves a working shell on `:5173` with sidebar, theme toggle, and route stubs in both light and dark mode.

**References:** Mantine v9 quickstart (https://mantine.dev/getting-started/), TanStack Router file-based routing docs, `packages/dashboard/src/App.tsx` (sidebar shape).

### Group 4 — Dashboard data layer: Eden + Query + Zustand + router-context

**Scope:** `apps/dashboard/src/lib/eden.ts` (treaty client, env-driven URL, `parseDate: false`). `src/lib/query-client.ts` (sensible defaults: `staleTime: 60_000`, `refetchOnWindowFocus: false`). `src/lib/store.ts` (Zustand `persist` store with `theme`, `sidebarCollapsed`, and per-page filter slots). Pass `queryClient` through Router `context` so `loader`s can call `ensureQueryData`. Set up query-key factory pattern in `src/lib/queries/` (one file per resource).

**Depends on:** Group 3.

**Acceptance:** A trivial loader → `ensureQueryData` → `useSuspenseQuery` round trip works for any read endpoint (e.g. `/health` or `/exercises`). Zustand store persists theme across reloads. Devtools (Query + Router) load in dev.

**References:** Dotfiles `~/SourceRoot/dotfiles/rules/tanstack-query.md`, `tanstack-router.md`, `tanstack-start.md` (the integration patterns section), TanStack docs.

### Group 5 — Extract visx to `packages/charts`

**Scope:** Create `packages/charts` workspace (`name: "@argo/charts"`, `type: "module"`, peerDeps: `react`, `react-dom`, `@visx/*` set we use). This is a **fresh extraction** — `packages/dashboard/src/charts/` stays untouched so the legacy build keeps working until Group 11 cutover. The legacy local copy is removed only during the Group 11 prune.

Copy (don't move) `packages/dashboard/src/charts/{primitives,kinds,sparklines,hooks,utils,tokens.ts,theme.tsx,hover-context.ts,index.ts}` → `packages/charts/src/`. Rewrite `theme.tsx`:

- Remove any imports from `@mantine/*` and from `apps/**`. The package must be theme-agnostic.
- Export `VxThemeProvider({ colorScheme: 'light' | 'dark', children })` and `useVxTheme()` reading from a package-internal `VxThemeContext`.
- `VX` tokens (semantic palette, series colors, dark/light pairs) stay in `tokens.ts` and resolve via `useVxTheme()`.

Create `apps/dashboard/src/charts-bridge.tsx` that wraps `VxThemeProvider` with Mantine's `useMantineColorScheme()` — the only file that imports both. Wire it in `main.tsx` between `MantineProvider` and the rest of the tree.

Add an oxlint override on `packages/charts/src/**` banning imports from `@mantine/*` and `apps/**` via `no-restricted-imports.patterns`.

Smoke-test in a temporary route that the package's primitives, kinds, and sparklines all render in both color schemes and that the theme toggle propagates live.

**Depends on:** Group 3.

**Acceptance:** `bun --cwd packages/charts typecheck` passes; `packages/charts/src/**` has zero `@mantine/*` and zero `apps/**` imports (verified by lint); every primitive/kind/sparkline that legacy uses is exported from `@argo/charts`; dark/light toggle propagates without reload via `VxBridge`; the existing `visx-charts.md` rule still applies (no `@visx/tooltip` outside primitives — enforced for `packages/charts/src/**`).

**References:** Existing `packages/dashboard/src/charts/`, `~/SourceRoot/dotfiles/rules/visx-charts.md` (update the rule's import examples to reference `@argo/charts` as part of this group).

### Group 6 — API cleanup + `/summary` endpoints + curated OpenAPI

> **Production deploy pause starts here.** After Group 6 lands on `master`, production must **not** be redeployed until Group 11 cutover. The new API shape (`page/limit/sort/order`, `{ data, total }` body, Zod validation, new summary endpoints) is incompatible with the legacy production dashboard (which still expects `_start/_end/_sort/_order` + `x-total-count`). The CI **check** workflow still runs; the **deploy** workflow is paused (either by branching the work, by adding a `deploy: false` label gate, or by simply not merging to master until Groups 7–10 are bundled into a single cutover PR).

**Scope:** Three concerns, one group because they all touch every route.

**6a. Pagination convention swap.** On the seven dashboard-consumed routes (`workouts`, `workout-sets`, `exercises`, `daily-metrics`, `activities`, `weight-log`, `user-profile`), swap Refine-style `_start/_end/_sort/_order` + `x-total-count` for `page/limit/sort/order` + `{ data, total }` body.

**6b. Summary endpoints.** Move derived/aggregated calculations from the dashboard to the server so AI agents, cron jobs, and future apps can consume the same values. Each summary endpoint accepts `?from=&to=` (ISO dates) or `?window=7d|30d|90d|all` (default `30d`). Implement with Drizzle aggregates; no caching layer yet (Postgres handles these aggregates trivially — revisit if a route exceeds ~50ms).

Minimum set:

| Endpoint | Returns (sketch) |
|-|-|
| `GET /workouts/summary/strength` | `{ byExercise: [{ exercise, currentE1RM, bestE1RM, prDate, totalVolumeWindow, sessionCountWindow }] }` |
| `GET /workouts/summary/series` | `{ byExercise: [{ exercise, points: [{ date, e1rm, volume, maxWeight }] }] }` |
| `GET /daily-metrics/summary` | `{ hrv: { current, ma7, ma30, trend }, restingHr: {…}, sleep: {…}, stress: {…} }` |
| `GET /daily-metrics/series` | `{ points: [{ date, hrv, restingHr, sleepScore, stress, … }] }` (already exists or trivial) |
| `GET /weight-log/summary` | `{ current, ma7, ma30, trend, weeklyDelta, monthlyDelta }` |
| `GET /weight-log/series` | `{ points: [{ date, weightKg }] }` |
| `GET /activities/summary` | `{ weeklyMinutes, weeklyByType, totalsWindow }` |

`trend` is `'up' | 'down' | 'flat'` derived from `ma7 vs ma30` (or equivalent) — document the rule per metric in the route's `detail.description`.

**6c. Schema lib swap (TypeBox → Zod) + OpenAPI curation.**

- Replace `@elysiajs/swagger` with `@elysiajs/openapi`. Configure `mapJsonSchema: { zod: z.toJSONSchema }` so Zod schemas serialize correctly into the OpenAPI spec.
- Migrate every route's `body` / `query` / `params` / `response` from TypeBox `t.*` to Zod `z.*`. Use `z.enum([...])` for literal unions (avoids the `@elysiajs/openapi` `z.union` serialization bug). Keep dates as ISO strings in responses (no `z.date()` / `z.transform()`). Mark optional fields with `.optional()` and nullable with `.nullable()`.
- Add `detail: { summary, description, tags }` to every Elysia route handler (dashboard-facing + internal). Provide `.describe(...)` / `examples` on schemas for agent-facing routes. Group by tag in Scalar UI.
- After this group, the entire codebase uses Zod — no `t.*` remains in `apps/api/src/`.

**Legacy dashboard decision:** legacy is **frozen** as of this group. It is not run locally, and visual reference comes from the live production deploy. It will keep running in production against the old API shape until cutover (Group 11), because Group 6's API changes go out in the same release as the new dashboard. If 6a/6b ship before the new dashboard is ready, deploy is paused until Groups 8+9 land — this is acceptable for a personal homelab dashboard.

**Depends on:** Groups 1 and 2 (route SQL changes ride on top of the Postgres swap). Can run in parallel with Groups 3, 4, and 5.

**Acceptance:** `/openapi.json` is rich and grouped; Scalar UI renders all routes by tag with summaries; all summary endpoints respond correctly for `window=7d|30d|90d|all` and `from/to`; sample query for each summary documented in the route's `detail.description`; agents querying `/workouts/summary/strength` get the same numbers as the dashboard.

**References:** `apps/api/src/routes/*.ts`, Elysia `detail` docs, `@elysiajs/openapi` docs, Zod Standard Schema integration with Elysia, Drizzle aggregate query patterns, existing Epley/Brzycki formulas in `workouts.ts`, basalt-ui-playground's `apps/api/src/app.ts` for the `@elysiajs/openapi` config + `mapJsonSchema` setup.

### Group 7 — OTel + HyperDX observability (backend + frontend)

**Scope:** End-to-end distributed tracing into the existing ClickStack/HyperDX deployment (`127.0.0.1:4318` locally, same address on the VPS docker network).

**Backend (`apps/api`):**

1. Add `apps/api/src/env.ts` — Zod-validated env (`z.object({...}).parse(process.env)`) exporting typed `env`. Include `DATABASE_URL`, `API_SECRET`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_SERVICE_VERSION`. Fail-fast on missing/malformed vars. Migrate the existing `if (!process.env.X) throw` checks to read from `env.X`. (Same Zod lib we use everywhere else — see Schema validation section.)
2. Add `apps/api/src/telemetry.ts` — `OTLPTraceExporter` + `telemetryConfig` + exported `tracer`. See architecture section.
3. Wire `@elysiajs/opentelemetry` plugin in `apps/api/src/index.ts` early in the chain, before route registrations. Add a span-name filter to suppress `/health` noise.
4. In the global `onError`, manually `span.recordException(error)` + `span.setStatus({ code: SpanStatusCode.ERROR })` because the plugin does not auto-record exceptions.
5. **Skip migrating outbound `clients/*` to `tracedFetch` in this group** — list them in a follow-up TODO. The plugin already records inbound spans; outbound enrichment is gravy.

**Frontend (`apps/dashboard`):**

1. Add `@hyperdx/browser` dep. Create `apps/dashboard/src/lib/hyperdx.ts` (see architecture section).
2. In `apps/dashboard/src/main.tsx`, import `./lib/hyperdx` **as the very first line** — before `'@mantine/core/styles.css'`, before React, before anything. Document this in `apps/dashboard/.claude/rules/observability.md`.
3. Add proxy rules to `apps/dashboard/vite.config.ts` for `/v1/traces` and `/v1/logs` → `127.0.0.1:4318`.
4. Add `VITE_HYPERDX_API_KEY`, `VITE_HYPERDX_SERVICE_NAME`, `VITE_HYPERDX_ENDPOINT` to `apps/dashboard/.env.local.tpl` (sourced from `op://`). Production: pass via `--build-arg` in `apps/dashboard/Dockerfile`.
5. Document the dev story in `apps/dashboard/CLAUDE.md`: run ClickStack locally on `:4318`, then `bun --cwd apps/dashboard dev` — same-origin proxy means no CORS dance.

**Cross-boundary verification:**

- Perform a request from the dashboard against `/exercises` (or any cheap endpoint). In HyperDX, locate the trace: it should show `browser → /api/exercises (server span) → drizzle query`. The `traceparent` header should be visible on the request.

**Depends on:** Groups 2 (Postgres swap — telemetry instrumentation lives in the same area as the new `db/` module) and 3 (dashboard scaffold — entry point must exist). Can run after Group 6 (or in parallel with Group 6 if both authors coordinate on `index.ts` edits).

**Acceptance:**
- `apps/api/src/env.ts` exists and is used everywhere — no raw `process.env.X` in route or service code (only in `env.ts` and `vite.config.ts`).
- A locally-run `apps/dashboard` produces traces in the local HyperDX, with continuity into the api spans.
- `/health` requests do not produce spans.
- Errors in any route produce a span with `status=error` and a recorded exception.
- Production builds inject `VITE_HYPERDX_ENDPOINT` and `VITE_HYPERDX_API_KEY` at build time.

**References:** `basalt-ui-playground/apps/api/src/telemetry.ts:1-17`, `basalt-ui-playground/apps/api/src/app.ts:38-44,94-112`, `basalt-ui-playground/apps/web/src/lib/hyperdx.ts:1-37`, `basalt-ui-playground/apps/web/vite.config.ts:16-24`, `basalt-ui-playground/apps/api/src/env.ts`. Mantine v9 + React 19 docs for the entry-file structure.

### Group 8 — Garmin Health page

**Scope:** Build `apps/dashboard/src/routes/garmin-health.tsx`, replacing the 397-line legacy. Consume server-computed values from `GET /daily-metrics/summary` (cards) and `GET /daily-metrics/series` (charts) — no client-side rolling averages or trend math. Use TanStack Router loader + `ensureQueryData`, `useSuspenseQuery` in component, Mantine layout (`Stack`, `Group`, `Grid`, `Card`, `Tabs` as needed), `@mantine/dates` for range pickers, visx imports from `@argo/charts`. Search-param schema (Zod) for `window`/`from`/`to`/per-metric toggles.

**Depends on:** Groups 3, 4, 5, 6, 7.

**Acceptance:** Page renders against the live API in dev; values match legacy production (visual parity check vs `https://argo.jkrumm.com`); theme toggle propagates to charts; mobile breakpoint behaves; no client-side aggregation logic that duplicates server math; lint + typecheck green; HyperDX shows a trace per page load that crosses into the api span.

**References:** Legacy page (`packages/dashboard/src/pages/garmin-health/index.tsx`), `docs/GARMIN-HEALTH.md`, dotfiles `tanstack-router.md` + `tanstack-query.md`.

### Group 9 — Strength Tracker + Body Weight

**Scope:** Build `apps/dashboard/src/routes/strength-tracker.tsx` (replaces the 403-line legacy) including the bodyweight subtab. Use `@mantine/form` with `insertListItem` / `removeListItem` for dynamic sets; Zod resolver for validation; `useMutation` + `invalidateQueries` for save/edit/delete. Consume server values from `GET /workouts/summary/strength` (cards), `GET /workouts/summary/series` (charts), `GET /weight-log/summary` + `GET /weight-log/series` (bodyweight). Charts imported from `@argo/charts`. Mobile-first layout (form on top); chart panel below on mobile, side-by-side on desktop.

**Depends on:** Groups 3, 4, 5, 6, 7, 8 (Garmin migration locks the page pattern).

**Acceptance:** Workout entry, edit, delete all work via the new shape; bodyweight tab works; mobile UX for at-the-gym entry preserved (large touch targets, defaulted values); summary cards match legacy production values exactly (server-computed, so they should be identical by construction); lint + typecheck green.

**References:** Legacy page, `docs/STRENGTH-ANALYTICS.md`, `@mantine/form` docs (`useForm`, list helpers).

### Group 10 — Tooling & guardrails (types, tests, compiler, hooks, lint, rules, CI)

**Scope:**

**Types.** Create `tsconfig.base.json` at repo root with the max-strict baseline (see Architecture). Update `apps/api/tsconfig.json`, `apps/dashboard/tsconfig.json`, `packages/charts/tsconfig.json` to `"extends": "../../tsconfig.base.json"`. Fix any errors that surface; expect a moderate number from `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.

**Tests.** Add unit tests in `apps/api`:
- `src/lib/formulas.test.ts` — Epley, Brzycki, average 1RM, pull-up total load, volume.
- `src/routes/workouts.summary.test.ts` — assert window math + trend rules.
- `src/routes/daily-metrics.summary.test.ts` — same.
- `src/routes/weight-log.summary.test.ts` — same.
- `src/env.test.ts` — happy path + one failure case.
Tests run via `bun test` (native, no Vitest). Add `"test": "bun test"` script to `apps/api/package.json`.

**React Compiler.** Add `babel-plugin-react-compiler` + `vite-plugin-babel` to `apps/dashboard`. Wire into `vite.config.ts` (see Architecture). Smoke-test that the dashboard still builds and pages render.

**Pre-commit.** Add `lefthook` dev dep at the repo root; write `lefthook.yml` (see Architecture). Document in root `README.md` that a fresh clone runs `bun install && bun lefthook install`.

**Lint.** Extend `.oxlintrc.json` with the plugin set (`react`, `react-perf`, `typescript`, `import`, `unicorn`, `jsx-a11y`, `promise`, `oxc`, `jsdoc`) and the `no-restricted-imports` overrides scoped to `apps/dashboard/src/**` (ban `antd`, `@ant-design/*`, `@refinedev/*`, `react-router*`, `@visx/tooltip` outside primitives) and `packages/charts/src/**` (ban `@mantine/*` and `apps/**`).

**Rules + CLAUDE.md.** Create the minimum viable set; full rewrite happens in Group 12.
- `apps/dashboard/CLAUDE.md` — short walkthrough: "add a page = file under `src/routes/` + loader + query factory + component". Reference rules.
- `apps/dashboard/.claude/rules/`: `mantine.md`, `tanstack-router.md`, `tanstack-query.md`, `forms.md`, `state.md`, `observability.md` (HyperDX import-order rule).
- `apps/api/CLAUDE.md` — connection string format, migration commands, OTel env vars, test commands.
- `apps/api/.claude/rules/`: `elysia-zod.md` (the Zod constraints), `openapi.md` (route detail conventions), `routes.md` (pagination convention).
- Update root `CLAUDE.md` for the `apps/*` + `packages/*` layout.

**CI.** Add `.github/workflows/check.yml` running on `pull_request` and `push: master`:
- `bun install`
- `bun run lint` (oxlint)
- `bun run format:check` (oxfmt)
- `bun --cwd apps/api typecheck` + `bun --cwd apps/dashboard typecheck` + `bun --cwd packages/charts typecheck`
- `bun --cwd apps/api test` (requires a Postgres service in the workflow — use `services: postgres` with healthcheck; run migrations before tests)
- `fallow` analysis — **report-only / non-blocking** (`continue-on-error: true`, output to job summary). A future PR can flip it to blocking once the baseline is clean.

**Depends on:** Groups 2 (schema for test fixtures), 6 (summary endpoints for tests), 8 and 9 (rules document the realized patterns).

> **Recommendation for the implementing agent:** the **TypeScript baseline**, **lefthook**, and **React Compiler** sub-tasks have no real dependency on the page migrations — landing them as soon as Group 3 finishes spreads the strictness benefit across every later group. The ralph runner may pull these forward into a small "Group 3.5" if that scheduling works better. Tests + final CI workflow + final rule pass must stay at the end.

**Acceptance:**
- `bun run lint`, `bun run format:check`, all `typecheck` commands clean from root.
- `bun --cwd apps/api test` passes locally and in CI against a fresh Postgres.
- Pre-commit hook fires on a staged file and runs lint+format before allowing a commit.
- React Compiler is active (verify a known-memoizable component shows up in the compiler's stats output, or run `bun react-compiler-healthcheck`).
- CI green on a no-op PR.
- Rule files exist, are minimal, and read coherently next to the code they govern. (Full descriptive-voice pass is Group 12.)

**References:** Existing `.oxlintrc.json`, dotfiles rules, basalt-ui-playground's `vite.config.ts` (React Compiler pattern), fallow docs (https://github.com/fallow-rs/fallow), lefthook docs (https://lefthook.dev).

### Group 11 — Cutover + cleanup (frontend deploy + data migration + prune)

**Scope:** This is the single user-visible production cutover. Three actions, in order:

1. **Postgres data import (one-shot, on the VPS).**
   - Take a fresh SQLite backup: `cp /<argo-data-dir>/homelab.db /var/backups/argo/homelab-pre-cutover.db`.
   - With the new api image already built (Group 2 schema is in `apps/api/drizzle/0000_init.sql`), spin up a temporary container that runs migrations against Postgres, then runs `apps/api/scripts/migrate-sqlite-to-pg.ts` pointed at the backup.
   - Verify row counts per table match between SQLite and Postgres.
2. **Deploy swap.** Update `.github/workflows/deploy.yml`: dashboard job → `apps/dashboard/Dockerfile`; api job stays on `apps/api/Dockerfile`. Update `vps/apps/argo/compose.yml` env to inject `DATABASE_URL` (from `op://vps/argo/DB_PASSWORD`), and drop the SQLite volume mount. Trigger deploy.
3. **Prune.** Delete `packages/dashboard/`. Remove unused deps from `package.json`s: `@refinedev/*`, `antd`, `@ant-design/icons`, `@ant-design/v5-patch-for-react-19`, `react-router`. Remove `bun:sqlite`-related types if any linger. Update root `CLAUDE.md` and any remaining doc references. Verify `bun install` is clean and `bun.lock` is regenerated.

**Depends on:** Groups 8 + 9 + 10 (acceptance gate: parity confirmed against live legacy, all CI green, Postgres + OTel paths verified locally).

**Acceptance:** Production deploy lands `apps/dashboard` running against Postgres on the VPS; legacy is gone; `bun.lock` shrinks; no orphan deps; both pages work in production; row counts and a spot-check of values match the pre-cutover SQLite backup.

**References:** `.github/workflows/deploy.yml`, `vps/apps/argo/compose.yml`, root `package.json`, `apps/api/scripts/migrate-sqlite-to-pg.ts`.

### Group 12 — Documentation polish (descriptive-voice final pass)

**Scope:** Cutover is live and stable. This group is the careful, extensive rewrite of every CLAUDE.md and `.claude/rules/*.md` against the as-built code. It produces docs an agent could land cold and start contributing from. **No code changes** in this group except small tweaks surfaced by the doc pass (e.g. renaming an export for clarity, splitting a too-large file).

**Doc + rule audit checklist:**

1. **Voice pass.** Every CLAUDE.md and rule file is rewritten in descriptive present-tense. Strip all "we will" / "should" / "going to" / "TODO" / "FIXME" / migration roadmap residue. Convert "if migrating from X" sections to a brief `## Legacy notes` at the bottom only if useful for archaeology.

2. **Realized-pattern capture.** Read the as-built code, then write rules from what is true:
   - Mantine: exact component prefs (Stack vs Group vs Grid), spacing tokens used, theme overrides applied.
   - TanStack Router: actual loader / `ensureQueryData` / `useSuspenseQuery` pattern + how search params are validated.
   - TanStack Query: real query-key factory in `apps/dashboard/src/lib/queries/`; document the convention.
   - Forms: `@mantine/form` + `zodResolver`, the exact list-helper pattern used in strength-tracker.
   - Charts: how `@argo/charts` is consumed; the `VxBridge` wiring; sparkline exception.
   - Observability: hyperdx.ts first-import, OTLP env vars, what a representative trace looks like.
   - Postgres: pgSchema pattern, migration commands, the SQLite legacy note.

3. **"Add a page" walkthrough rewrite.** `apps/dashboard/CLAUDE.md` gets a single canonical walkthrough from blank file → working page, using the realized helpers. Reference real file paths.

4. **"Add a route" walkthrough.** `apps/api/CLAUDE.md` gets the same for adding a CRUD or summary endpoint: schema → migration → route → OpenAPI tag → test → consume from dashboard.

5. **Root CLAUDE.md sanity pass.** Reads top-down without confusion. Links to the right per-app rules. No dangling references to `packages/dashboard`.

6. **Cross-link audit.** Every rule file links to:
   - Code locations it governs (`apps/dashboard/src/routes/__root.tsx:42`).
   - Upstream dotfiles rules where relevant.
   - Other project rules where they interact.

7. **Stale doc removal.** Audit `docs/`:
   - `docs/PRD.md` (the original) — move to `docs/archive/PRD-original.md` or annotate as historical.
   - `docs/MANTINE-MIGRATION-PRD.md` (this file) — annotate as **completed**; keep for reference.
   - `docs/GARMIN-HEALTH.md`, `docs/STRENGTH-ANALYTICS.md`, `docs/THE-QUANTIFIED-ATHLETE.md` — verify they describe current behavior; update or annotate as historical.

8. **Dotfiles rule updates.** Where the migration changed how a personal dotfiles rule is applied:
   - `~/SourceRoot/dotfiles/rules/visx-charts.md` — update import examples to `@argo/charts`.
   - Note in `~/SourceRoot/dotfiles/rules/elysia.md` that Argo uses Zod via Standard Schema with `@elysiajs/openapi`.
   - Capture any new universal patterns (e.g. lefthook config, tsconfig.base.json shape) as candidates for promotion to dotfiles.

9. **README at the repo root.** A real `README.md` exists explaining: what argo is, how to clone-and-run (dev), how to deploy, where the docs live. ~150 lines max.

10. **Onboarding smoke test.** A fresh-context Claude Code session prompted with "add a Docker containers dashboard page that lists running containers from `/docker/homelab/containers`" produces a working result on the first prompt, using only the rules + CLAUDE.md. If it can't, the rules are insufficient — iterate.

**Depends on:** Group 11 (cutover complete, production stable for at least one normal use session of both pages).

**Acceptance:**
- Every `CLAUDE.md` and `.claude/rules/*.md` is in descriptive voice (no roadmap residue).
- The "add a page" and "add a route" walkthroughs work when followed literally.
- The onboarding smoke test passes.
- Doc tree under `docs/` is organized: completed migration PRDs annotated, current architecture docs accurate, historical docs archived.
- A reading pass from root → app CLAUDE.md → rules surfaces no contradictions or stale references.

**References:** Final as-built code in `apps/{api,dashboard}` + `packages/charts`. Existing rule voice elsewhere in `~/SourceRoot/dotfiles/rules/` for tone calibration.

---

## Risks & Mitigations

| Risk                                                                            | Mitigation                                                                                                                  |
|-|-|
| Mantine v9 + React 19 edge cases (third-party deps)                             | Mantine v9 explicitly supports React 19. Pin known-good minor early in Group 3; rely on `/research` skill for any surprises. |
| visx alpha versions (`^4.0.0-alpha.11`) drift                                   | Keep current versions; do not upgrade visx during this migration. Note in CLAUDE.md as a "do not touch".                    |
| API cleanup breaks legacy dashboard during transition                            | Legacy is frozen as of Group 6. Production keeps running the old API + dashboard pair until the Group 11 cutover replaces both at once. |
| Postgres + drizzle migration produces subtly different SQL types vs SQLite       | Group 2 acceptance includes a route-by-route smoke test against the local Postgres before any prod work. Sequences are reset post-import. |
| Data migration row-count mismatch                                                | The one-shot script logs per-table SQLite vs Postgres counts; cutover halts if they disagree. SQLite backup is retained under `/var/backups/argo/`. |
| TanStack Router file-based routing has a learning curve for agents              | `.claude/rules/tanstack-router.md` plus a concrete `apps/dashboard/CLAUDE.md` "add a page" walkthrough mitigate this.        |
| oxlint plugin coverage gaps (no Mantine-specific rules exist)                   | Document patterns in `.claude/rules/` + enforce import bans via `no-restricted-imports`. Rely on Claude Code conformance.   |
| `@hey-api/client-fetch` lingering in `apps/api` deps                            | Audit during Group 11 prune; if unused, remove.                                                                              |
| HyperDX SDK monkey-patches `fetch` — import order matters                       | `apps/dashboard/.claude/rules/observability.md` documents that `import './lib/hyperdx'` must be the first line in `main.tsx`. Group 7 acceptance verifies traceparent header on Eden Treaty calls. |
| OTLP endpoint differs between dev (host port) and prod (docker network DNS)     | Vite dev proxies `/v1/traces` + `/v1/logs` → `127.0.0.1:4318` for same-origin. Prod sets `VITE_HYPERDX_ENDPOINT` at build time. Both documented in `apps/dashboard/CLAUDE.md`. |
| `@elysiajs/openapi` open issues with Zod (`z.union` in response, `z.transform`, `z.void`, branded types, `z.custom`) | Constrain Zod usage per the **Schema validation** section: `z.enum()` for literal unions, ISO strings for dates, no transforms/custom/void in responses. None of these limits affect argo's domain schemas. Documented in `apps/api/.claude/rules/elysia-zod.md`. |
| `mapJsonSchema` not configured → Zod schemas silently dropped from docs        | Group 6c acceptance includes a spot-check that every route appears in `/openapi.json` with full request/response schema fidelity. |
