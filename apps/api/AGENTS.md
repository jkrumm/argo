# apps/api — Elysia + Bun + Postgres

## Database

- **Postgres 18** — production on the VPS, local dev uses the shared cluster from `~/SourceRoot/vps/compose.dev.yml` on `:5432`.
- Schema: `argo` (all tables qualified as `argo.<table>`). Created via `cd ~/SourceRoot/vps && make postgres-setup` (idempotent).
- Role: `argo`. Password at `op://vps/argo/DB_PASSWORD` (tkrumm account).
- Database name: `op://vps/config/POSTGRES_DB`.

### Local dev

```bash
# 1. Start shared dev infra (Postgres + ClickStack + Valkey)
cd ~/SourceRoot/vps && make up && cd -

# 2. (Once) provision the argo role + schema
cd ~/SourceRoot/vps && make postgres-setup && cd -

# 3. (Optional) Pull a fresh dump of prod data into local
bun db:sync

# 4. Start API + dashboard concurrently (runs migrations on API boot)
bun dev
```

### Migrations

Generated SQL files live in `apps/api/drizzle/`, committed to git, and applied automatically on boot via `runMigrations()` in `src/db/index.ts`. **There is no manual prod migrate step** — push to `master`, RollHook redeploys, the new container migrates before serving traffic.

The migration journal lives in `argo.__drizzle_migrations` (argo's own schema), not the default shared `drizzle` schema — set via `migrations.schema` in `drizzle.config.ts` and `migrationsSchema` in `runMigrations()`. A one-time `relocateDrizzleJournal()` copies the journal from the legacy `drizzle` schema on boot (idempotent; removable once every env has booted past it). See `~/SourceRoot/vps/AGENTS.md` → "Postgres Schema Model" for the cluster-wide convention.

All tables are declared under `pgSchema('argo')` in `src/db/schema.ts`.

**Workflow**

```bash
# 1. (optional, for risky migrations) refresh local data to match prod shape
bun db:sync

# 2. edit src/db/schema.ts

# 3. generate SQL — no DB needed; drizzle-kit diffs schema.ts against drizzle/*.sql
bun run --cwd apps/api db:generate

# 4. apply locally and test (or restart `bun dev`)
bun db:migrate

# 5. commit + push → RollHook → migration runs on prod boot
git add apps/api/drizzle apps/api/src/db/schema.ts
```

**Sync ordering gotcha.** `bun db:sync` uses `pg_dump --clean --if-exists`, so it **wipes** whatever's in your local `argo` schema and replaces it with prod's. Run `db:sync` _before_ generating a new migration (so you test against prod-shaped data), never _after_ — otherwise your unreleased migration gets wiped from the local DB. The SQL files in git are untouched either way; just re-run `bun db:migrate` to re-apply.

## Adding a Route

### 1. Schema changes (if needed)

Add columns or a new table to `src/db/schema.ts` under the `argo` pgSchema:

```ts
import { pgSchema, serial, text } from 'drizzle-orm/pg-core'

const argo = pgSchema('argo')

export const myTable = argo.table('my_table', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
})
```

Then generate and apply:

```bash
bun run --cwd apps/api db:generate
bun db:migrate
```

### 2. Create the route file

`src/routes/<resource>.ts`:

```ts
import { Elysia } from 'elysia'
import { z } from 'zod'
import { count } from 'drizzle-orm'
import { db } from '../db/index.js'
import { myTable } from '../db/schema.js'

const QuerySchema = z.object({
  page: z.number().int().min(1).default(1).optional(),
  limit: z.number().int().min(1).max(200).default(50).optional(),
  sort: z.enum(['name', 'id']).default('id').optional(),
  order: z.enum(['asc', 'desc']).default('desc').optional(),
})

const ItemSchema = z.object({
  id: z.number().int(),
  name: z.string(),
})

export const myResourceRoutes = new Elysia({ prefix: '/my-resource' }).get(
  '',
  async ({ query }) => {
    const { page = 1, limit = 50 } = query
    const [rows, [countRow]] = await Promise.all([
      db
        .select()
        .from(myTable)
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ count: count() }).from(myTable),
    ])
    return { data: rows, total: Number(countRow?.count ?? 0) }
  },
  {
    query: QuerySchema,
    response: z.object({ data: z.array(ItemSchema), total: z.number().int() }),
    detail: {
      tags: ['Strength'], // MUST be from the enum in .claude/rules/openapi.md
      summary: 'List my resources',
      description:
        'Returns a paginated list of my resources, newest first. page is 1-indexed; limit caps at 200. Use ?sort=name to alphabetize. For a single resource use GET /my-resource/{id}.',
      security: [{ BearerAuth: [] }],
    },
  },
)
```

### 3. Mount in `src/app.ts`

Inside `buildApp()`, after the `authGuard` `.use()` (`src/index.ts` only boots the listener — it imports the built `app` from `app.ts`):

```ts
import { myResourceRoutes } from './routes/my-resource.js'

export function buildApp() {
  return (
    new Elysia()
      // ...existing plugins and auth guard...
      .use(myResourceRoutes)
  )
}
```

### 4. Add tests

`src/routes/my-resource.test.ts` — seed fixtures in `beforeEach`/`afterEach`, hit real Postgres:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { app } from '../app.js'
import { db } from '../db/index.js'
import { myTable } from '../db/schema.js'

beforeEach(async () => {
  await db.insert(myTable).values({ name: 'test' })
})
afterEach(async () => {
  await db.delete(myTable)
})

describe('GET /my-resource', () => {
  it('returns paginated results', async () => {
    const res = await app.handle(
      new Request('http://localhost/my-resource?page=1&limit=10', {
        headers: { Authorization: `Bearer ${process.env['API_SECRET']}` },
      }),
    )
    const body = await res.json()
    expect(body.data).toBeArray()
    expect(typeof body.total).toBe('number')
  })
})
```

### Cross-references

- `.claude/rules/routes.md` — pagination shape, summary endpoints, naming, transactions
- `.claude/rules/openapi.md` — `detail` block requirements and tag names
- `.claude/rules/elysia-zod.md` — Zod constraints specific to `@elysiajs/openapi`
- `.claude/rules/weekly-aggregation.md` — "by week" = Mon–Sun via `lib/week.ts`, keyed by the Monday date; never trailing-7d

## Tests

```bash
# Run all tests (from repo root). Wraps op + assembles DATABASE_URL from the
# op-resolved components (the .tpl only holds op:// refs — DATABASE_URL itself
# is built at runtime by scripts/test.sh, same as dev.sh / db-migrate.sh).
bun test:api

# Pass through filters/flags to `bun test`, e.g. a single file:
bun test:api src/routes/workouts.summary.test.ts

# Pure unit tests only (no DB) — DATABASE_URL/API_SECRET can be dummy values:
DATABASE_URL=postgres://x@localhost/x API_SECRET=x bun test --cwd apps/api src/lib
```

> NOTE: a bare `op run --env-file=apps/api/.env.local.tpl -- bun test` will fail
> integration tests with `DATABASE_URL ... undefined` — the template never sets
> `DATABASE_URL` (op can't interpolate an `op://` ref inside a larger string).
> Use `bun test:api`. Integration tests also need the dev Postgres up
> (`cd ~/SourceRoot/vps && make up && make postgres-setup`).

Tests live alongside source files as `*.test.ts`:

- `src/lib/formulas.test.ts` — unit tests for pure formula functions (no DB)
- `src/env.test.ts` — env schema validation
- `src/routes/workouts.summary.test.ts` — integration: strength summary endpoint
- `src/routes/daily-metrics.summary.test.ts` — integration: health summary endpoint
- `src/routes/weight-log.summary.test.ts` — integration: weight summary endpoint

Integration tests seed fixtures in `beforeEach`/`afterEach` and require a live Postgres.

## Observability

OpenTelemetry traces + logs ship to ClickStack via `@elysiajs/opentelemetry`. `src/telemetry.ts` is the single entry point — exports `telemetryConfig`, `tracer`, and a structured `log` helper. Outgoing fetch must go through `src/lib/traced-fetch.ts`; Drizzle is auto-instrumented in `src/db/index.ts` via `@kubiks/otel-drizzle`. Cron ticks wrap each tick in `context.with(ROOT_CONTEXT, …)` so they don't chain into one giant trace.

See `.claude/rules/observability.md` for the full pattern — when to add manual spans, the CORS allowlist for W3C propagation, cron naming convention, and the verification checklist.

### Env vars

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318  # base URL — SDK appends /v1/traces and /v1/logs
OTEL_SERVICE_NAME=argo-api                         # service.name resource attribute
OTEL_SERVICE_VERSION=                              # optional; falls back to package.json version
```

All env vars are validated at startup via Zod in `src/env.ts`. Missing required vars cause a fail-fast error on boot.

## Usage quota + picker decisions

**Payer** (`src/lib/usage-query.ts` `PAYER_SQL`, no column, works on all history): `billing=max ∧ account=iu` → `iu-sub`, `max ∧ me` → `me-sub`, `billing=iu` → `iu-api`, `billing=openrouter` → `me-api` (the personal pay-per-token API), everything else — including Max rows whose account is not (yet) known — `unknown`. Available as `payer[]` filter on `/usage/{headline,timeseries,breakdown}`, as `groupBy=payer` / `dimension=payer`, and as `costIuSub30d`/`costMeSub30d`/`costIuApi30d`/`costMeApi30d` on the headline. `billing` and `account` filters/dimensions are unchanged. A new payer or billing value needs the CASE, `PAYERS` and the dashboard's `USAGE_PAYERS` registry updated together. Timeseries buckets are UTC days (pinned in SQL; prod Postgres is `Etc/UTC`). Migration `0024` is reversible from the off-repo pg_dump of its archive table, which `0025` dropped (restore steps in `docs/usage-reconciliation.md`). Tests: `src/routes/usage.payer.test.ts`, `src/db/migration-0024.test.ts` (route tests need a Postgres: `DATABASE_URL=… API_SECRET=… bun test src/routes/usage`).

`usage-tracker` POSTs Claude account quota samples (`/usage/quota-samples`, key `(account, sampledAt, machine)`) and picker decisions (`/usage/account-picks`, key `(ts, lane, machine)`); picker spec: `dotfiles/docs/claude-accounts.md` §The picker. Both are append-only (`ON CONFLICT DO NOTHING`, nothing pruned, ~200 rows/day) and validate **per row** (timestamps need an explicit zone and are stored as `toISOString()`, so `+02:00` and `Z` spellings of one instant dedupe): an invalid row is dropped and counted in `rejected`, never a 422 for the batch (the body schema only fixes the envelope). `picked` is opaque: an account id or `spill`. Reads: `GET /usage/quota` (buckets widen with the window: 15 min ≤72 h, 1 h ≤30 d, 1 d beyond; last sample wins; resets as markers; future-stamped rows ignored) and `GET /usage/account-picks/summary`. The routes live in `src/routes/usage-quota.ts`, mounted inside `usageRoutes` (no prefix of their own, so the `/usage` auth guard and Eden path are shared). Tests: `src/routes/usage.quota.test.ts`.

## Usage page data: IU portal, flow, movers

`usage-tracker` POSTs IU's self-service cost report to `POST /usage/iu-portal` (`{costs:[{day,label,row,model,costUsd,fetchedAt}] ≤1000, totals:[{month,totalUsd,fetchedAt}] ≤24}`), upserted on `(day,label,row)` / `month` into `argo.iu_portal_cost` / `iu_portal_total` (migration `0026`); a replay is a no-op, an invalid row is dropped and counted in `rejected`. The cap (`IU_CAP_USD` 500) and window (`IU_WINDOW_DAYS` 30) are constants in `src/lib/iu-budget.ts`, which also holds the pure arithmetic ported from usage-tracker `budget.ts` (tests pin the 2026-10-26 fetch: rolling30 $588.14, can-spend −$65.59, same as `make budget`). Reads, all anchored on the newest _portal_ day, not the server clock:

- `GET /usage/iu-budget` — rolling30, canSpendToday, 7-day burn and projection, 31 daily points, next-7 drop-off, top models, `fetchedAt` (null = no portal data; the page owns the fresh/stale/dead words).
- `GET /usage/iu-reconcile?days=30` — portal vs `billing='iu'` tracked per UTC day (flag rule: |delta| > max($1, 20 % of portal); newest day `partial`), per model (portal label ↔ `model_norm` joined on alphanumerics, one-sided models keep their own label), `unpricedRows`.
- `GET /usage/flow?range&lens=cost|tokens&top` — one row per `(source, sub_tool, model_norm)` with cost, the four token classes + reasoning and calls; the tail beyond `top` (default 200) is one `other` row so rows still sum to `total`. Tokens lens ranks by every class including cache-read.
- `GET /usage/movers?days=7&limit=3&payer` — top `(sub_tool, model)` pairs by |Δ$| vs the prior window, API payers by default, pairs under $2 in both windows dropped, empty when the prior window predates the data floor.
- `GET /usage/timeseries` gained `metric=tokens_input|tokens_output|tokens_cache_read|tokens_cache_write` (output includes reasoning) and `top=N` (additive metrics: N largest keys + a trailing `other`). `tokens` is unchanged (no cache-read) because Tinycast reads it.

Filter schemas and `buildFilterSql` live in `src/lib/usage-filters.ts`; routes in `usage-portal.ts` and `usage-analytics.ts`, mounted in `usageRoutes`. Tests: `src/lib/iu-budget.test.ts` (DB-free), `src/routes/usage.portal.test.ts`, `usage.flow.test.ts`.

## Garmin (Connect Personal API)

`cron/garmin-sync.ts` (every 6 h + a 60 s manual-refresh poll) pulls straight from the official Garmin Connect Personal API through `clients/garmin.ts`; pure DTO → row mapping lives in `lib/garmin-mapping.ts`. Auth is a personal API key (`GARMIN_API_KEY`, `op://vps/argo/GARMIN_API_KEY`) exchanged for a 24 h JWT that the client caches in memory and re-mints when under 1 h is left (and once on a 401). Requests are sequential — rate limits are unpublished. The cron stays disabled while `GARMIN_API_KEY` is empty.

- **Key rotation.** The key expires at most yearly; Garmin emails a week before. Rotate it in 1Password (`op://vps/argo/GARMIN_API_KEY`), then `make argo-env` on the VPS (`~/SourceRoot/vps`) and redeploy.
- **Typed SDK.** `src/generated/garmin/` is generated by `@hey-api/openapi-ts` (pinned in `package.json`) from the vendored official spec `specs/garmin-personal-api.openapi.json`: `bun run --cwd apps/api gen:garmin`. The token endpoint is not in the spec; the client calls it directly.
- **No daily `vo2_max`.** The Personal API has no daily max-metrics endpoint, so `daily_metrics.vo2_max` is no longer refreshed (existing values are preserved); activities still carry `vO2MaxValue`.
- Tests: `src/lib/garmin-mapping.test.ts`, `src/lib/garmin-client.test.ts` (both in the CI unit set).

## Google (Gmail + Calendar)

In-browser OAuth, refresh-token based. Local and prod are independent grants — each holds its own `google` slice in `data/oauth-tokens.json` (alongside the M365 slice).

### Token install / refresh

```bash
bun google:auth:prod     # copies https://argo.jkrumm.com/api/oauth/google/init to clipboard
```

Paste into a browser signed into one of the allowlisted Google accounts. On completion, Google calls the prod callback and the API writes the tokens to disk. No script — pure browser flow.

`bun google:auth` (local) is left in place for emergencies but **local OAuth is intentionally not used in normal development** — see "Local Google auth — intentionally disabled" below.

### Local Google auth — intentionally disabled

Google refresh tokens grant ~6 months of Gmail + Calendar read access. On prod they sit behind container isolation + VPS root, an acceptable risk. On a laptop they would sit in plain JSON owned by the user, readable by anything running as that user — other dev tooling, IDE extensions, stray transitive deps. The marginal benefit of `bun dev` reaching Google directly does not justify that attack surface.

Therefore `apps/api/.env.local.tpl` does not wire `GOOGLE_*` env vars, and `data/oauth-tokens.json` should never contain a `google` slice on a developer laptop. For Google-backed features, use `bun dev:prod-api` — the local dashboard proxies `/api/*` to `argo.jkrumm.com`, which holds the prod tokens.

Under `bun dev`, `/calendar` returns 503 and the dashboard renders its standard re-auth alert. That is the intended behavior, not a bug.

### Refresh behavior

`clients/google.ts:getValidAccessToken()` auto-refreshes when the access token has less than 5 minutes of life left. Refresh tokens themselves do not normally expire — except in one case below.

### When to re-auth

- The Google Cloud OAuth client is in **"Testing"** publishing status → refresh tokens expire after **7 days**. Either re-auth weekly with `bun google:auth*`, or publish the OAuth app (Google Cloud Console → OAuth consent screen → **Publish App**) to lift refresh tokens to the standard 6-month-idle policy. **This is the most likely cause of recurring 503s on `/calendar` and Gmail endpoints.**
- The Google account password changed, or the user revoked the grant at https://myaccount.google.com/permissions.
- The token file was deleted.

### Access control — `GOOGLE_ALLOWED_EMAIL`

When the OAuth app is published to **In Production**, the consent screen is reachable by anyone who knows the `client_id`. Without further protection, a stranger could complete the flow and **overwrite** the stored tokens with their own grant — breaking the app and pulling their data onto our disk.

`GOOGLE_ALLOWED_EMAIL` (comma-separated list of emails) closes this. `clients/google.ts:exchangeCode()` calls `/oauth2/v2/userinfo` immediately after the token exchange and refuses to persist if the authenticated email is not on the list. Empty value disables the check (suitable only for private deployments). Set it on prod via the standard env path (`op://vps/argo/GOOGLE_ALLOWED_EMAIL`) and redeploy.

The refresh path is not gated because once a permitted token is saved, refresh only rotates the access token under the same `refresh_token` — there is no second consent step to attack.

The Calendar page in the dashboard surfaces a "Re-authorize Google →" link in its error alert when `/calendar` returns 503, so the re-auth flow is one click from the UI.

## M365 (IU Microsoft 365 MCP)

Wraps the IU M365 MCP server (proxy over Microsoft Graph — calendar, mail, Teams, OneDrive, OneNote, ~270 operations behind 3 meta-tools). Argo never sees the user's IU password; it holds an OAuth refresh token per environment.

### Why bootstrap-script-only

The upstream Azure AD app's redirect-URI allow-list doesn't include `argo.jkrumm.com/api/...` — only the MCP-inspector callback (`http://localhost:6274/oauth/callback/debug`) is allowed. The IT colleague won't widen it without justification. So argo has no in-process OAuth init route; tokens are always installed by a laptop-side bootstrap script that uses the inspector URI, then POSTs the result to `/m365/seed`.

### Token install / refresh

```bash
# One-time per env (each is an independent OAuth grant, separate refresh-token chain):
bun m365:auth          # writes apps/api/data/oauth-tokens.json on the laptop
bun m365:auth:prod     # POSTs to https://argo.jkrumm.com/api/m365/seed
```

Both run `apps/api/scripts/m365-bootstrap.ts`, which spawns a one-shot HTTP server on `localhost:6274`, does its own DCR + PKCE + token exchange against the MCP server, then either writes the file or seeds prod via `POST /m365/seed` (bearer-auth gated by `API_SECRET`). The script prints the IU SSO URL to stdout; you complete it in a browser; the success page lands and the process exits.

### Where tokens live

- **Local:** `apps/api/data/oauth-tokens.json` — gitignored, on the laptop's disk, owned by the user.
- **Prod:** `/var/lib/argo/data/oauth-tokens.json` on the VPS, mounted as `/app/data` into the container, owned by `dhcpcd:lxd` (the container runtime user). Persisted across container restarts; survives `RollHook` redeploys.

Tokens are NOT stored in 1Password or in env vars — they're per-grant, per-env runtime state. Both files coexist with the existing `google` OAuth tokens (each integration owns its slice of the JSON).

### Refresh behavior

`clients/m365.ts` refreshes the access token automatically when it has less than 5 minutes of life left. Microsoft rotates refresh tokens on every use; we persist the new one each round. Either env stays alive forever as long as it gets called at least once every 90 days (Microsoft's inactivity ceiling). Local and prod do not race — independent grants → independent rotation chains.

### When to re-seed

Re-run `bun m365:auth*` if:

- `/m365/*` returns `M365 not authenticated …` (refresh token revoked, file deleted, or 90-day inactivity expired)
- You changed your IU password (revokes all grants)
- You explicitly want to invalidate the current token and start fresh

The same command both installs and replaces — no clean-up step needed.

## Production (VPS)

API runs on the VPS via RollHook — push to `master` triggers a rolling Docker restart.
Compose: `~/SourceRoot/vps/apps/argo/compose.yml`.
