# Argo — Project Configuration

## What Argo Is

Personal dashboard + agent-backbone API for Johannes Krumm, running natively on the Mac mini at `https://argo.jkrumm.com` (tailnet only). Health and training core (Garmin Health, Strength Tracker), Usage Tracking, Astro Window, Reading, M365, GitLab, Atlassian and WalkingPad surfaces: `docs/overview.md`.

The API is also the agent interface: `GET /openapi/json` is the contract (`apps/api/.claude/rules/openapi.md`). **The model never computes a number** in Astro Window: the ephemeris, thresholds and score are deterministic; `aiComplete()` writes one sentence about a finished verdict (`docs/ASTRO-WINDOW.md`).

## Finance — the vault frontend

Argo is the frontend of the encrypted finance vault (repo `~/SourceRoot/finances`). Agents never unlock the vault or handle its key: `POST /finance/unlock` is human-only, and the API relays `/finance/*` (`apps/api/AGENTS.md` §Finance). Pages, unlock flow and retired surfaces: `docs/overview.md`.

## Common Commands

```bash
bun install                                    # all workspace deps

# Dev — runs API + dashboard concurrently with secrets injected via secrets-run (op/cache)
bun dev                                        # API :4040, dashboard https://argo.test (→ :7715)
bun db:sync                                    # copy the live argo schema from the mini (read-only) into local Postgres
bun db:migrate                                 # apply pending Drizzle migrations against local DB

# Single-app
bun run --cwd apps/api start                  # API on :4040 (needs secrets-run/op wrapper for env)
bun run --cwd apps/api db:generate            # generate migration after schema changes
```

Validation and deploy entry points are `make check` / `make deploy` / `make verify` / `make rollback` / `make logs` —
see [Validate](#validate), [Deploy](#deploy) and [Verify & Monitor](#verify--monitor) below.

Dev needs the shared Postgres and ClickStack cluster from `~/SourceRoot/vps` (first-run role setup, OTel ports): `docs/reference.md` §Local dev infra.

## Validate

`make check` runs exactly the gates CI runs on every PR and on push to `master`
(`.github/workflows/check.yml`): basalt managed-file drift, then `oxlint` + `check-theme`, then
`oxfmt --check`, then the typechecks (API, dashboard incl. its test files via `tsconfig.test.json`, and `scripts/`),
a dashboard `vite build`, the dashboard tests, and the DB-free API unit tests. Non-zero on the first
failure; writes only the gitignored `apps/dashboard/dist`.

The individual gates, the API unit and integration split, and the `test:api` scratch database: `docs/reference.md` §Validate commands.

## Deploy

Argo runs **natively on the Mac mini** (cutover 2026-10-30), the same model as agent-workflows: `make deploy` builds origin/master
into an immutable release and switches a LaunchAgent to it. Production is `https://argo.jkrumm.com`: a DNS-only A record on the
mini's tailnet IP, served by the mini's Caddy (an extra FQDN door, `~/.config/caddy-tailnet.hosts`, dotfiles `docs/remote-dev.md`),
reachable from the MacBook, phone and tablet only. The database is the shared Postgres on the mini (`shared`, schema `argo`),
the scheduled jobs run in the same process (`CRONS_ENABLED=true` in the plist). A push to `master` deploys nothing by itself:
run `make deploy`.

The VPS copy is gone (dropped 2026-11-03): no second copy to roll back to. Restoring the database, newest recovery point first: the nightly `shared` backup (at most ~24 h of loss), then the cutover dump as last resort. Procedure: `docs/deploy.md` §Database restore.

Migrations apply automatically on API boot — **there is no manual prod migrate step** (see `apps/api/AGENTS.md`).

### Mini layout

`~/.argo` holds the release tree, the markers and the app's state; the LaunchAgent `com.jkrumm.argo` points at the release path, not at `current`. Layout, plist and secret resolution: `docs/deploy.md` §Mini layout.

```bash
make deploy              # fetch origin/master, build the release, check the refs, switch, wait for /api/health at the new sha
DRY_RUN=1 make deploy    # print the plan and the rendered plist, touch nothing
make verify              # see Verify & Monitor
make rollback            # previous-sha goes live (exit 1 if it cannot); the markers swap, so a second rollback goes forward
make logs                # last 200 lines of argo.out.log / argo.err.log
```

`make deploy` ships origin/master (push first), re-executes the release's own `scripts/deploy.sh`, and rolls back to the previous release when the new one is not healthy within 120 s. Never roll back to a release older than `5b0c8596e9c1` (the cutover): an older plist restarts with `CRONS_ENABLED=false`. `make rollback` leaves `make verify` failing until the next deploy, by intent. Mechanics, the dashboard bundle env and pruning: `docs/deploy.md` §make deploy.

## Verify & Monitor

`make verify` (`scripts/verify.sh`, against the mini copy at `http://127.0.0.1:7737`) exits 0 only when the LaunchAgent is loaded, `/api/health` commit equals `deployed-sha` and origin/master, the SPA, assets, auth and bearer endpoints answer, and the stderr log is clean since the last process start. `make verify-pages` loads every route in a real Chrome. Each check, the mini door and `/health`: `docs/deploy.md` §make verify.

- Public health URL (tailnet clients only): `https://argo.jkrumm.com/api/health`.
- Uptime Kuma: the homelab cannot use that URL (the Caddy source guard answers it 403), so the monitor `Argo - Door` (group `Local` /
  `Mac mini door`) probes `GET /h/argo` on the Kuma door (dotfiles `kuma-door/registry.json`).
- OTel `service.name`: `argo-api` (via `OTEL_SERVICE_NAME`; the dashboard is `argo-dashboard`).
- Logs: `make logs`.

Real-data baselines and design shots (`make evidence`, `make design-shot`, the fixture proxy): `docs/deploy.md` §Evidence and design shots. The shots show real personal data: `.design-shots/` is gitignored, never commit or upload the images.

## Gotchas

- **`bun db:sync` wipes local data.** It uses `pg_dump --clean --if-exists`; run it _before_
  generating a new migration, never after — otherwise the unreleased migration is wiped from the
  local DB (re-run `bun db:migrate` to re-apply the committed SQL).
- **Never `op read`/`op run` on the Mac mini** — it hangs on a biometric prompt no one can answer.
  Use the `secrets-run` shim there (live `op` on the MacBook, headless cache on the mini).
- **Prod OAuth tokens are per-grant runtime state**, not env or 1Password: local
  `apps/api/data/oauth-tokens.json`, prod `~/.argo/state/oauth-tokens.json` on the mini (survives
  deploys; see Mini layout). Google features only work on prod or `bun dev:prod-api`.
- **`make verify` fails after `make rollback`** until the next deploy, by design (the live sha is not origin/master).

## Secrets

All secrets via 1Password, account `tkrumm`. DB password at `op://vps/argo/DB_PASSWORD`.

Local-dev scripts (`dev`, `db:migrate`) inject through the **`secrets-run`** shim
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
bun db:sync                              # optional: copy the live argo schema from the mini (read-only, md5-verified)
bun dev                                  # API :4040 + dashboard :7715 (https://argo.test via dotfiles Caddy); crons off
```

On the mini, `shared.argo` is the live database: `bun dev` refuses to start there (`ARGO_DEV_ON_LIVE=1` overrides it), `bun db:migrate` refuses the same way, and `bun db:sync` refuses unconditionally. Develop UI work against `make evidence` / `make design-shot` or a MacBook copy. Mechanics: `docs/deploy.md` §The mini is live.

The dashboard proxies `/api/*` to the API (strips `/api` prefix) and `/v1/traces` + `/v1/logs` to ClickStack on `:4318`.

## Workspace-Specific Docs

| File                       | Contents                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `DESIGN.md`                | Argo's app-delta record: accent hue, series dictionary, deviations from basalt defaults |
| `apps/api/AGENTS.md`       | DB, migrations, adding a route, test patterns, OTel vars                                |
| `apps/dashboard/AGENTS.md` | Adding a page, stack details, React Compiler, observability                             |

## Analytics Reference

Metric definitions, formulas and the astro, horizon and strength decision records with their POC scripts: `docs/reference.md` §Analytics Reference.

## Design System — agent pointer

Read `DESIGN.md` (repo root) before any UI work — it is the app-delta record and highest-precedence
design law. The basalt-ui doctrine lives in `.claude/rules/basalt-*.md` (six rules, all law) and the
framework-managed block at the end of this file (written by `basalt-ui sync`; `sync --check` gates it
in CI). Precedence: `DESIGN.md` > the
`basalt-*` rules > the `basalt-*` skills.

Basalt history and the analytics index: `docs/reference.md`.

<!-- basalt:begin 2.29.0 -->

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
