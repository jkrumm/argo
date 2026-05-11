# apps/api — Elysia + Bun + Postgres

## Database

- **Postgres** on the VPS (production) and locally on port **5433** (dev container).
- Schema: `argo` (all tables qualified as `argo.<table>`).
- Role/DB: `argo` / `argo`. Password at `op://vps/argo/DB_PASSWORD` (tkrumm account).
- Connection string: `postgres://argo:<password>@<host>:5432/argo`

### Local dev

```bash
# 1. Start local Postgres (reads ARGO_DB_PASSWORD from .ralph-secrets.env or env)
make db-up

# 2. Apply migrations and start the API
op run --account tkrumm --env-file=apps/api/.env.local.tpl -- \
  sh -c 'bun --cwd apps/api run db:migrate && bun --cwd apps/api run start'
```

### Migrations

Generated SQL files live in `apps/api/drizzle/`. Committed to git, applied automatically on boot via `runMigrations()` in `src/db/index.ts`.

```bash
# Generate new migration after schema changes:
bun --cwd apps/api run db:generate

# Apply to local DB:
DATABASE_URL="postgres://argo:<pw>@localhost:5433/argo" bun --cwd apps/api run db:migrate
```

All tables are declared under `pgSchema('argo')` in `src/db/schema.ts`.

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
bun --cwd apps/api run db:generate
DATABASE_URL="postgres://argo:<pw>@localhost:5433/argo" bun --cwd apps/api run db:migrate
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
bun --cwd apps/api test

# With local DB
DATABASE_URL="postgres://argo:<pw>@localhost:5433/argo" API_SECRET=dev bun --cwd apps/api test
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
