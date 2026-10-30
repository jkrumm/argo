# Argo — Project Configuration

## What Argo Is

Personal dashboard + agent-backbone API for Johannes Krumm, deployed on the VPS at
`https://argo.jkrumm.com`. Health/training core: **Garmin Health** (HRV, resting HR, sleep,
stress, daily metrics, recovery score) and **Strength Tracker** (workouts, sets, e1RM, volume,
ACWR, PR detection, body weight) — Argo pulls health data every 6 hours straight from the official Garmin Connect Personal API (a personal API key, `GARMIN_API_KEY`), strength
data is logged manually. Alongside them: a general
  an in-process `aiComplete` (`lib/ai-complete.ts`, no HTTP route; backs classification and the astro/marine verdict sentences), **Slack** (read + post, split across two app identities — see "Slack" below),
  **Usage Tracking** (Claude Code and gateway spend, read from the `usage` schema in the shared database: `usage-tracker` and `agw` write it directly, Argo has no ingest endpoint and reads `usage.records_unique` through the projection `src/lib/usage-source.ts`; each record carries the Claude `account` — `iu`/`me`/`me2`, null off Max billing — filterable on every `/usage` endpoint and a breakdown/groupBy dimension; IU API rows also carry the IU key `iu_key` — `personal`/`athena-team`, each with its own $500 cap, `iuKey` filter and `iu_key` dimension on the records endpoints, `?iuKey` on `iu-budget`/`iu-reconcile`; the **payer** — `iu-sub`/`me-sub`/`me2-sub`/`iu-api`/`iu-team-api`/`me-api`/`unknown`, derived from billing + account + iu_key in the query layer — is the usage page's default split and filter); also Claude account quota samples (`GET /usage/quota`, `GET /usage/quota-latest`, from `usage.quota_samples`) and picker decisions (`GET /usage/account-picks/summary`, from `usage.account_picks`), IU's portal cost report (`usage.iu_portal_cost`, read by `GET /usage/{iu-budget,iu-reconcile}`) plus the `flow` and `movers` aggregates (apps/api/AGENTS.md §Usage page data), shown on the usage page (three tabs: **Overview** — one card per wallet (a Max subscription per account in the registry `features/usage-tracking/accounts.ts`, the IU API) with its limit meter, $ at API prices (list value or spend) and fresh tokens as two equal figures with cache-read under the tokens, a daily sparkline and a "mostly …" line, then weekly volume per subscription over the whole history beside the weekly-quota sawtooth, the weekday × hour rhythm, and Projects / Tools rows with an inline sparkline each that open a daily timeline; **Claude Max** — the subscriptions compared and summed (plan price, list value, value multiple, tokens, active days, quota peak), weekly quota with this week's pace, volume, rhythm and ranked projects / tools / models, scoped by an Account control, and a **Routing** section for tuning the account picker (facts strip, who served each lane, reason mix and spill rate per lane, the 5 h quota with the session ceiling and resets, per-account expired-capacity table; own range control, not filtered by Account; data from `GET /usage/account-picks`, `/usage/account-picks/summary`, `/usage/routing/windows`, `/usage/quota`); **IU API** — cap meter, share of spend with no project, portal-vs-tracked, figures, ranked lists and cost per 1 M; `$` / tokens measure; data from `GET /usage/split`, `/usage/timeseries` (`project[]` filter), `/usage/rhythm`, `/usage/quota`; spec `docs/design/usage-tracking.md`), **Reading**
  (Hardcover sync + reading stats), **M365 Explorer** (browse IU Teams chats/channels), **GitLab**
  and **Atlassian** surfaces, **WalkingPad**, and the **Agents** page (below).

**Astro Window** answers "is tonight (or this week) worth going out for?" for Milky Way nightscapes. It is scored by a deterministic engine (`apps/api/src/lib/window-score.ts` — hard gates that name _why_ a night is out, plus weighted 0–1 factors) instantiated per domain (`astro-score.ts`). **The model never computes a number**: the ephemeris, the thresholds and the score are all deterministic, and `aiComplete()` only writes one sentence about an already-finished verdict — see `docs/ASTRO-WINDOW.md`.

The **marine** half of that feature exists **API-only**: `/marine/window` and `/marine/spots` run over the same engine (`marine-score.ts`, `marine-spots.ts`, `clients/marine-upstreams.ts`) and are tested, but the dashboard page was removed on 2026-08-18 — the surf face gets rebuilt deliberately, step by step, on top of the shipped endpoints.

The API doubles as an AI-agent endpoint. Discovery is anchored at three URLs: `GET /` returns a small JSON pointing at the docs and listing the tag groups, `GET /openapi` serves the Scalar interactive UI, and `GET /openapi/json` exposes the raw spec. The OpenAPI contract (paths, tag taxonomy, description quality) is the agent interface — see `apps/api/.claude/rules/openapi.md`. All routes require a bearer except the health probe (see Verify & Monitor).

## Agents — the agent-workflows overview surface

`POST /agents/overview` ingests the overview payload (machine, generatedAt, optional
`humanQueue`) pushed every 10 minutes from every dev host by agent-workflows (the `agw` overview
workflow); `GET /agents/overview[?machine=]` and
`/agents/overview/history?hours=` (max 168) read it back — raw jsonb, loosely validated, 7-day
retention pruned on ingest. `POST`/`GET /agents/narratives` stores the per-project narrative
upserts from `hermes-agent`'s `project-narratives.py`. The dashboard's **System → Agents** page
(`/agents`) is the one surface for all of it: a summary sentence, a needs-you / oldest-wait / fleet
strip, Needs-you decision cards (copy-only, no writes), one card per active project, a 24 h activity
strip, day-grouped narratives, a 30-minute stale banner; polls Argo every 60s
(`docs/design/agents.md`). Table owner: `apps/api/src/db/schema.ts` (`agent_overview_snapshots`,
`agent_narratives`).

## Warden — the control-plane board

`POST /warden/snapshot` ingests a JSON snapshot pushed by Warden (the mini's deterministic loop
over its own SQLite ledger) after every loop tick, roughly every 10 minutes — Argo on the VPS
cannot reach that ledger directly. `GET /warden/snapshot[?machine=]` reads the latest push back.
Same contract as Agents: raw jsonb, validated loosely, 7-day retention pruned on ingest, Argo
derives nothing. The payload carries health/poller liveness, the six funnel metrics (each leaf a
`{value, unavailable}` pair — `value: null` always pairs with a non-empty `unavailable` reason,
**never** rendered as 0), the board (state counts + open items), the dispatch budget, per-item
timelines (transitions, dispatches, operations). The dashboard's **System → Warden** page
(`/warden`) is the one surface for all of it: a summary sentence and health strip, "Needs you"
(`needs_decision`) and "Failed" decision cards (one primary, one secondary, the other verbs in a
menu), then one board where every other item appears exactly once (`docs/design/warden.md`). Table owner:
`apps/api/src/db/schema.ts` (`warden_snapshots`).

## Slack

Argo posts under its own app identity but reads through HomeLab's — `slack/README.md` has the
full split and the token-scope story. The three refs: `SLACK_BOT_TOKEN` (posts as Argo),
`SLACK_READ_TOKEN` (reads as HomeLab), `SLACK_USER_TOKEN` (search only) — all `op://common/slack/*`.

## Workspace Layout

```
argo/
├── apps/api/          — Elysia + Bun + Postgres + Drizzle + Zod + OTel
└── apps/dashboard/    — Vite + React 19 + Mantine v9 + TanStack Router/Query
```

## Common Commands

```bash
bun install                                    # all workspace deps

# Dev — runs API + dashboard concurrently with secrets injected via secrets-run (op/cache)
bun dev                                        # API :4040, dashboard https://argo.test (→ :7715)
bun db:sync                                    # pull fresh argo schema dump from VPS into local Postgres
bun db:migrate                                 # apply pending Drizzle migrations against local DB

# Single-app
bun run --cwd apps/api start                  # API on :4040 (needs secrets-run/op wrapper for env)
bun run --cwd apps/api db:generate            # generate migration after schema changes
```

Validation and deploy entry points are `make check` / `make deploy` / `make verify` / `make rollback` / `make logs` —
see [Validate](#validate), [Deploy](#deploy) and [Verify & Monitor](#verify--monitor) below.

**Dev infra prerequisite:** the local Postgres + ClickStack come from `~/SourceRoot/vps/compose.dev.yml`. Start once with `cd ~/SourceRoot/vps && make up` (and `make postgres-setup` the first time to provision the `argo` role + schema). The `bun dev` command then connects to the shared cluster on `localhost:5432` and pipes OTel to ClickStack on `localhost:4318`.

## Validate

`make check` runs exactly the gates CI runs on every PR and on push to `master`
(`.github/workflows/check.yml`): basalt managed-file drift, then `oxlint` + `check-theme`, then
`oxfmt --check`, then both workspace typechecks, then the DB-free unit tests. Non-zero on the first
failure; no side effects.

```bash
./node_modules/.bin/basalt-ui sync --check    # managed files match the installed basalt-ui
bun run lint                                  # oxlint + basalt-ui check-theme
bun run format:check                          # oxfmt
bun run --cwd apps/api typecheck
bun run --cwd apps/dashboard typecheck

# Unit tests (pure logic, no DB connection) — placeholders satisfy the env schema for module init:
DATABASE_URL=postgres://localhost:5432/placeholder API_SECRET=ci-placeholder \
  bun --cwd apps/api test src/env.test.ts src/lib/

# Integration tests (src/routes/*.test.ts, src/db/*.test.ts) need the mini's Postgres up; NOT part of CI.
# `bun test:api` creates a scratch database argo_test_<hex> as admin (secrets-run, apps/api/.env.test.tpl),
# applies usage-tracker's migrations/pg for schema `usage` (USAGE_MIGRATIONS_DIR overrides the path),
# runs the suite there and drops it:
bun test:api
bun test:api src/routes/workouts.summary.test.ts  # pass-through filter
```

## Deploy

During the migration Argo has **two live deploy paths**; both must keep working until a later wave retires the first.

- **VPS (Docker, RollHook)** — the production copy at `https://argo.jkrumm.com`. Push to `master` → `.github/workflows/deploy.yml`
  (GitHub OIDC → RollHook, images `argo-api` / `argo-dashboard`) → rolling restart, no manual step. Compose:
  `~/SourceRoot/vps/apps/argo/compose.yml`. Rollback: `gh workflow disable deploy.yml`, then pin the previous image SHAs with
  `make argo-up` in `~/SourceRoot/vps`. The `Dockerfile`s and the workflow stay untouched until that wave.
- **Mini (native, no Docker)** — the same model as agent-workflows: `make deploy` builds origin/master into an immutable release
  and switches a LaunchAgent to it. This copy runs on rehearsal data (the shared database) beside the VPS copy, with
  `CRONS_ENABLED=false` in the plist; crons turn on at the cutover wave by editing that one value.

Migrations apply automatically on API boot on both paths — **there is no manual prod migrate step** (see `apps/api/AGENTS.md`).

### Mini layout (`~/.argo`, `ARGO_ROOT` relocates it for tests)

```
repo/                 fetch-only clone (nothing runs from it)
releases/<sha>/       git archive of one commit + bun install + built dashboard; `.complete` is written last
current               symlink to the live release
data/                 deployed-sha, previous-sha (written only after a release is healthy), deploy.lock, err-log-offset
state/                the app's DATA_DIR (OAuth token files ...); outside every release, survives deploys
```

The LaunchAgent `com.jkrumm.argo` (`deploy/com.jkrumm.argo.plist.template`) points at the release path, not at `current`; logs are
`~/Library/Logs/argo.{out,err}.log`. Non-secret config lives in the plist (`PORT=7737`, `HOST`, `DATA_DIR`, `DASHBOARD_DIR`,
`GIT_SHA`, `CRONS_ENABLED`, ...); secrets only through `.env.tpl` (op:// refs, resolved by `scripts/launch.sh`, which fails closed
with exit 78 unless every ref is non-empty and assembles `DATABASE_URL` for role `argo` on database `shared` and
`OTEL_EXPORTER_OTLP_HEADERS`). GOOGLE_*, GARMIN_HEARTBEAT_URL and DOCKER_* are not in `.env.tpl` yet (cutover wave).

```bash
make deploy              # fetch origin/master, build the release, check the refs, switch, wait for /api/health at the new sha
DRY_RUN=1 make deploy    # print the plan and the rendered plist, touch nothing
make verify              # see Verify & Monitor
make rollback            # previous-sha goes live (exit 1 if it cannot); the markers swap, so a second rollback goes forward
make logs                # last 200 lines of argo.out.log / argo.err.log
```

`make deploy` deploys what is on **origin/master** (push first), re-executes the release's own `scripts/deploy.sh`, refuses before
anything is stopped if a `.env.tpl` ref does not resolve, and rolls back to the previous release when the new one is not healthy
within 120 s (a first deploy is left booted out instead of crash-looping). Releases beyond the newest three (plus live and
previous) are pruned. Dashboard bundle: `VITE_API_URL` empty (same-origin `/api`), `VITE_HYPERDX_ENDPOINT` empty (same-origin
`/v1/traces` + `/v1/logs`), the public ingestion key read through `secrets-run`. Deploys run on the Mac mini only (they need
`~/.local/bin/secrets-run` and `launchctl`). `make rollback` leaves `make verify` failing until the next deploy: the live sha is then,
by intent, not origin/master. Logic test (no launchd): `zsh scripts/test/deploy-logic.sh` (not part of `make check`).

The VPS dashboard image is the static nginx build of the basalt-ui 2.x app (cutover 2026-10-14, `docs/waves/PLAN.md` Wave 10;
SSR is Wave 11).

## Verify & Monitor

`make verify` is `scripts/verify.sh` against the **mini** copy (`http://127.0.0.1:7737`), exit 0 only if all hold: the LaunchAgent is
loaded; `GET /api/health` is ok and its `commit` equals `deployed-sha` equals `git ls-remote origin refs/heads/master` of the clone (it
fails, naming both, when origin/master moved ahead); `GET /` is the SPA and an `/assets/*` file it names is 200 with an immutable
`Cache-Control`; unauthenticated `GET /api/usage/summary` is 401; with the bearer,
`/api/usage/summary` (reads the `usage` schema), `/api/exercises` (reads the `argo` schema) and `/api/openapi/json` answer 200 JSON;
the stderr log has no `Unhandled`, `ECONNREFUSED … 5432` or `password authentication failed` line since the process started.
`make verify-pages [BASE=<origin>]` loads every route of `scripts/evidence/routes.txt` in a real Chrome (bearer from `secrets-run`,
reads only) and fails on an uncaught page error, a 5xx other than 503 or an empty page; 503s (Google / M365 without tokens) are listed as notes.
The mini door is `https://argo-live.mini.jkrumm.com` (dotfiles Caddy registry, tailnet clients only); the process serves the SPA, `/api/*`
and the browser OTLP relay itself. Note that in dashboard mode only `/api/*` reaches the API, so probe `/api/health`, not `/health`.
`/health` returns `{status, commit}`, `commit` being the `GIT_SHA` in the plist; it is unauthenticated and does not touch the
database (see `docs/DEPLOY-VERIFICATION.md`).

- VPS health URL (RollHook path): `https://argo.jkrumm.com/api/health`
- Uptime Kuma monitors (group `Argo`): `Argo / API - HTTP` (the `/api/health` probe), `Argo / Dashboard - HTTP`.
- OTel `service.name`: `argo-api` (via `OTEL_SERVICE_NAME`; the dashboard is `argo-dashboard`).
- Mini logs: `make logs`. VPS logs: `ssh vps 'docker logs --tail 200 <argo-api container>'`.
- On the VPS the dashboard image carries no SHA (its build only bakes `VITE_HYPERDX_API_KEY`), so only the API can be verified there.

`make evidence LABEL=<l>` is the real-data before/after baseline for UI work: it builds the dashboard,
serves `dist` on an ephemeral port with `/api` proxied to production (GETs only — any other method is
answered 405 and listed under `## blocked writes`, but does not fail the run), injects the bearer into `localStorage` (read via `secrets-run`, never
printed or written; the run aborts unless it authenticates), then runs the bundle / screens (13 routes × light/dark × desktop/mobile) /
lighthouse (median of 3) lanes. Output: `docs/waves/evidence/<l>.md`; raw screenshots and Lighthouse
JSON land in the gitignored `docs/waves/evidence/.raw/<l>/`. Needs `secrets-run` and a locally installed Google Chrome. Code: `scripts/evidence/`.

`make design-shot [ROUTES="/agents /warden"] [LABEL=<l>] [SKIP_BUILD=1]` is the redesign loop's shot harness: same
GET-only production proxy as `make evidence` (the guarantee assumes dashboard GET endpoints are side-effect-free), every
route (default `scripts/evidence/routes.txt`) × dark/light × desktop 1440 / mobile 390 at DPR 2, plus one crop per
desktop card/table, into `.design-shots/<label>/` with an `index.html` board and `manifest.json`. The shots show real
personal data: `.design-shots/` is gitignored, never commit or upload the images. Code: `scripts/design-shot/`.

`bun scripts/design-shot/fixture-proxy.ts --fixture <fixture> [--port <n>]` (`goal`, `at-goal`, `weight-fresh`, `weight-no-rate`,
`skinfold-one`, `skinfold-close`, `skinfold-many`, `all`) is a loopback, GET-only `/api` proxy for `basalt-ui shot --dist <dist>
--api /api=http://127.0.0.1:<port>`: it answers synthetic goal-weight, weigh-in and skinfold data (the body-composition states
production cannot show) and forwards every other read to production, so its shots still carry real data and follow the
`.design-shots/` rules.

## Gotchas

- **`bun db:sync` wipes local data.** It uses `pg_dump --clean --if-exists`; run it _before_
  generating a new migration, never after — otherwise the unreleased migration is wiped from the
  local DB (re-run `bun db:migrate` to re-apply the committed SQL).
- **Never `op read`/`op run` on the Mac mini** — it hangs on a biometric prompt no one can answer.
  Use the `secrets-run` shim there (live `op` on the MacBook, headless cache on the mini).
- **Prod OAuth tokens are per-grant runtime state**, not env or 1Password: local
  `apps/api/data/oauth-tokens.json`, prod `/var/lib/argo/data/oauth-tokens.json` (survives
  redeploys). Google features only work on prod or `bun dev:prod-api`.
- **`make verify` fails after `make rollback`** until the next deploy, by design (the live sha is not origin/master).

## Secrets

All secrets via 1Password, account `tkrumm`. DB password at `op://vps/argo/DB_PASSWORD`.

Local-dev scripts (`dev`, `db:migrate`, `test:api`) inject through the **`secrets-run`** shim
(dotfiles): a drop-in `op` — live biometric `op` on the MacBook, the age-encrypted headless
cache on the Mac mini (where `op` isn't interactively signed in). Prod scripts (`dev:prod-api`,
`m365:auth:prod`) stay on raw `op run` — present-human only.

```bash
secrets-run run --env-file=apps/api/.env.local.tpl -- <command>   # local dev (op or cache)
secrets-run read op://vps/argo/DB_PASSWORD                        # single value (op or cache)
op run --account tkrumm --env-file=apps/api/.env.local.tpl -- <command>   # force live op (prod)
```

## Local Dev

```bash
cd ~/SourceRoot/vps && make up && cd -   # Postgres 18 + ClickStack (once per boot)
bun db:sync                              # optional: refresh local data from VPS
bun dev                                  # API :4040 + dashboard :7715 (https://argo.test via dotfiles Caddy)
```

The dashboard proxies `/api/*` to the API (strips `/api` prefix) and `/v1/traces` + `/v1/logs` to ClickStack on `:4318`.

## Design System

**`basalt-ui` is now Argo's design system** — the Mantine theme, chart primitives (`basalt-ui/charts`),
tokens (`basalt-ui/tokens`), and toolchain presets (oxlint/oxfmt/lefthook) all come from the
framework. Argo is `basalt-ui`'s original reference consumer; the local `packages/charts` package
and hand-rolled `DESIGN.md`/theming docs it used to carry have been retired in favor of the
framework's agentic layer (`bunx basalt-ui init`/`sync`, the `.claude/rules/basalt-*.md` doctrine, and
the managed `/basalt-design` / `/basalt-charts` skills in `.claude/skills/`).

**`DESIGN.md` (repo root) is Argo's app-delta record** — not the law itself anymore, but the
project-specific deltas on top of basalt's defaults (accent hue, series dictionary). It is a basalt
`seed` file: written once by `basalt-ui init`, then owned by Argo — `basalt-ui sync` never overwrites it.
Read it before building or restyling any UI. The pre-basalt `DESIGN.md`/`MANTINE-THEMING.md` era
was retired 2026-09-07; basalt-ui's own theming docs (shipped with the framework) are the reference.

## Workspace-Specific Docs

| File                       | Contents                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `DESIGN.md`                | Argo's app-delta record: accent hue, series dictionary, deviations from basalt defaults |
| `apps/api/AGENTS.md`       | DB, migrations, adding a route, test patterns, OTel vars                                |
| `apps/dashboard/AGENTS.md` | Adding a page, stack details, React Compiler, observability                             |

## Analytics Reference

- `docs/GARMIN-HEALTH.md` — metric definitions, formulas, composite signals (health page)
- `docs/ASTRO-WINDOW.md` — the astro + marine window planner: status per piece, the response contract, every decision taken during the build (D1–D11), what is still unverified
- `docs/ASTRO-MAP-RESEARCH.md` — **shipped**: `/astro/light-pollution` + `/astro/skyglow` (point-lookup), `GET /astro/tiles/lp/{year}/{z}/{x}/{y}.png` (the terrarium-encoded raster tile route), and the Map tab — basemap/imagery catalogue, the light-pollution ramp overlay, a global weather layer catalogue (RainViewer radar, decoded EUMETSAT cloud products, NASA GIBS infrared, Open-Meteo model forecasts) and the settings drawer. The decision record: light-pollution sources and licences, the Lorenz binary-tile decode, a direction-resolved skyglow model, terrain horizons, cloud/weather source selection and two shipped-then-fixed rendering bugs (§9–§10). POC scripts in `docs/poc/astro-map/` (lint-excluded) reproduce every number in it
- `docs/ASTRO-HORIZON-RESEARCH.md` — the terrain-horizon rebuild, **shipped in five phases**. `GET /astro/horizon` serves the per-azimuth near/far-split skyline (`lib/terrain-horizon.ts`'s `horizonProfile`/`horizonAt`) for an arbitrary coordinate from the AWS terrarium DEM (`clients/terrarium-dem.ts`); `/astro/window`'s per-night gate is `max(8°, farHorizon(coreAzimuth) + 2°)`, evaluated per sample rather than once per night, and the moon counts as down when it sits behind that same skyline (`resolveNight` in `lib/astro-night.ts`); `GET /astro/visibility` (`lib/astro-visibility.ts`'s `annualVisibility`) integrates a whole calendar year on a 10-minute grid into the deterministic, weather-free annual budget — "is this spot worth the drive at all" — under three progressively honest gates (`flat`/`terrain`/`terrainMoon`). On the dashboard, the **Forecast** tab carries the sky panorama (`charts/sky-panorama.tsx` — terrain silhouette, skyglow rose and the sun/moon/core tracks on one azimuth × altitude pair of axes, with the gate drawn and the clearing segment emphasised) plus the monthly budget chart, and the **Map** tab carries hillshade + optional 3D terrain off one shared terrarium `raster-dem` source and click-anywhere scouting (`components/scout-panel.tsx`, comparing any coordinate against the selected site). **Not built:** the §5 clearance raster layer — measured at 0.34 ms/cell and rasterable, but no tile route exists. The record: the PVGIS validation, why the near field (≤500 m) is DEM-unstable and ships advisory-only, what terrain does to the core and to moonlight, the annual-budget numbers that reorder the site ranking 16× under a terrain-aware gate, and the re-verified library landscape (`astronomy-engine` is upstream-abandoned, `suncalc` 2.0 is now viable for sun/moon only). POC scripts in `docs/poc/astro-horizon/` reproduce every number in it
- `docs/STRENGTH-ANALYTICS.md` — metric definitions, INOL, ACWR, e1RM formulas (strength page)

## Design System — agent pointer

Read `DESIGN.md` (repo root) before any UI work — it is the app-delta record and highest-precedence
design law. The basalt-ui doctrine lives in `.claude/rules/basalt-*.md` (six rules, all law) and the
framework-managed block at the end of this file (written by `basalt-ui sync`; `sync --check` gates it
in CI). Precedence: `DESIGN.md` > the
`basalt-*` rules > the `basalt-*` skills.

<!-- basalt:begin 2.27.2 -->

## basalt-ui (managed — do not hand-edit)

Placed by `basalt-ui init`, refreshed by `basalt-ui sync` (`--check` gates drift in CI); edit `DESIGN.md`, not this block.

**Stack:** React 19 + Mantine v9 via `basalt-ui` (`BasaltProvider`, `BasaltShell`), TanStack Router and
Query, TanStack Charts via `basalt-ui/charts`, Bun, oxlint + oxfmt, no Tailwind. Color is `VX.*` or a
series token, never a literal.

**Precedence** (highest wins): consumer `DESIGN.md` > the six shipped `basalt-*` rules in
`.claude/rules/` > the `basalt-*` skills. Each rule bullet ends in the lint rule, guard kind or type
that enforces it; skills are procedure, not law.

**Run the local bin** (`./node_modules/.bin/basalt-ui` or a package script), never `bunx`; `init` is
the one exception. In a workspace: the app package's `node_modules/.bin/basalt-ui`.

**Before guessing an import, read the installed `llms.txt`** at the install directory (in a workspace,
under the depending package; `basalt-ui doctor` prints where; a fresh worktree needs `bun install` first).

**Skills and subagent** (installed in `.claude/`; invoke by name):

- `/basalt-app`: scaffold, wire, upgrade or verify the app (`init`, `doctor`, `sync`).
- `/basalt-design`: build or restyle a screen — scenario, `basalt-ui shot` rounds, review, revise; routes to its `references/` on demand.
- `/basalt-charts`: add or extend a chart, register its series colors.
- `basalt-design-reviewer` (subagent): scores a `basalt-ui shot` out dir per component; run it after every shot round, never on your own work.

@./DESIGN.md

**Restraint override (supersedes `/frontend-design`).** This is a calm, data-dense professional
surface: no "bold aesthetic direction", gradient meshes, grain or dramatic motion. Neutral by default,
the single accent spent only when earned.

**Chart override.** `/basalt-design`, `/basalt-charts` and the `basalt-charts` rule supersede any global chart rule and
the bundled `/dataviz` skill (its palette, marks, forms yield to basalt's tokens, catalogue, guards): compose `CartesianChart`.

<!-- basalt:end -->
