# apps/api — Elysia + Bun + Postgres

## Database

- **Postgres** on the VPS (production) and locally on port **5433** (dev container).
- Schema: `argo` (all tables qualified as `argo.<table>`).
- Role/DB: `argo` / `argo`. Password at `op://vps/argo/DB_PASSWORD` (tkrumm account).
- Connection string format: `postgres://argo:<password>@<host>:5432/argo`

### Local dev

```bash
# 1. Start local Postgres (reads ARGO_DB_PASSWORD from .ralph-secrets.env or env)
make db-up

# 2. Apply migrations
DATABASE_URL="postgres://argo:<pw>@localhost:5433/argo" bun --cwd apps/api run db:migrate

# 3. Start the API
DATABASE_URL="postgres://argo:<pw>@localhost:5433/argo" API_SECRET=dev bun run start
```

Or with 1Password:

```bash
op run --account tkrumm --env-file=apps/api/.env.local.tpl -- \
  sh -c 'bun --cwd apps/api run db:migrate && API_SECRET=dev bun --cwd apps/api run start'
```

### Migrations

Generated SQL files live in `apps/api/drizzle/`. Committed to git, applied on boot via `runMigrations()`.

```bash
# Generate new migration after schema changes:
bun --cwd apps/api run db:generate

# Apply to local DB:
DATABASE_URL="..." bun --cwd apps/api run db:migrate
```

### SQLite → Postgres data migration (one-shot)

Used during Group 11 production cutover and available for local verification:

```bash
DATABASE_URL="postgres://argo:<pw>@localhost:5433/argo" \
  SQLITE_PATH="./apps/api/data/homelab.db" \
  bun --cwd apps/api run db:migrate-from-sqlite
```

## Tests

```bash
# Run all tests (requires DATABASE_URL + API_SECRET env vars)
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

Integration tests seed fixtures in `beforeEach`/`afterEach` and require a real Postgres.

## OTel environment variables

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318  # default — points at local ClickStack
OTEL_SERVICE_NAME=argo-api                           # default
OTEL_SERVICE_VERSION=0.0.0                           # default; set to git tag in prod Docker
```

## Production (VPS)

Production cutover is in Group 11. Until then, production runs SQLite + legacy dashboard.
Do not deploy the new API shape to production before Group 11.
