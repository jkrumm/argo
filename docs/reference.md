# Reference

Lookup material moved out of the root AGENTS.md. Nothing here is loaded by default.

## Validate commands

```bash
./node_modules/.bin/basalt-ui sync --check    # managed files match the installed basalt-ui
bun run lint                                  # oxlint + basalt-ui check-theme
bun run format:check                          # oxfmt
bun run --cwd apps/api typecheck
bun run --cwd apps/dashboard typecheck        # route tree, app, node and test files (tsconfig.test.json)
bun run typecheck:scripts                     # scripts/
bun run --cwd apps/dashboard build            # vite build
bun run --cwd apps/dashboard test             # bun test src
# `make test` runs the two test lines of this block as one target (the factory's `steps.unit`, see project.yaml).

# API unit tests (no DB connection): the DB-free set is listed once, in apps/api/package.json `test:unit`
# (placeholder DATABASE_URL / API_SECRET included). A new DB-free test file goes into that list.
bun run --cwd apps/api test:unit

# Integration tests (src/routes/*.test.ts, src/db/*.test.ts) need the mini's Postgres up; NOT part of CI.
# `bun test:api` creates a scratch database argo_test_<hex> as the Postgres superuser over the unix socket in /tmp (OS user, no password),
# applies usage-tracker's migrations/pg for schema `usage` (USAGE_MIGRATIONS_DIR overrides the path),
# runs the suite there and drops it:
bun test:api
bun test:api src/routes/workouts.summary.test.ts  # pass-through filter
```

## Design System (basalt-ui)

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

## Analytics Reference

- `docs/GARMIN-HEALTH.md` — metric definitions, formulas, composite signals (health page)
- `docs/ASTRO-WINDOW.md` — the astro + marine window planner: status per piece, the response contract, every decision taken during the build (D1–D11), what is still unverified
- `docs/ASTRO-MAP-RESEARCH.md` — **shipped**: `/astro/light-pollution` + `/astro/skyglow` (point-lookup), `GET /astro/tiles/lp/{year}/{z}/{x}/{y}.png` (the terrarium-encoded raster tile route), and the Map tab — basemap/imagery catalogue, the light-pollution ramp overlay, a global weather layer catalogue (RainViewer radar, decoded EUMETSAT cloud products, NASA GIBS infrared, Open-Meteo model forecasts) and the settings drawer. The decision record: light-pollution sources and licences, the Lorenz binary-tile decode, a direction-resolved skyglow model, terrain horizons, cloud/weather source selection and two shipped-then-fixed rendering bugs (§9–§10). POC scripts in `docs/poc/astro-map/` (lint-excluded) reproduce every number in it
- `docs/ASTRO-HORIZON-RESEARCH.md` — the terrain-horizon rebuild, **shipped in five phases**. `GET /astro/horizon` serves the per-azimuth near/far-split skyline (`lib/terrain-horizon.ts`'s `horizonProfile`/`horizonAt`) for an arbitrary coordinate from the AWS terrarium DEM (`clients/terrarium-dem.ts`); `/astro/window`'s per-night gate is `max(8°, farHorizon(coreAzimuth) + 2°)`, evaluated per sample rather than once per night, and the moon counts as down when it sits behind that same skyline (`resolveNight` in `lib/astro-night.ts`); `GET /astro/visibility` (`lib/astro-visibility.ts`'s `annualVisibility`) integrates a whole calendar year on a 10-minute grid into the deterministic, weather-free annual budget — "is this spot worth the drive at all" — under three progressively honest gates (`flat`/`terrain`/`terrainMoon`). On the dashboard, the **Forecast** tab carries the sky panorama (`charts/sky-panorama.tsx` — terrain silhouette, skyglow rose and the sun/moon/core tracks on one azimuth × altitude pair of axes, with the gate drawn and the clearing segment emphasised) plus the monthly budget chart, and the **Map** tab carries hillshade + optional 3D terrain off one shared terrarium `raster-dem` source and click-anywhere scouting (`components/scout-panel.tsx`, comparing any coordinate against the selected site). **Not built:** the §5 clearance raster layer — measured at 0.34 ms/cell and rasterable, but no tile route exists. The record: the PVGIS validation, why the near field (≤500 m) is DEM-unstable and ships advisory-only, what terrain does to the core and to moonlight, the annual-budget numbers that reorder the site ranking 16× under a terrain-aware gate, and the re-verified library landscape (`astronomy-engine` is upstream-abandoned, `suncalc` 2.0 is now viable for sun/moon only). POC scripts in `docs/poc/astro-horizon/` reproduce every number in it
- `docs/STRENGTH-ANALYTICS.md` — metric definitions, INOL, ACWR, e1RM formulas (strength page)

## Workspace layout

```
argo/
├── apps/api/          — Elysia + Bun + Postgres + Drizzle + Zod + OTel
└── apps/dashboard/    — Vite + React 19 + Mantine v9 + TanStack Router/Query
```

## Local dev infra

**Dev infra prerequisite:** the local Postgres + ClickStack come from `~/SourceRoot/vps/compose.dev.yml`. Start once with `cd ~/SourceRoot/vps && make up` (and `make postgres-setup` the first time to provision the `argo` role + schema). The `bun dev` command then connects to the shared cluster on `localhost:5432` and pipes OTel to ClickStack on `localhost:4318`.
