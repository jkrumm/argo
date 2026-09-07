# Argo

Personal dashboard + agent-backbone API, served at `https://argo.jkrumm.com`.

## What It Does

Health/training core, plus a growing set of personal-agent surfaces, grouped in the sidebar:

- **Health** — Garmin Health (HRV, resting HR, sleep score, stress, steps, recovery score,
  fitness direction, training load — synced every 6 hours from Garmin Connect via a Python
  sidecar), Strength Tracker (set-level logging, e1RM, PR detection, ACWR, body weight), Body
  Composition, WalkingPad, Reading.
- **Assistant** — Hermes Chat (a Slack-shaped feed over Hermes agent threads + Slack channels) and
  Calendar.
- **Outdoors** — Astro Window (is tonight worth a Milky Way shoot).
- **System** — Usage Tracking (Claude Code spend) and Agents (the sideclaw dev-agent overview).
- **Other** — M365 Explorer (IU Teams).

The backend also serves a curated OpenAPI (`/openapi`) consumed by AI agents — an AI Gateway,
Hermes Chat, and Slack read/write live behind the same bearer as the dashboard's own endpoints.

## Stack

| Layer         | Choice                                                                |
| ------------- | --------------------------------------------------------------------- |
| Runtime       | Bun                                                                   |
| Backend       | Elysia + Drizzle ORM + Postgres (schema: `argo`)                      |
| Frontend      | Vite + React 19 + Mantine v9                                          |
| Routing       | TanStack Router (file-based)                                          |
| Data fetching | TanStack Query + Eden Treaty                                          |
| Charts        | visx, via `basalt-ui/charts`                                          |
| Telemetry     | `@elysiajs/opentelemetry` (backend) + HyperDX (frontend) → ClickStack |

## Running Locally

### Prerequisites

- Bun
- Docker
- Secrets through the `secrets-run` shim from dotfiles (a drop-in `op`): on the MacBook the 1Password CLI (`op`) with the `tkrumm` account unlocked and biometric; on the Mac mini the age-encrypted headless cache — a direct `op read` there hangs on a biometric prompt no one can answer
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
secrets-run run --env-file=apps/api/.env.local.tpl -- bun test --cwd apps/api
```

## Deploying

Production runs on a VPS. Push to `master` → RollHook → rolling Docker restart.
Compose: `~/SourceRoot/vps/apps/argo/compose.yml`.

Secrets are in 1Password under the `vps` vault (`op://vps/argo/*`, account `tkrumm`).

## Architecture

```
apps/api/         — Elysia backend, Postgres (schema: argo), Drizzle migrations
apps/dashboard/   — Vite + React 19 frontend, themed by basalt-ui
```

## Docs

- `apps/api/CLAUDE.md` — API conventions, route patterns, DB setup
- `apps/dashboard/CLAUDE.md` — Dashboard conventions, adding a page
- `DESIGN.md` — Argo's design-system app-delta record (basalt-ui is the design system)
- `docs/GARMIN-HEALTH.md` — Health metric formulas and composite signals (analytics reference)
- `docs/STRENGTH-ANALYTICS.md` — Strength metric formulas (analytics reference)
- `docs/ASTRO-WINDOW.md` — The astro + marine window planner: status, decisions, what is not verified
- `docs/ASTRO-MAP-RESEARCH.md` / `docs/ASTRO-HORIZON-RESEARCH.md` — The map and terrain-horizon research/decision records the window planner is built on
- `docs/HERMES-CHAT-V2.md` — Hermes Chat design reference (shipped; what is deferred is in its header)
- `slack/README.md` — The two-Slack-app split (posting vs reading) and where each token lives
