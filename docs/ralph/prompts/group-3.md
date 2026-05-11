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

Create `apps/api/docker-compose.dev.yml`: Postgres 16, host port 5433 (avoids collision), named volume `argo_pg_dev`, `POSTGRES_DB=argo`, `POSTGRES_USER=argo`, `POSTGRES_PASSWORD: ${ARGO_DB_PASSWORD}` (env-interpolated — same password as production, sourced from `op://vps/argo/DB_PASSWORD` via the runner's pre-fetched `.ralph-secrets.env` exported into the loop's environment). Add a Makefile target (`apps/api/Makefile` or root) for `make db-up` / `make db-down` / `make db-reset` — each target sources `.ralph-secrets.env` before invoking docker compose, so a developer running the targets manually also gets the password.

Create `apps/api/.env.local.tpl` with `DATABASE_URL="postgres://argo:${ARGO_DB_PASSWORD}@localhost:5433/argo"` for dev and a placeholder line for prod (`# prod: op://vps/argo/DB_PASSWORD`).

Document `make db-up && bun --cwd apps/api db:migrate && bun --cwd apps/api start` for local dev in `apps/api/CLAUDE.md`. Note that production uses `op run --account tkrumm` against `op://vps/argo/DB_PASSWORD` at deploy time — but that's a Group 14 concern.

### 6. Data migration script

Create `apps/api/scripts/migrate-sqlite-to-pg.ts`. It:

1. Reads the SQLite file path from `SQLITE_PATH` env var (default `./data/homelab.db`).
2. Opens it with `bun:sqlite` directly (this is the only file that may import it during the script's lifetime — delete the dep after Group 11 cutover).
3. Connects to Postgres via postgres.js with `DATABASE_URL`.
4. For each table — `exercises`, `user_profile`, `sync_control`, `daily_metrics`, `garmin_activities`, `workouts`, `workout_sets`, `weight_log` — selects all rows, inserts into Postgres with `ON CONFLICT DO NOTHING` (idempotent re-runs).
5. Resets each sequence: `SELECT setval(pg_get_serial_sequence('argo.<table>', 'id'), COALESCE((SELECT MAX(id) FROM argo.<table>), 1));`
6. Logs per-table SQLite vs Postgres row count; exits non-zero if any mismatch.

Add a script entry: `"db:migrate-from-sqlite": "bun run scripts/migrate-sqlite-to-pg.ts"`.

### 7. Run the migration against the pre-downloaded SQLite

The production SQLite snapshot was downloaded during ralph setup and lives at `apps/api/data/homelab.db` (Group 1's `git mv` of `packages/api` → `apps/api` carries the `data/` dir with it). **Do not re-download.** If you need a fresher snapshot later, the one-liner is `ssh vps "sudo cat /var/lib/argo/data/homelab.db" > apps/api/data/homelab.db` — but not as part of this group.

**No `op run` is needed for local dev.** Local Postgres uses hardcoded dev credentials (`postgres://argo:${ARGO_DB_PASSWORD}@localhost:5433/argo`). The `.env.local.tpl` you create in Step 6 lists this directly — no `op://` references for local. Production secrets are only consumed during the Group 14 cutover.

```bash
ls -lh apps/api/data/homelab.db   # sanity-check the snapshot exists (~68KB)

# Bring up local Postgres (Step 6) if not already running:
make db-up   # or: docker compose -f apps/api/docker-compose.dev.yml up -d

# Apply migrations + import data:
DATABASE_URL="$ARGO_LOCAL_DATABASE_URL" bun --cwd apps/api db:migrate
DATABASE_URL="$ARGO_LOCAL_DATABASE_URL" \
  SQLITE_PATH=./apps/api/data/homelab.db \
  bun --cwd apps/api run scripts/migrate-sqlite-to-pg.ts
```

The script logs per-table SQLite-vs-Postgres row counts and exits non-zero on mismatch. **Validate counts match before considering Step 7 done.** Record the counts in `docs/ralph/RALPH_NOTES.md` as a baseline for Group 14's cutover verification.

`.gitignore` already excludes `/apps/api/data/` so the snapshot never enters git.

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

DATABASE_URL="$ARGO_LOCAL_DATABASE_URL" bun --cwd apps/api db:migrate
DATABASE_URL="$ARGO_LOCAL_DATABASE_URL" SQLITE_PATH=./apps/api/data/homelab.db bun --cwd apps/api run scripts/migrate-sqlite-to-pg.ts

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
