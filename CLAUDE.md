# Argo — Project Configuration

## What Argo Is

Personal homelab dashboard for Johannes Krumm. Two live pages: **Garmin Health** (HRV, resting HR, sleep, stress, daily metrics, recovery score) and **Strength Tracker** (workouts, sets, e1RM, volume, ACWR, PR detection, body weight). A Garmin sync sidecar feeds health data every 6 hours; strength data is logged manually.

The API doubles as an AI-agent endpoint — its Scalar OpenAPI UI at `/openapi` and raw spec at `/openapi/json` expose curated summaries consumed by external tools.

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

# API
make db-up                                     # start local Postgres on :5433
bun --cwd apps/api run db:migrate             # apply pending Drizzle migrations
bun --cwd apps/api run db:generate            # generate migration after schema changes
bun --cwd apps/api run start                  # API on :4000
bun --cwd apps/api test                       # integration tests (needs DATABASE_URL + API_SECRET)
bun --cwd apps/api run typecheck

# Dashboard
bun --cwd apps/dashboard run dev              # dashboard on :5173 (proxy: /api → :4000)
bun --cwd apps/dashboard run typecheck

# Charts package
bun --cwd packages/charts run typecheck

# Root (all workspaces)
bun run lint                                  # oxlint
bun run format:check                          # oxfmt
```

## Secrets

All secrets via 1Password, account `tkrumm`. DB password at `op://vps/argo/DB_PASSWORD`.

```bash
op run --account tkrumm --env-file=apps/api/.env.local.tpl -- <command>
op read "op://vps/argo/DB_PASSWORD" --account tkrumm
```

## Local Dev

```bash
make db-up                                                         # Postgres 16 on :5433
op run --account tkrumm --env-file=apps/api/.env.local.tpl -- \
  sh -c 'bun --cwd apps/api run db:migrate && bun --cwd apps/api run start'
bun --cwd apps/dashboard run dev
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
