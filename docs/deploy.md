# Deploy and verify

Moved verbatim from the root AGENTS.md (§Deploy, §Verify & Monitor, §Local Dev); the root keeps the rule each section states.

## Database restore

The VPS copy is gone (dropped 2026-11-03): no containers, images, `argo` schema or role remain there, so there is no second
copy to roll back to. Restoring the database, newest recovery point first:

1. **The nightly backup of `shared`** (03:15, vps `scripts/backup-pg-dev.sh`, 14 kept, each restore-drilled on write):
   `homelab:/mnt/hdd/backups/vps-mini-postgres/<ts>/shared.dump` plus `SHA256SUMS` and `counts.tsv`; at most ~24 h of loss.
   Procedure and drill: vps `docs/mini-postgres.md`.
2. **The cutover dump**, last resort for VPS-era data: `homelab:~/argo-backups/argo-schema-final-20261030T1643Z.{dump,sums,sha256}`
   (custom format, the whole VPS `argo` schema incl. the five legacy usage tables; `sha256sum -c` the `.sha256` first). It loses
   everything the mini wrote since 2026-10-30 16:43Z.

Either way, `argo` only (both dumps hold more than Argo; never restore a whole `shared.dump` into `shared`, it carries `usage`):
`launchctl bootout gui/$(id -u)/com.jkrumm.argo` and confirm it is gone; `pg_restore --schema=argo --no-owner --role=argo
--exit-on-error -d <scratch db>` and compare row counts against `counts.tsv` / `.sums`; then the same with `--clean --if-exists -d
shared` as role `argo`; `COMMENT ON SCHEMA argo IS 'argo live (restored from <dump>) <date>'` (the restore replaces the mark the
guards read); `make deploy`.

## Mini layout

### Mini layout (`~/.argo`, `ARGO_ROOT` relocates it for tests)

```
repo/                 fetch-only clone (nothing runs from it)
releases/<sha>/       git archive of one commit + bun install + built dashboard; `.complete` is written last
current               symlink to the live release
data/                 deployed-sha, previous-sha (written only after a release is healthy), deploy.lock, err-log-offset
state/                the app's DATA_DIR (the Google / M365 OAuth token file); outside every release, survives deploys
```

The LaunchAgent `com.jkrumm.argo` (`deploy/com.jkrumm.argo.plist.template`) points at the release path, not at `current`; logs are
`~/Library/Logs/argo.{out,err}.log`. Non-secret config lives in the plist (`PORT=7737`, `HOST`, `DATA_DIR`, `DASHBOARD_DIR`,
`GIT_SHA`, `CRONS_ENABLED`, ...); secrets only through `.env.tpl` (op:// refs, resolved by `scripts/launch.sh`, which fails closed
with exit 78 unless every ref is non-empty and assembles `DATABASE_URL` for role `argo` on database `shared` and
`OTEL_EXPORTER_OTLP_HEADERS`). `DOCKER_VPS_URL` is deliberately unset: the VPS socket-proxy only listens on the VPS's Docker network,
so `/docker/vps/*` and the VPS half of `/summary` answer an error until a tailnet path exists; the homelab half reads `:2376`
(tailnet grant `tag:devhost` -> `tag:homelab`).

## make deploy

`make deploy` deploys what is on **origin/master** (push first), re-executes the release's own `scripts/deploy.sh` (the deploy lock stays held across the re-exec, `ARGO_DEPLOY_LOCK_HELD`), refuses before
anything is stopped if a `.env.tpl` ref does not resolve, and rolls back to the previous release when the new one is not healthy
within 120 s (a first deploy is left booted out instead of crash-looping). Releases beyond the newest three (plus live and
previous) are pruned. Dashboard bundle: `VITE_API_URL` empty (same-origin `/api`), `VITE_CONSOLE_URL` from `~/.argo/console-url` (the Console's origin, one line, machine-local, outside every release; a missing or invalid file builds a bundle without the Today page's Console link), `VITE_HYPERDX_ENDPOINT` empty (same-origin
`/v1/traces` + `/v1/logs`), the public ingestion key read through `secrets-run`. Deploys run on the Mac mini only (they need
`~/.local/bin/secrets-run` and `launchctl`). `make rollback` leaves `make verify` failing until the next deploy: the live sha is then,
by intent, not origin/master. Never roll back to a release older than `5b0c8596e9c1` (the cutover): the plist is rendered from
the release's own template, so an older one would restart with `CRONS_ENABLED=false`. Logic test (no launchd): `zsh scripts/test/deploy-logic.sh` (not part of `make check`).

## make verify

`make verify` is `scripts/verify.sh` against the **mini** copy (`http://127.0.0.1:7737`), exit 0 only if all hold: the LaunchAgent is
loaded; `GET /api/health` is ok and its `commit` equals `deployed-sha` equals `git ls-remote origin refs/heads/master` of the clone (it
fails, naming both, when origin/master moved ahead); `GET /` is the SPA and an `/assets/*` file it names is 200 with an immutable
`Cache-Control`; unauthenticated `GET /api/usage/summary` is 401; with the bearer,
`/api/usage/summary` (reads the `usage` schema), `/api/exercises` (reads the `argo` schema) and `/api/openapi/json` answer 200 JSON;
the stderr log has no `Unhandled`, `ECONNREFUSED … 5432` or `password authentication failed` line since the process started (the last `argo: process start` line `scripts/launch.sh` writes on every launchd start, else the log offset `make deploy` recorded; a crash-looped predecessor's lines do not count).
`make verify-pages [BASE=<origin>]` loads every route of `scripts/evidence/routes.txt` in a real Chrome (bearer from `secrets-run`,
reads only) and fails on an uncaught page error, a 5xx other than 503 or an empty page; 503s (Google / M365 without tokens) are listed as notes.
The mini door is `https://<mini-door-host>` (dotfiles Caddy registry, tailnet clients only); the process serves the SPA, `/api/*`
and the browser OTLP relay itself. Note that in dashboard mode only `/api/*` reaches the API, so probe `/api/health`, not `/health`.
`/health` returns `{status, commit}`, `commit` being the `GIT_SHA` in the plist; it is unauthenticated and does not touch the
database (see `docs/DEPLOY-VERIFICATION.md`).

## Evidence and design shots

`make evidence LABEL=<l>` is the real-data before/after baseline for UI work: it builds the dashboard,
serves `dist` on an ephemeral port with `/api` proxied to production (GETs only — any other method is
answered 405 and listed under `## blocked writes`, but does not fail the run), injects the bearer into `localStorage` (read via `secrets-run`, never
printed or written; the run aborts unless it authenticates), then runs the bundle / screens (13 routes × light/dark × desktop/mobile) /
lighthouse (median of 3) lanes. Output: `docs/waves/evidence/<l>.md`; raw screenshots and Lighthouse
JSON land in the gitignored `docs/waves/evidence/.raw/<l>/`. Needs `secrets-run` and a locally installed Google Chrome. Code: `scripts/evidence/`.

`make design-shot [ROUTES="/models /usage-tracking"] [LABEL=<l>] [SKIP_BUILD=1]` is the redesign loop's shot harness: same
GET-only production proxy as `make evidence` (the guarantee assumes dashboard GET endpoints are side-effect-free), every
route (default `scripts/evidence/routes.txt`) × dark/light × desktop 1440 / mobile 390 at DPR 2, plus one crop per
desktop card/table, into `.design-shots/<label>/` with an `index.html` board and `manifest.json`. The shots show real
personal data: `.design-shots/` is gitignored, never commit or upload the images. Code: `scripts/design-shot/`.

`bun scripts/design-shot/fixture-proxy.ts --fixture <fixture> [--port <n>]` (`goal`, `at-goal`, `weight-fresh`, `weight-no-rate`,
`skinfold-one`, `skinfold-close`, `skinfold-many`, `all`) is a loopback, GET-only `/api` proxy for `basalt-ui shot --dist <dist>
--api /api=http://127.0.0.1:<port>`: it answers synthetic goal-weight, weigh-in and skinfold data (the body-composition states
production cannot show) and forwards every other read to production, so its shots still carry real data and follow the
`.design-shots/` rules.

## The mini is live

On the mini `shared.argo` is the live database: `bun dev` refuses to start there (set `ARGO_DEV_ON_LIVE=1` to override) and
`bun db:sync` refuses it unconditionally. Develop UI work against `make evidence` / `make design-shot` (GET-only proxy to
production) or on a MacBook with its own local copy. `bun db:sync` (`scripts/db-sync.sh`) seeds that copy from the live mini
schema over `ssh mini`: one REPEATABLE READ READ ONLY snapshot with `default_transaction_read_only=on`, pg_dump plus per-table
rows + md5 from that snapshot, a local restore that commits only when every table matches, marked `argo dev copy ...`; a
local schema without that mark (or the older `argo rehearsal copy`) is replaced only with `FORCE=1`. `bun db:migrate` refuses the live database the same way as
`bun dev` (`scripts/live-guard.sh`, fail-closed: an unreadable mark also refuses).
