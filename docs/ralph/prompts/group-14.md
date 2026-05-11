# Group 14: Cutover + cleanup (frontend deploy + data migration + prune)

> **🚨 DANGER — this is the single user-visible production cutover.** Three irreversible-ish actions in order: data import on the VPS, deploy swap, prune of legacy code + deps. Take a SQLite backup before anything else. Verify acceptance against live production before merging the prune.

## What You're Doing

The migration has been complete in code for several groups; now it ships. Three steps, in order:

1. **Postgres data import** on the VPS — populate the production Postgres from the SQLite backup using the Group 2 script.
2. **Deploy swap** — `.github/workflows/deploy.yml` dashboard job now builds `apps/dashboard/Dockerfile`; `vps/apps/argo/compose.yml` injects `DATABASE_URL` from 1Password and drops the SQLite volume.
3. **Prune** — delete `packages/dashboard/`, remove legacy deps from `package.json`s, regenerate `bun.lock`.

After this group, production runs `apps/dashboard` against Postgres on the VPS; legacy is gone.

---

## Required Reading

1. **The PRD section** for this group: `docs/MANTINE-MIGRATION-PRD.md` lines 831-846 (Group 11).
2. The **Migration Strategy / Production deploy pause** section (lines 555-557).
3. `apps/api/scripts/migrate-sqlite-to-pg.ts` (Group 2).
4. `.github/workflows/deploy.yml` — what the api + dashboard jobs currently do.
5. `vps/apps/argo/compose.yml` — checked out at `~/SourceRoot/vps/apps/argo/compose.yml`. Read it before editing.
6. Root `package.json` + `packages/dashboard/package.json` for the legacy deps to remove.
7. `~/SourceRoot/dotfiles/rules/docker-makefile.md` and `~/SourceRoot/CLAUDE.md`'s VPS section (sudo via `op read`).
8. **Acceptance gate:** confirm Groups 8 + 9 + 10 are all green and the new dashboard hits parity against `https://argo.jkrumm.com` for both pages before starting Step 1.

---

## What to Implement

### Step 1 — Postgres data import on the VPS

The migration script was already validated against real data in Group 2 (it ran against a local snapshot of production SQLite into local Postgres, with row-count parity verified). Step 1 here is the same script, same logic, against the live production SQLite into production Postgres.

Run on the VPS (`ssh vps`):

```bash
# 1. Fresh SQLite backup
mkdir -p /var/backups/argo
sudo cp /<argo-data-dir>/homelab.db /var/backups/argo/homelab-pre-cutover.db
sudo chown -R argo:argo /var/backups/argo  # or whoever owns the data dir

# 2. Capture SQLite row counts (for the post-migration check)
sqlite3 /var/backups/argo/homelab-pre-cutover.db <<'SQL'
SELECT 'exercises'         as t, count(*) FROM exercises          UNION ALL
SELECT 'user_profile'      , count(*) FROM user_profile           UNION ALL
SELECT 'sync_control'      , count(*) FROM sync_control           UNION ALL
SELECT 'daily_metrics'     , count(*) FROM daily_metrics          UNION ALL
SELECT 'garmin_activities' , count(*) FROM garmin_activities      UNION ALL
SELECT 'workouts'          , count(*) FROM workouts               UNION ALL
SELECT 'workout_sets'      , count(*) FROM workout_sets           UNION ALL
SELECT 'weight_log'        , count(*) FROM weight_log;
SQL
```

Record those counts in `docs/ralph/RALPH_NOTES.md` for Group 11.

Then, with the new api image already built (the Group 2 `drizzle/0000_init.sql` is in the repo and built into the image):

```bash
# 3. Run migrations against production Postgres
op run --account tkrumm --env-file=.env.tpl -- docker run --rm \
  -e DATABASE_URL \
  --network argo_net \
  argo-api:latest bun --cwd /app db:migrate

# 4. Run the data migration script
op run --account tkrumm --env-file=.env.tpl -- docker run --rm \
  -e DATABASE_URL \
  -e SQLITE_PATH=/backup/homelab-pre-cutover.db \
  -v /var/backups/argo:/backup:ro \
  --network argo_net \
  argo-api:latest bun run scripts/migrate-sqlite-to-pg.ts
```

The script itself logs per-table SQLite vs Postgres counts and exits non-zero on mismatch. **If it exits non-zero, abort cutover.** Investigate, fix, retry — production is still running on SQLite.

### Step 2 — Deploy swap

Edit `.github/workflows/deploy.yml`:

- Dashboard job: build context `apps/dashboard/`, Dockerfile `apps/dashboard/Dockerfile`. Pass `VITE_API_URL`, `VITE_HYPERDX_ENDPOINT`, `VITE_HYPERDX_API_KEY`, `VITE_HYPERDX_SERVICE_NAME` as `--build-arg`s sourced from GitHub secrets / `op`.
- API job: stays on `apps/api/Dockerfile`, unchanged from Group 1.

Edit `~/SourceRoot/vps/apps/argo/compose.yml`:

- Inject `DATABASE_URL` via `op run` (the existing pattern in the same repo for other services).
- Drop the SQLite data volume mount.
- Add the OTLP env vars (`OTEL_EXPORTER_OTLP_ENDPOINT=http://hyperdx:4318` or whichever DNS name the network uses).

**Trigger deploy.** Watch the GitHub Action; on green, verify production:

- `https://argo.jkrumm.com/garmin-health` renders, values match `/var/backups/argo/homelab-pre-cutover.db` spot-checks.
- `https://argo.jkrumm.com/strength-tracker` same.
- HyperDX shows traces in production with the prod service name.

If anything is wrong, the SQLite backup at `/var/backups/argo/homelab-pre-cutover.db` is the rollback source. Document any rollback in `RALPH_NOTES.md`.

### Step 3 — Prune

After production has been stable for a use session (one normal-day visit to both pages):

```bash
# Delete the legacy dashboard
git rm -r packages/dashboard

# Remove legacy deps from root and any remaining package.json
#   - @refinedev/*
#   - antd, @ant-design/icons, @ant-design/v5-patch-for-react-19
#   - react-router (if still listed)
#   - @hey-api/client-fetch (audit — remove if unused)
#   - any drizzle-orm/bun-sqlite or bun:sqlite types lingering outside scripts/

# If the data migration script is no longer needed:
# Either delete apps/api/scripts/migrate-sqlite-to-pg.ts entirely, or leave it
# with a SKIP_IF_EMPTY guard for archaeology. The PRD didn't specify — make
# a judgment call and document it.

bun install   # regenerate bun.lock
bun run lint
bun run format:check
bun --cwd apps/api typecheck
bun --cwd apps/dashboard typecheck
bun --cwd packages/charts typecheck
```

Also update:

- Root `CLAUDE.md` — remove references to `packages/dashboard`.
- `apps/api/CLAUDE.md` — remove the SQLite legacy note if one exists, or convert it to a `## Legacy notes` section per PRD Group 12 guidance.
- `.gitignore` — drop the `/packages/dashboard/...` entries.
- `~/SourceRoot/vps/apps/argo/compose.yml` — verify SQLite data volume is fully gone.
- `apps/dashboard/CLAUDE.md` if it still references the legacy.

---

## Validation

```bash
bun install                    # clean lockfile, smaller bun.lock
bun --cwd apps/api typecheck
bun --cwd apps/dashboard typecheck
bun --cwd packages/charts typecheck
bun --cwd apps/api test
bun run lint
bun run format:check

# No orphan deps
grep -rE '@refinedev|antd|@ant-design|react-router' package.json apps/*/package.json packages/*/package.json
# (must return only react-router-style mentions inside oxlint config bans, if anywhere)

# Production:
curl -fsS https://argo.jkrumm.com/health    # 200 OK
# Browser visit to both pages, theme toggle, mobile breakpoint, traces visible in prod HyperDX
```

Row count spot-check:
```bash
ssh vps "psql \$DATABASE_URL -c 'SELECT count(*) FROM argo.workouts'"
# matches /var/backups/argo/homelab-pre-cutover.db count for workouts
```

---

## Commit

Sequence (one commit per step to keep cutover history readable):
```
feat(deploy): swap dashboard job to apps/dashboard/Dockerfile
chore(vps): inject DATABASE_URL via op, drop sqlite volume
chore(repo): prune legacy packages/dashboard + refine/antd/react-router deps
```

Plus the `vps` repo commits in `~/SourceRoot/vps` for the compose changes.

If something rolls back, document in `RALPH_NOTES.md` and proceed only when the next attempt is clean.

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md` — include the SQLite-vs-Postgres row count table for archaeology — then output as the literal last line:

```
RALPH_TASK_COMPLETE: Group 14
```

If any step blocks (mismatched row counts, deploy failure that needs human intervention, etc.), emit:

```
RALPH_TASK_BLOCKED: Group 14 - <one-sentence reason>
```
