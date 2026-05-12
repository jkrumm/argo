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
  '/',
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
      tags: ['my-resource'],
      summary: 'List my resources',
      description: 'Returns a paginated list. page is 1-indexed.',
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

## Tests

```bash
# Run all tests (requires DATABASE_URL + API_SECRET)
bun test --cwd apps/api

# With local DB
op run --account tkrumm --env-file=apps/api/.env.local.tpl -- bun test --cwd apps/api
```

Tests live alongside source files as `*.test.ts`:

- `src/lib/formulas.test.ts` — unit tests for pure formula functions (no DB)
- `src/env.test.ts` — env schema validation
- `src/routes/workouts.summary.test.ts` — integration: strength summary endpoint
- `src/routes/daily-metrics.summary.test.ts` — integration: health summary endpoint
- `src/routes/weight-log.summary.test.ts` — integration: weight summary endpoint

Integration tests seed fixtures in `beforeEach`/`afterEach` and require a live Postgres.

## OTel Environment Variables

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318  # default — local ClickStack
OTEL_SERVICE_NAME=argo-api                           # default
OTEL_SERVICE_VERSION=0.0.0                           # default; set to git tag in prod Docker
```

All env vars are validated at startup via Zod in `src/env.ts`. Missing required vars cause a fail-fast error on boot.

## Production (VPS)

API runs on the VPS via RollHook — push to `master` triggers a rolling Docker restart.
Compose: `~/SourceRoot/vps/apps/argo/compose.yml`.

The SQLite → Postgres migration ran once at cutover (`scripts/migrate-sqlite-to-pg.ts`).
Pre-cutover SQLite backup at `/var/backups/argo/homelab-pre-cutover.db` on the VPS.
