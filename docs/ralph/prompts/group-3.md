# Group 3: Postgres migration (driver + schema + data + dev)

## What You're Doing

Swap the API's persistence layer from SQLite to Postgres on the VPS. Generate proper drizzle-kit migrations. Stand up a local Postgres container for dev. Write a one-shot data migration script. **Every existing API route must behave identically from the dashboard's perspective after this group** — same routes, same shapes, same data. Production still runs SQLite at the end of this group; the actual production cutover happens in Group 11.

DB provisioning is already done by the user: `op://vps/argo/DB_PASSWORD` holds the password for the existing `argo` role and `argo` database/schema on the VPS Postgres. Do not run any `CREATE DATABASE` / `CREATE ROLE` SQL — consume the existing instance.

---

## Required Reading

1. **The PRD section** for this group: `docs/MANTINE-MIGRATION-PRD.md` lines 609-642 (Group 2) plus the **Postgres migration** subsection in the Architecture block.
2. **Every file that touches SQLite today.** Grep `apps/api/src` for `bun:sqlite`, `sqliteTable`, `INSERT OR IGNORE`, `INSERT OR REPLACE`, `datetime('now')`, raw `sqlite.query`. The full surface includes:
   - `apps/api/src/db/index.ts`
   - `apps/api/src/db/schema.ts`
   - All 16 route files under `apps/api/src/routes/*.ts`
   - `apps/api/src/routes/query.ts` (special case — uses raw `sqlite.query()`)
   - `apps/api/src/cron/garmin-sync.ts`
3. The **Schema validation** + **Postgres migration** architecture sections of the PRD for the type / constraint conversions (boolean, timestamp with time zone, serial/identity, indexes, ON CONFLICT patterns).
4. `drizzle-orm/postgres-js` docs (https://orm.drizzle.team/docs/get-started-postgresql#postgresjs).
5. `postgres` (postgres.js) docs (https://github.com/porsager/postgres).
6. `drizzle-kit` migration commands (https://orm.drizzle.team/kit-docs/overview).
7. `pgSchema` in Drizzle (https://orm.drizzle.team/docs/sql-schema-declaration#schemas).
8. The user's `~/SourceRoot/CLAUDE.md` block on 1Password CLI usage with `--account tkrumm`.
9. `~/SourceRoot/dotfiles/rules/docker-makefile.md` — wrap docker-compose invocations in Makefile targets.

---

## What to Implement (in order)

### 1. Driver swap

Remove `bun:sqlite` and `drizzle-orm/bun-sqlite` from `apps/api/package.json`. Add `postgres` (postgres.js) and `drizzle-orm/postgres-js`. Add `drizzle-kit` as a devDep if not already present.

Rewrite `apps/api/src/db/index.ts` as a postgres.js client + `drizzle(client, { schema })` + `migrate(db, { migrationsFolder: './drizzle' })` invocation on boot. Strip any `?schema=` / `?search_path=` param from `DATABASE_URL` defensively before passing to postgres.js — that lib does not understand it; `pgSchema()` handles schema qualification at the query level.

### 2. Schema port

Rewrite `apps/api/src/db/schema.ts` using `pgSchema("argo")`. Every existing `sqliteTable` becomes `argoSchema.table(...)`. Apply:

- Integer-as-boolean → `boolean()`.
- Timestamps → `timestamp({ withTimezone: true })` (PG: `timestamp with time zone`).
- Auto-increment PKs → `integer().primaryKey().generatedAlwaysAsIdentity()` (PG identity), or `serial()` if that pattern is more natural — pick one and use it everywhere.
- Indexes → PG-style `index()` / `uniqueIndex()`.
- Drop SQLite-specific defaults (e.g. `CURRENT_TIMESTAMP`) in favor of `defaultNow()`.

### 3. Route + cron SQL idiom updates

Replace `INSERT OR IGNORE` → `.onConflictDoNothing()`. Replace `INSERT OR REPLACE` → `.onConflictDoUpdate({ … })`. Replace `datetime('now')` → `sql\`now()\`` or column default. Replace raw `sqlite.query()` in `routes/query.ts` with `sql.unsafe(text)` from postgres.js (or a Drizzle `sql\`\``), keeping the existing SELECT-only safety regex. Update the route description to mention Postgres.

The Garmin cron writes in `apps/api/src/cron/garmin-sync.ts` go through the new Drizzle layer.

### 4. Drizzle Kit config + generate

Create `apps/api/drizzle.config.ts` pointing at `src/db/schema.ts`, output `./drizzle`, driver `pg`, schema filter `"argo"`. Add scripts to `apps/api/package.json`:

```json
"db:generate": "drizzle-kit generate",
"db:migrate":  "drizzle-kit migrate"
```

Run `db:generate` once locally; commit `drizzle/0000_init.sql`. The generated SQL should include `CREATE SCHEMA IF NOT EXISTS "argo";` and qualify every table identifier.

### 5. Dev container

Create `apps/api/docker-compose.dev.yml`: Postgres 16, host port 5433 (avoids collision), named volume `argo_pg_dev`, `POSTGRES_DB=argo`, `POSTGRES_USER=argo`, `POSTGRES_PASSWORD=argo` (dev only — not the production password). Add a Makefile target (`apps/api/Makefile` or root) for `make db-up` / `make db-down` / `make db-reset`.

Create `apps/api/.env.local.tpl` with `DATABASE_URL="postgres://argo:argo@localhost:5433/argo"` for dev and a placeholder line for prod (`# prod: op://vps/argo/DB_PASSWORD`).

Document `bun --cwd apps/api db:migrate && bun --cwd apps/api start` (or `op run … bun --cwd apps/api start`) in `apps/api/CLAUDE.md`.

### 6. Data migration script

Create `apps/api/scripts/migrate-sqlite-to-pg.ts`. It:

1. Reads the SQLite file path from `SQLITE_PATH` env var (default `./data/homelab.db`).
2. Opens it with `bun:sqlite` directly (this is the only file that may import it during the script's lifetime — delete the dep after Group 11 cutover).
3. Connects to Postgres via postgres.js with `DATABASE_URL`.
4. For each table — `exercises`, `user_profile`, `sync_control`, `daily_metrics`, `garmin_activities`, `workouts`, `workout_sets`, `weight_log` — selects all rows, inserts into Postgres with `ON CONFLICT DO NOTHING` (idempotent re-runs).
5. Resets each sequence: `SELECT setval(pg_get_serial_sequence('argo.<table>', 'id'), COALESCE((SELECT MAX(id) FROM argo.<table>), 1));`
6. Logs per-table SQLite vs Postgres row count; exits non-zero if any mismatch.

Add a script entry: `"db:migrate-from-sqlite": "bun run scripts/migrate-sqlite-to-pg.ts"`.

### 7. Snapshot production SQLite locally + run the migration

Download a fresh copy of the production SQLite file and run the migration script against it. After this step, local Postgres holds real data and every later group (summary endpoints, Garmin page, Strength page) develops against realistic content instead of empty tables. This also exercises the migration script before cutover, shrinking Group 11's risk surface.

```bash
# Production SQLite lives at /var/lib/argo/data/homelab.db on the VPS.
# VPS has NOPASSWD sudo (see ~/SourceRoot/CLAUDE.md), so:
mkdir -p apps/api/data
ssh vps "sudo cat /var/lib/argo/data/homelab.db" > apps/api/data/homelab.db
ls -lh apps/api/data/homelab.db   # sanity-check size

# Bring up local Postgres (Step 6) if not already running, then:
op run --account tkrumm --env-file=apps/api/.env.local.tpl -- \
  bun --cwd apps/api db:migrate
op run --account tkrumm --env-file=apps/api/.env.local.tpl -- \
  bun --cwd apps/api run scripts/migrate-sqlite-to-pg.ts
```

The script logs per-table SQLite-vs-Postgres row counts and exits non-zero on mismatch. **Validate counts match before considering Step 7 done.**

The downloaded SQLite is a frozen snapshot (production cron keeps writing on the VPS until cutover). That is fine for dev — the goal is realistic data shapes + volumes, not live sync. Re-running the snapshot+migrate cycle later picks up new data idempotently (the script's `ON CONFLICT DO NOTHING`).

Add `apps/api/data/homelab.db` to `.gitignore` (alongside the existing `/packages/api/data/` entry that this group's Group-1 move should already have shifted to `/apps/api/data/`).

### 8. Prod compose env (do NOT trigger a deploy)

Edit `vps/apps/argo/compose.yml` (in `~/SourceRoot/vps`, accessed via the user's local checkout) to inject `DATABASE_URL` sourced from `op run --account tkrumm`. Drop the SQLite data volume mount. **Do not push a deploy.** This change goes live in Group 11.

If the `vps` repo is not under `apps/`, do not commit there from this group — leave a note in `RALPH_NOTES.md` describing the exact diff for the maintainer to apply during Group 11.

---

## Validation

```bash
bun install
bun --cwd apps/api typecheck
bun run lint
bun run format:check

# Local Postgres + data migration + smoke against real data
make db-up || docker compose -f apps/api/docker-compose.dev.yml up -d

# Snapshot prod SQLite (Step 7) — only re-run if you want fresher data
[ -f apps/api/data/homelab.db ] || ssh vps "sudo cat /var/lib/argo/data/homelab.db" > apps/api/data/homelab.db

op run --account tkrumm --env-file=apps/api/.env.local.tpl -- bun --cwd apps/api db:migrate
op run --account tkrumm --env-file=apps/api/.env.local.tpl -- bun --cwd apps/api run scripts/migrate-sqlite-to-pg.ts

# Boot api against the migrated DB and smoke every surface
bun --cwd apps/api start &
sleep 2
curl -fsS http://localhost:3000/health
curl -fsS http://localhost:3000/workouts        | jq 'length, .[0]?'
curl -fsS http://localhost:3000/daily-metrics   | jq 'length'
curl -fsS -X POST http://localhost:3000/query \
  -H 'content-type: application/json' \
  -d '{"sql":"SELECT count(*) FROM argo.workouts"}'
kill %1
```

The row counts from the migration script must match SQLite. Record the per-table counts in `docs/ralph/RALPH_NOTES.md` as a baseline for Group 11's cutover verification.

**Production cutover is NOT in this group.** Production stays on SQLite + the legacy dashboard until Group 11. The same migration script runs again on the VPS at cutover — having validated it locally with real data shrinks Group 11's risk surface significantly.

---

## Commit

```
feat(api): migrate persistence layer from SQLite to Postgres
```

Reasonable to split into:
- `feat(api): swap sqlite → postgres driver and pgSchema`
- `feat(api): update route SQL idioms for postgres`
- `feat(api): add drizzle-kit migrations and dev compose`
- `feat(api): add sqlite → postgres data migration script`

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then output as the literal last line:

```
RALPH_TASK_COMPLETE: Group 3
```
