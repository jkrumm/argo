# Argo — Project Configuration

## What Argo Is

Personal homelab dashboard for Johannes Krumm. Three live pages: **Garmin Health** (HRV, resting HR, sleep, stress, daily metrics, recovery score), **Strength Tracker** (workouts, sets, e1RM, volume, ACWR, PR detection, body weight), and **M365 Explorer** (browse IU Teams chats + channels, label important ones to drive `GET /m365/important`). A Garmin sync sidecar feeds health data every 6 hours; strength data is logged manually.

The API doubles as an AI-agent endpoint. Discovery is anchored at three URLs: `GET /` returns a small JSON pointing at the docs and listing the six tag groups, `GET /openapi` serves the Scalar interactive UI, and `GET /openapi/json` exposes the raw spec. The OpenAPI contract (paths, tag taxonomy, description quality) is the agent interface — see `apps/api/.claude/rules/openapi.md`.

## Workspace Layout

```
argo/
├── apps/api/          — Elysia + Bun + Postgres + Drizzle + Zod + OTel
├── apps/dashboard/    — Vite + React 19 + Mantine v9 + TanStack Router/Query
└── packages/charts/   — Theme-agnostic visx primitives (@argo/charts)
```

## Common Commands

```bash
bun install                                    # all workspace deps

# Dev — runs API + dashboard concurrently with secrets injected via op
bun dev                                        # API :4000, dashboard https://argo.test (→ :7715)
bun db:sync                                    # pull fresh argo schema dump from VPS into local Postgres
bun db:migrate                                 # apply pending Drizzle migrations against local DB

# Single-app
bun run --cwd apps/api start                  # API on :4000 (needs op run wrapper for env)
bun run --cwd apps/api db:generate            # generate migration after schema changes
bun run --cwd apps/api typecheck
bun run --cwd apps/dashboard typecheck
bun run --cwd packages/charts typecheck

# Tests — wraps op + assembles DATABASE_URL (needs dev Postgres up)
bun test:api                                  # all API tests
bun test:api src/routes/workouts.summary.test.ts  # pass-through filter

# Root (all workspaces)
bun run lint                                  # oxlint
bun run format:check                          # oxfmt
```

**Dev infra prerequisite:** the local Postgres + ClickStack + Valkey come from `~/SourceRoot/vps/compose.dev.yml`. Start once with `cd ~/SourceRoot/vps && make up` (and `make postgres-setup` the first time to provision the `argo` role + schema). The `bun dev` command then connects to the shared cluster on `localhost:5432` and pipes OTel to ClickStack on `localhost:4318`.

## Secrets

All secrets via 1Password, account `tkrumm`. DB password at `op://vps/argo/DB_PASSWORD`.

```bash
op run --account tkrumm --env-file=apps/api/.env.local.tpl -- <command>
op read "op://vps/argo/DB_PASSWORD" --account tkrumm
```

## Local Dev

```bash
cd ~/SourceRoot/vps && make up && cd -   # Postgres 18 + ClickStack + Valkey (once per boot)
bun db:sync                              # optional: refresh local data from VPS
bun dev                                  # API :4000 + dashboard :7715 (https://argo.test via dotfiles Caddy)
```

The dashboard proxies `/api/*` to the API (strips `/api` prefix) and `/v1/traces` + `/v1/logs` to ClickStack on `:4318`.

## Production

API and dashboard run on the VPS via Docker. Compose: `~/SourceRoot/vps/apps/argo/compose.yml`. Push to `master` → RollHook → rolling restart.

## Workspace-Specific Docs

| File                        | Contents                                                    |
| --------------------------- | ----------------------------------------------------------- |
| `apps/api/CLAUDE.md`        | DB, migrations, adding a route, test patterns, OTel vars    |
| `apps/dashboard/CLAUDE.md`  | Adding a page, stack details, React Compiler, observability |
| `packages/charts/CLAUDE.md` | Chart primitives, kinds, tokens, VxBridge wiring            |

## Analytics Reference

- `docs/GARMIN-HEALTH.md` — metric definitions, formulas, composite signals (health page)
- `docs/STRENGTH-ANALYTICS.md` — metric definitions, INOL, ACWR, e1RM formulas (strength page)
