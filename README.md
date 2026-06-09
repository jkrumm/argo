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
- Docker
- 1Password CLI (`op`) signed into the `tkrumm` account
- `~/SourceRoot/vps` cloned — argo connects to the shared dev cluster defined there (Postgres 18 + ClickStack + Valkey)

### Start

```bash
# One-time, in the vps repo:
cd ~/SourceRoot/vps
make up                                       # Postgres :5432, ClickStack :4318, Valkey :6379
make postgres-setup                           # provisions the argo role + schema (idempotent)
cd -

# In argo:
bun install
bun db:sync                                   # optional: pull fresh data from prod into local
bun dev                                       # API :4040 + dashboard :7715 (op-wrapped, concurrent)
```

Open `https://argo.test` (via dotfiles Caddy + dnsmasq) or `http://localhost:7715` directly.

The dashboard proxies `/api/*` to the API and `/v1/traces` + `/v1/logs` to ClickStack on `:4318`.

### Validation

```bash
bun run lint              # oxlint
bun run format:check      # oxfmt
bun run --cwd apps/api typecheck
bun run --cwd apps/dashboard typecheck
bun run --cwd packages/charts typecheck
op run --account tkrumm --env-file=apps/api/.env.local.tpl -- bun test --cwd apps/api
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
- `docs/THE-QUANTIFIED-ATHLETE.md` — Narrative field guide to every metric on the dashboard
