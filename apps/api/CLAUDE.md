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

### 3. Mount in `src/index.ts`

After the `authGuard` `.use()`:

```ts
import { myResourceRoutes } from './routes/my-resource.js'

export const app = new Elysia()
  // ...existing plugins and auth guard...
  .use(myResourceRoutes)
```

### 4. Add tests

`src/routes/my-resource.test.ts` — seed fixtures in `beforeEach`/`afterEach`, hit real Postgres:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { app } from '../index.js'
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
