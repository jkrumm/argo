# apps/api — Elysia + Bun + Postgres

## Database

- **Postgres 18** — production and local dev are the same cluster: the mini's database `shared` on `:5432` (`~/SourceRoot/vps/compose.dev.yml`), where `argo` sits next to the `usage` schema it reads (`usage-tracker` owns it; role `argo` has SELECT only) and `agent_workflows` stays a separate database (read-only role `argo_agw_ro`).
- Schema: `argo` (all tables qualified as `argo.<table>`), owned by role `argo` (limit 20, shared with the main database). Role and database come from `cd ~/SourceRoot/vps && make db-shared` (idempotent); `argo` holds CREATE on `shared` because drizzle's migrator runs `CREATE SCHEMA IF NOT EXISTS`.
- Role password: `op://vps/argo/DB_PASSWORD` (tkrumm account).

### Local dev

```bash
# 1. Start shared dev infra (Postgres + ClickStack), once: make db-shared
cd ~/SourceRoot/vps && make up && make db-shared && cd -

# 2. (Optional) Replace the local shared.argo with a fresh, checksum-verified copy of prod (MacBook only)
bun db:sync          # = make db-sync; scripts/db-sync.sh documents the guards

# 3. Start API + dashboard concurrently (runs migrations on API boot)
bun dev
```

### Migrations

Generated SQL files live in `apps/api/drizzle/`, committed to git, and applied automatically on boot via `runMigrations()` in `src/db/index.ts`. **There is no manual prod migrate step** — `make deploy` (root `AGENTS.md` §Deploy) boots the new release, which migrates before serving traffic. Boot migrations hold a Postgres advisory lock, so overlapping boots serialise.

The migration journal lives in `argo.__drizzle_migrations` (argo's own schema), not the default shared `drizzle` schema — set via `migrations.schema` in `drizzle.config.ts` and `migrationsSchema` in `runMigrations()`. A one-time `relocateDrizzleJournal()` copies the journal from the legacy `drizzle` schema on boot (idempotent; removable once every env has booted past it). See `~/SourceRoot/vps/AGENTS.md` → "Postgres Schema Model" for the cluster-wide convention.

**Workflow**

```bash
# 1. (optional, for risky migrations) refresh local data to match prod shape
bun db:sync

# 2. edit src/db/schema.ts

# 3. generate SQL — no DB needed; drizzle-kit diffs schema.ts against drizzle/*.sql
bun run --cwd apps/api db:generate

# 4. apply locally and test (or restart `bun dev`)
bun db:migrate

# 5. commit + push, then `make deploy` → migration runs on prod boot
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

## Further reference

Before changing anything below, Read the doc first: these sections moved out of this file verbatim.

- `bun db:sync` internals, a dropped or unused table: `docs/api/database.md`
- Running or adding API tests (run them with `bun test:api`; a bare `bun test` fails the integration tests): `docs/api/tests.md`
- OTel env vars, the native mini runtime, the production LaunchAgent: `docs/api/runtime.md`
- Usage quota, picker decisions, the models relay: `docs/api/usage-quota.md`
- Usage page: IU portal, flow, movers: `docs/api/usage-iu-portal.md`
- Usage page: credit pace, router, demand: `docs/api/usage-pace.md`
- `/finance/*` (the `fin serve` relay): `docs/api/finance.md`
- `/paper/*` (the `paper` CLI through `hc exec`: scan, inbox, document index, print): `docs/api/paper.md`
- Line and Machines (ClickHouse reads): `docs/api/clickhouse-reads.md`
- Reading (Hardcover, homelab link) and Garmin: `docs/api/integrations.md`
- Google and M365 tokens, seeding, access control: `docs/api/google-m365.md`
