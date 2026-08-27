# Argo — Project Configuration

## What Argo Is

Personal homelab dashboard for Johannes Krumm. The health/training core is **Garmin Health** (HRV, resting HR, sleep, stress, daily metrics, recovery score) and **Strength Tracker** (workouts, sets, e1RM, volume, ACWR, PR detection, body weight), alongside **M365 Explorer** (browse IU Teams chats + channels, label important ones to drive `GET /m365/important`) and the other surfaces in the sidebar. A Garmin sync sidecar feeds health data every 6 hours; strength data is logged manually.

**Astro Window** answers "is tonight (or this week) worth going out for?" for Milky Way nightscapes. It is scored by a deterministic engine (`apps/api/src/lib/window-score.ts` — hard gates that name _why_ a night is out, plus weighted 0–1 factors) instantiated per domain (`astro-score.ts`). **The model never computes a number**: the ephemeris, the thresholds and the score are all deterministic, and `aiComplete()` only writes one sentence about an already-finished verdict — see `docs/ASTRO-WINDOW-BRIEF.md` and `docs/ASTRO-WINDOW-PROGRESS.md`.

The **marine** half of that feature exists **API-only**: `/marine/window` and `/marine/spots` run over the same engine (`marine-score.ts`, `marine-spots.ts`, `clients/marine-upstreams.ts`) and are tested, but the dashboard page was removed on 2026-08-18 — the surf face gets rebuilt deliberately, step by step, on top of the shipped endpoints.

The API doubles as an AI-agent endpoint. Discovery is anchored at three URLs: `GET /` returns a small JSON pointing at the docs and listing the tag groups, `GET /openapi` serves the Scalar interactive UI, and `GET /openapi/json` exposes the raw spec. The OpenAPI contract (paths, tag taxonomy, description quality) is the agent interface — see `apps/api/.claude/rules/openapi.md`.

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
bun run --cwd apps/api typecheck
bun run --cwd apps/dashboard typecheck

# Tests — wraps secrets-run + assembles DATABASE_URL (needs dev Postgres up)
bun test:api                                  # all API tests
bun test:api src/routes/workouts.summary.test.ts  # pass-through filter

# Root (all workspaces)
bun run lint                                  # oxlint
bun run format:check                          # oxfmt
```

**Dev infra prerequisite:** the local Postgres + ClickStack + Valkey come from `~/SourceRoot/vps/compose.dev.yml`. Start once with `cd ~/SourceRoot/vps && make up` (and `make postgres-setup` the first time to provision the `argo` role + schema). The `bun dev` command then connects to the shared cluster on `localhost:5432` and pipes OTel to ClickStack on `localhost:4318`.

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

## Production

API and dashboard run on the VPS via Docker. Compose: `~/SourceRoot/vps/apps/argo/compose.yml`. Push to `master` → RollHook → rolling restart.

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
Read it before building or restyling any UI. `docs/MANTINE-THEMING.md` is **superseded** by
basalt-ui's own theming docs (shipped with the framework) and kept only as historical reference —
see `docs/archive/`.

## Workspace-Specific Docs

| File                       | Contents                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `DESIGN.md`                | Argo's app-delta record: accent hue, series dictionary, deviations from basalt defaults |
| `apps/api/CLAUDE.md`       | DB, migrations, adding a route, test patterns, OTel vars                                |
| `apps/dashboard/CLAUDE.md` | Adding a page, stack details, React Compiler, observability                             |

## Analytics Reference

- `docs/GARMIN-HEALTH.md` — metric definitions, formulas, composite signals (health page)
- `docs/ASTRO-WINDOW-BRIEF.md` / `docs/ASTRO-WINDOW-PROGRESS.md` — the astro + marine window planner: the decided design, the measured acceptance numbers, and every decision taken during the build
- `docs/ASTRO-MAP-RESEARCH.md` — **shipped**: `/astro/light-pollution` + `/astro/skyglow` (the point-lookup endpoints), `GET /astro/tiles/lp/{year}/{z}/{x}/{y}.png` (the terrarium-encoded raster tile route the map paints), and the Map tab itself — basemap/imagery catalogue, the light-pollution ramp overlay, live weather layers and the settings drawer. The decision record for the map rebuild: light-pollution sources and their licences, the Lorenz binary-tile decode, a direction-resolved skyglow model that re-orders the site ranking, terrain horizons, aerosols vs 7Timer, inter-model cloud disagreement, and the verified overlay/basemap endpoints. **§9 is the 2026-08-19 rebuild**: the settings surface is now a docked collapsible panel (not an overlay drawer), the pollution ramp takes a sensitivity window as well as an opacity, the hillshade's shadow/highlight are achromatic `series.ts` vars (palette tokens collapsed the relief) with a `hillshade-method` control, and the weather catalogue is global — RainViewer radar, EUMETSAT cloud mask decoded through `raster-dem` `encoding: 'custom'` into our own transparent ramp, cloud-top height, the MTG-I lightning imager, and NASA GIBS infrared for the hemisphere the Meteosat discs miss. **§10 is the 2026-08-20 round**: the hillshade was never broken, it was drawn UNDER the near-opaque pollution ramp — relief and contours now sit above it (base 0 → ramp 15 → hillshade 16 → contours 17 → trails 18 → weather 20+), which also fixes "topographic and light pollution don't blend"; and the EUMETSAT cloud mask is a 4-class CATEGORICAL product, so it is blocky by construction and no resampling setting fixes it — the Windy-class answer is NWP model cloud, which is also the only way any layer gets a forecast. POC scripts in `docs/poc/astro-map/` (lint-excluded) reproduce every number in it
- `docs/ASTRO-HORIZON-RESEARCH.md` — the terrain-horizon rebuild, **shipped in five phases**. `GET /astro/horizon` serves the per-azimuth near/far-split skyline (`lib/terrain-horizon.ts`'s `horizonProfile`/`horizonAt`) for an arbitrary coordinate from the AWS terrarium DEM (`clients/terrarium-dem.ts`); `/astro/window`'s per-night gate is `max(8°, farHorizon(coreAzimuth) + 2°)`, evaluated per sample rather than once per night, and the moon counts as down when it sits behind that same skyline (`resolveNight` in `lib/astro-night.ts`); `GET /astro/visibility` (`lib/astro-visibility.ts`'s `annualVisibility`) integrates a whole calendar year on a 10-minute grid into the deterministic, weather-free annual budget — "is this spot worth the drive at all" — under three progressively honest gates (`flat`/`terrain`/`terrainMoon`). On the dashboard, the **Forecast** tab carries the sky panorama (`charts/sky-panorama.tsx` — terrain silhouette, skyglow rose and the sun/moon/core tracks on one azimuth × altitude pair of axes, with the gate drawn and the clearing segment emphasised) plus the monthly budget chart, and the **Map** tab carries hillshade + optional 3D terrain off one shared terrarium `raster-dem` source and click-anywhere scouting (`components/scout-panel.tsx`, comparing any coordinate against the selected site). **Not built:** the §5 clearance raster layer — measured at 0.34 ms/cell and rasterable, but no tile route exists. The record: the PVGIS validation, why the near field (≤500 m) is DEM-unstable and ships advisory-only, what terrain does to the core and to moonlight, the annual-budget numbers that reorder the site ranking 16× under a terrain-aware gate, and the re-verified library landscape (`astronomy-engine` is upstream-abandoned, `suncalc` 2.0 is now viable for sun/moon only). POC scripts in `docs/poc/astro-horizon/` reproduce every number in it
- `docs/STRENGTH-ANALYTICS.md` — metric definitions, INOL, ACWR, e1RM formulas (strength page)

<!-- basalt:begin 1.26.0 -->

## basalt-ui (managed — do not hand-edit)

Placed by `bunx basalt-ui init` and refreshed by `basalt-ui sync` after every upgrade
(`sync --check` gates drift in CI). Framework-owned: edit `DESIGN.md` or your own files instead —
changes here are overwritten on the next sync.

**Stack:** React 19 + Mantine v9, themed by `basalt-ui` (`BasaltProvider` + `createBasaltTheme`), Bun
runtime, oxlint + oxfmt (no ESLint/Biome/Prettier), no Tailwind. Color comes from the three-tier
`--vx-*` token system — read `VX.*` or a series token, never a raw hex/`rgb()`/`hsl()`. Charts are
visx via `basalt-ui/charts`. `basalt-ui check-theme` plus the `basalt/*` oxlint rules are the teeth.

**Precedence — the only statement of it.** Highest wins; a lower layer fills gaps and never
overrides a higher one:

> consumer `DESIGN.md` (app deltas) > the six shipped `basalt-*` rules > the `basalt-*` skills

**All six rules are law** — `basalt-tokens`, `basalt-mantine`, `basalt-charts`, `basalt-state`,
`basalt-controls`, `basalt-batteries` in `.claude/rules/`, each carrying a generated
`<!-- basalt:coverage -->` header naming what enforces it and what is only advisory. The skills
(`/basalt-app`, `/basalt-design`, `/basalt-charts`) are the METHOD that obeys them, never law.

**Run the LOCAL bin, not `bunx`** — `./node_modules/.bin/basalt-ui`, or a `package.json` script.
`bunx` does not re-resolve a cached package, so it can answer for a version you upgraded away from;
`init` is the one legitimate `bunx` invocation, because nothing is installed yet.

**Before guessing an import, read the installed package's machine docs** — `llms.txt` (per-subpath
import map) and `AGENTS.md`, at the install directory. In a workspace that is under the package that
depends on basalt, not the repo root; `basalt-ui doctor`'s `basalt-resolves` line prints where.

@./DESIGN.md

**Restraint override (supersedes `/frontend-design`).** This app is a calm, data-dense professional
surface, not a showcase. Ignore the push toward a "BOLD aesthetic direction", gradient meshes,
noise/grain and dramatic motion. Here: the shipped three-font system, depth from a whisper shadow
with a 1px ring, neutral-by-default with the single accent spent only when earned — trend, signal,
or genuine categorical separation. Restraint **is** the identity.

<!-- basalt:end -->
