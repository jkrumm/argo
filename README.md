# Argo

Personal homelab dashboard for health metrics and strength training, served at `https://argo.jkrumm.com`.

## What It Does

Two pages:

- **Garmin Health** — HRV, resting HR, sleep score, stress, steps, recovery score, fitness direction, training load. Data synced every 6 hours from Garmin Connect via a Python sidecar.
- **Strength Tracker** — Set-level workout logging, e1RM estimation (Brzycki + Epley), PR detection, weekly volume, ACWR, body weight log.

The backend also serves a curated OpenAPI (`/openapi`) consumed by AI agents — the same summary endpoints used by the dashboard.

## Stack

| Layer         | Choice                                                                |
| ------------- | --------------------------------------------------------------------- |
| Runtime       | Bun                                                                   |
| Backend       | Elysia + Drizzle ORM + Postgres (schema: `argo`)                      |
| Frontend      | Vite + React 19 + Mantine v9                                          |
| Routing       | TanStack Router (file-based)                                          |
| Data fetching | TanStack Query + Eden Treaty                                          |
| Charts        | visx, extracted to `@argo/charts`                                     |
| Telemetry     | `@elysiajs/opentelemetry` (backend) + HyperDX (frontend) → ClickStack |

## Running Locally

### Prerequisites

- Bun
- Docker (for local Postgres)
- 1Password CLI (`op`) with the `tkrumm` account

### Start

```bash
bun install

# Start local Postgres on :5433
make db-up

# Apply migrations + start API on :4000
op run --account tkrumm --env-file=apps/api/.env.local.tpl -- \
  sh -c 'bun --cwd apps/api run db:migrate && bun --cwd apps/api run start'

# Start dashboard on :5173 (proxies /api → :4000)
bun --cwd apps/dashboard run dev
```

Open `http://localhost:5173`.

### Validation

```bash
bun run lint              # oxlint
bun run format:check      # oxfmt
bun --cwd apps/api run typecheck
bun --cwd apps/dashboard run typecheck
bun --cwd packages/charts run typecheck
bun --cwd apps/api test   # integration tests — needs DATABASE_URL + API_SECRET
```

## Deploying

Production runs on a VPS. Push to `master` → RollHook → rolling Docker restart.
Compose: `~/SourceRoot/vps/apps/argo/compose.yml`.

Secrets are in 1Password under the `vps` vault (`op://vps/argo/*`, account `tkrumm`).

## Architecture

```
apps/api/         — Elysia backend, Postgres (schema: argo), Drizzle migrations
apps/dashboard/   — Vite + React 19 frontend
packages/charts/  — @argo/charts: theme-agnostic visx primitives + kind components
```

## Docs

- `apps/api/CLAUDE.md` — API conventions, route patterns, DB setup
- `apps/dashboard/CLAUDE.md` — Dashboard conventions, adding a page
- `packages/charts/CLAUDE.md` — Chart primitives, kinds, tokens
- `docs/GARMIN-HEALTH.md` — Health metric formulas and composite signals (analytics reference)
- `docs/STRENGTH-ANALYTICS.md` — Strength metric formulas (analytics reference)
- `docs/MANTINE-MIGRATION-PRD.md` — Completed migration spec (historical reference)
