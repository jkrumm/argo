# Argo — Project Configuration

## What Argo Is

Personal dashboard + agent-backbone API for Johannes Krumm, deployed on the VPS at
`https://argo.jkrumm.com`. Health/training core: **Garmin Health** (HRV, resting HR, sleep,
stress, daily metrics, recovery score) and **Strength Tracker** (workouts, sets, e1RM, volume,
ACWR, PR detection, body weight) — a Garmin sync sidecar feeds health data every 6 hours, strength
data is logged manually. Alongside them: **Hermes Chat** (a Slack-shaped feed over Hermes threads
+ Slack channels, streamed through a thin idempotent proxy — `docs/HERMES-CHAT-V2.md`), a general
**AI Gateway** (`/ai/v1/*`, OpenAI-compatible, backs Argo's own thread-titling/classification —
not Hermes), **Slack** (read + post, split across two app identities — see "Slack" below),
**Usage Tracking** (Claude Code spend ingest from `usage-tracker`, delta-only), **Reading**
(Hardcover sync + reading stats), **M365 Explorer** (browse IU Teams chats/channels), **GitLab**
and **Atlassian** surfaces, **WalkingPad**, and the **Agents** page (below).

**Astro Window** answers "is tonight (or this week) worth going out for?" for Milky Way nightscapes. It is scored by a deterministic engine (`apps/api/src/lib/window-score.ts` — hard gates that name _why_ a night is out, plus weighted 0–1 factors) instantiated per domain (`astro-score.ts`). **The model never computes a number**: the ephemeris, the thresholds and the score are all deterministic, and `aiComplete()` only writes one sentence about an already-finished verdict — see `docs/ASTRO-WINDOW.md`.

The **marine** half of that feature exists **API-only**: `/marine/window` and `/marine/spots` run over the same engine (`marine-score.ts`, `marine-spots.ts`, `clients/marine-upstreams.ts`) and are tested, but the dashboard page was removed on 2026-08-18 — the surf face gets rebuilt deliberately, step by step, on top of the shipped endpoints.

The API doubles as an AI-agent endpoint. Discovery is anchored at three URLs: `GET /` returns a small JSON pointing at the docs and listing the tag groups, `GET /openapi` serves the Scalar interactive UI, and `GET /openapi/json` exposes the raw spec. The OpenAPI contract (paths, tag taxonomy, description quality) is the agent interface — see `apps/api/.claude/rules/openapi.md`. All routes require a bearer except `GET /hermes/health/public` (unauthenticated, `{ok, degraded}` only, for Uptime Kuma).

## Agents — the agent-gateway overview surface

`POST /agents/overview` ingests the agent-gateway overview payload (machine, generatedAt, optional
`humanQueue`) pushed every 10 minutes from every dev host; `GET /agents/overview[?machine=]` and
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

Validation and deploy entry points are `make check` / `make deploy` / `make verify` / `make logs` —
see [Validate](#validate), [Deploy](#deploy) and [Verify & Monitor](#verify--monitor) below.

**Dev infra prerequisite:** the local Postgres + ClickStack + Valkey come from `~/SourceRoot/vps/compose.dev.yml`. Start once with `cd ~/SourceRoot/vps && make up` (and `make postgres-setup` the first time to provision the `argo` role + schema). The `bun dev` command then connects to the shared cluster on `localhost:5432` and pipes OTel to ClickStack on `localhost:4318`.

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

# Integration tests (src/routes/*.test.ts) need the dev Postgres up; they are NOT part of CI:
bun test:api                                  # wraps secrets-run + assembles DATABASE_URL
bun test:api src/routes/workouts.summary.test.ts  # pass-through filter
```

## Deploy

API and dashboard run on the VPS via Docker. Push to `master` → RollHook → rolling restart — there
is **no manual deploy step**, so `make deploy` only confirms the CI path and exits 0. Compose:
`~/SourceRoot/vps/apps/argo/compose.yml`; the workflow is `.github/workflows/deploy.yml` (GitHub
OIDC → RollHook, images `argo-api` / `argo-dashboard`). Migrations apply automatically on API boot —
**there is no manual prod migrate step** (see `apps/api/AGENTS.md`).

The dashboard image is the static nginx build of the basalt-ui 2.x app (cutover 2026-10-14, `docs/waves/PLAN.md` Wave 10;
SSR is Wave 11). Rollback: `gh workflow disable deploy.yml`, then pin the previous image SHAs with `make argo-up` in `~/SourceRoot/vps`.

## Verify & Monitor

`make verify` probes the production health endpoint, which returns `{status, commit}`. `commit` is
the `GIT_SHA` baked into the api image by the deploy workflow, so a landed deploy is confirmed once
it equals `git rev-parse origin/master` (see `docs/DEPLOY-VERIFICATION.md`). The endpoint is
unauthenticated and does not touch the database.

- Full health URL: `https://argo.jkrumm.com/api/health`
- Uptime Kuma monitors (group `Argo`): `Argo / API - HTTP` (the `/api/health` probe), `Argo / Dashboard - HTTP`,
  and `Argo / Hermes - HTTP` (`GET /hermes/health/public`).
- OTel `service.name`: `argo-api` (via `OTEL_SERVICE_NAME`; the dashboard is `argo-dashboard`).
- Tail recent production logs: `make logs`.
- The dashboard image carries no SHA (its build only bakes `VITE_HYPERDX_API_KEY`), so only the API
  can be verified this way.

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

## Gotchas

- **`bun db:sync` wipes local data.** It uses `pg_dump --clean --if-exists`; run it _before_
  generating a new migration, never after — otherwise the unreleased migration is wiped from the
  local DB (re-run `bun db:migrate` to re-apply the committed SQL).
- **Never `op read`/`op run` on the Mac mini** — it hangs on a biometric prompt no one can answer.
  Use the `secrets-run` shim there (live `op` on the MacBook, headless cache on the mini).
- **Prod OAuth tokens are per-grant runtime state**, not env or 1Password: local
  `apps/api/data/oauth-tokens.json`, prod `/var/lib/argo/data/oauth-tokens.json` (survives
  redeploys). Google features only work on prod or `bun dev:prod-api`.
- **`make logs` assumes the container is named `argo-api`**, taken from the deploy image name; if
  the VPS compose service differs, adjust the target.

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
cd ~/SourceRoot/vps && make up && cd -   # Postgres 18 + ClickStack + Valkey (once per boot)
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

<!-- basalt:begin 2.27.0 -->

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
