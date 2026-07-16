# Argo — Project Configuration

## What Argo Is

Personal homelab dashboard for Johannes Krumm. Three live pages: **Garmin Health** (HRV, resting HR, sleep, stress, daily metrics, recovery score), **Strength Tracker** (workouts, sets, e1RM, volume, ACWR, PR detection, body weight), and **M365 Explorer** (browse IU Teams chats + channels, label important ones to drive `GET /m365/important`). A Garmin sync sidecar feeds health data every 6 hours; strength data is logged manually.

The API doubles as an AI-agent endpoint. Discovery is anchored at three URLs: `GET /` returns a small JSON pointing at the docs and listing the six tag groups, `GET /openapi` serves the Scalar interactive UI, and `GET /openapi/json` exposes the raw spec. The OpenAPI contract (paths, tag taxonomy, description quality) is the agent interface — see `apps/api/.claude/rules/openapi.md`.

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
framework's agentic layer (`bunx basalt init`/`sync`, the `.claude/rules/basalt-*.md` doctrine, and
the `/basalt:design` / `/basalt:charts` plugin skills).

**`DESIGN.md` (repo root) is Argo's app-delta record** — not the law itself anymore, but the
project-specific deltas on top of basalt's defaults (accent hue, series dictionary). It is a basalt
`seed` file: written once by `basalt init`, then owned by Argo — `basalt sync` never overwrites it.
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
- `docs/STRENGTH-ANALYTICS.md` — metric definitions, INOL, ACWR, e1RM formulas (strength page)

<!-- basalt:begin 1.0.0 -->

## basalt-ui (managed — do not hand-edit)

Scaffolded by `bunx basalt init` and refreshed by `bunx basalt sync` (run it after a basalt-ui
upgrade; `basalt sync --check` gates drift in CI). This block is framework-owned — edit `DESIGN.md`
or the `basalt-*` rules instead; manual changes here are overwritten on the next sync.

**Stack:** React 19 + Mantine v9, themed by `basalt-ui` (`BasaltProvider` + `createBasaltTheme`).
Colors come from the three-tier `--vx-*` token system — read `VX.*` / a `defineSeries` token,
never a raw hex/`rgb()`/`hsl()`. Charts are visx via `basalt-ui/charts` (compose the primitives:
`ChartCard`, `ChartLegend`, the `ChartTooltip` family, `AxisLeftNumeric`/`AxisBottomDate`); add a
kind on the third repeat, don't loosen the primitives. `basalt-ui/charts` and `basalt-ui/tokens`
are Mantine-free — never import `@mantine/*` under `**/charts/**`, never import `@visx/*` outside
charts. Toolchain is oxlint + oxfmt (no ESLint/Biome/Prettier) and `basalt check-theme` guards the
palette. Runtime is Bun.

**Before guessing an import, check the installed package's machine docs**:
`node_modules/basalt-ui/llms.txt` (per-subpath import map), `node_modules/basalt-ui/AGENTS.md`, or
run `bunx basalt info --json`.

**DESIGN.md is law.** `./DESIGN.md` (imported below) records this app's palette identity and series
dictionary. Precedence: **DESIGN.md > `basalt-*` rules > skills.** When building or restyling any
UI, that law wins over habit, over library defaults, and over a skill's instinct. The design/charts
workflows are in the `basalt` plugin (`/basalt:design`, `/basalt:charts`) — they defer to DESIGN.md.

@./DESIGN.md

**Restraint override (supersedes `/frontend-design`).** This app is a calm, data-dense,
dark-first professional surface — not a showcase. Ignore `/frontend-design`'s push toward a "BOLD
aesthetic direction", gradient meshes, noise/grain, and dramatic motion. Here: the shipped
three-font system (Nunito Sans body, Hubot Sans condensed headings, JetBrains Mono for every
numeral/micro-label), depth via `shadow-card` (a whisper shadow + 1px ring, never a decorative drop
shadow), neutral zinc-by-default with the single saturated accent spent only when earned (trend /
signal / categorical separation). Restraint **is** the identity.

<!-- basalt:end -->
