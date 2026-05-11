# Argo — RALPH Shared Context

You are implementing: **migrate `argo` from Refine v5 + Ant Design v5 + SQLite to Vite + React 19 + Mantine v9 + TanStack Router + TanStack Query + Eden Treaty + Zustand + visx (extracted) + Postgres + full OpenTelemetry/HyperDX observability, with curated OpenAPI for AI agents, max-strict TypeScript, React Compiler, Bun-native tests, lefthook pre-commit, extended oxlint guardrails, and fallow analysis in CI**.

**Read this file fully before starting your group.** The authoritative spec is `docs/MANTINE-MIGRATION-PRD.md` — your group prompt is a thin wrapper around a section of it.

---

## What Argo Is

Argo is a personal homelab dashboard for Johannes Krumm. The legacy stack is Refine v5 + Ant Design v5 in `packages/dashboard` talking to an Elysia + Bun + SQLite + Drizzle backend in `packages/api`. Two live pages: **Garmin Health** (HRV, resting HR, sleep, stress, daily metrics) and **Strength Tracker** (workouts, sets, e1RM, volume, PR detection, plus a Body Weight subtab). The legacy frontend does heavy client-side aggregation (rolling averages, trend math) that this migration moves to the server so AI agents and future apps can consume the same numbers.

The endpoint is deployed at `https://argo.jkrumm.com` (production = the live legacy stack). Production stays running on SQLite + the legacy dashboard until the **Group 11 cutover**. From **Group 6** onward, production must **not** be redeployed until Group 11 — the new API shape is incompatible with the legacy dashboard.

The migration produces a clean `apps/{api,dashboard}` + `packages/charts` workspace. Legacy `packages/dashboard` stays in the tree as a visual reference only (we compare against the live production deploy, not a local copy) until it is deleted in Group 11.

---

## Repository Layout (target state)

```
argo/
├── apps/
│   ├── api/                      # Elysia + Bun + Postgres + Drizzle + Zod + OTel
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── env.ts            # Zod-validated process.env (single source)
│   │   │   ├── telemetry.ts      # OTLPTraceExporter + tracer
│   │   │   ├── db/
│   │   │   │   ├── index.ts      # postgres.js + drizzle(client, { schema })
│   │   │   │   └── schema.ts     # pgSchema("argo").table(...)
│   │   │   ├── routes/*.ts
│   │   │   ├── cron/garmin-sync.ts
│   │   │   └── lib/formulas.ts   # epley, brzycki, volume, PR detection
│   │   ├── drizzle/              # generated migrations (drizzle-kit)
│   │   ├── scripts/migrate-sqlite-to-pg.ts
│   │   ├── docker-compose.dev.yml  # local Postgres 16 on :5433
│   │   ├── .env.local.tpl        # 1Password-sourced
│   │   ├── Dockerfile
│   │   ├── CLAUDE.md
│   │   └── .claude/rules/*.md
│   └── dashboard/                # Vite + React 19 + Mantine v9 + TanStack
│       ├── src/
│       │   ├── main.tsx          # import './lib/hyperdx' MUST be first line
│       │   ├── routes/           # file-based router
│       │   │   ├── __root.tsx    # sidebar + theme toggle + outlet
│       │   │   ├── garmin-health.tsx
│       │   │   └── strength-tracker.tsx
│       │   ├── lib/
│       │   │   ├── eden.ts       # treaty<App>() client
│       │   │   ├── query-client.ts
│       │   │   ├── store.ts      # zustand persist
│       │   │   ├── hyperdx.ts
│       │   │   └── queries/      # query-key factory per resource
│       │   └── charts-bridge.tsx # the ONLY file importing both Mantine + @argo/charts
│       ├── vite.config.ts        # React Compiler, OTLP proxy, port 5173
│       ├── Dockerfile, nginx.conf
│       ├── CLAUDE.md
│       └── .claude/rules/*.md
├── packages/
│   ├── charts/                   # @argo/charts — theme-agnostic visx primitives + kinds + sparklines
│   │   └── src/
│   │       ├── theme.tsx         # VxThemeProvider + useVxTheme (no Mantine, no apps/*)
│   │       ├── tokens.ts         # VX palette + per-metric series
│   │       ├── primitives/, kinds/, sparklines/, hooks/, utils/
│   │       └── index.ts
│   └── dashboard/                # LEGACY — kept until Group 11 prune; not run locally
├── tsconfig.base.json            # max-strict baseline; apps + packages extend
├── lefthook.yml
├── .oxlintrc.json                # extended plugins + no-restricted-imports overrides
├── .github/workflows/
│   ├── check.yml                 # lint, format:check, typecheck, test, fallow (report-only)
│   └── deploy.yml                # paths swap in Group 11
└── docs/MANTINE-MIGRATION-PRD.md # the spec — read your group's section
```

---

## Tech Stack (target)

| Concern | Choice |
|-|-|
| Runtime | Bun (apps + tooling) |
| Backend framework | Elysia |
| Backend validation | **Zod** via Standard Schema (no TypeBox) |
| OpenAPI plugin | `@elysiajs/openapi` (Scalar UI) with `mapJsonSchema: { zod: z.toJSONSchema }` |
| Database | **Postgres** (VPS prod, local container dev) — schema `argo`, role `argo` |
| ORM | Drizzle (`drizzle-orm/postgres-js`) + `drizzle-kit` migrations |
| Driver | `postgres` (postgres.js) |
| Frontend build | Vite 5 + React 19 |
| UI library | Mantine v9 (core + form, notifications, modals, dates, hooks) — **no Tailwind** |
| Icons | `@tabler/icons-react` |
| Router | TanStack Router (file-based via `@tanstack/router-plugin/vite`) |
| Data fetching | TanStack Query (loaders use `ensureQueryData`; components `useSuspenseQuery`) |
| API client | Eden Treaty (`@elysiajs/eden`) |
| Client state | Zustand (`persist` middleware) — minimal scope: theme, sidebar, per-page filters |
| Forms | `@mantine/form` + Zod resolver |
| Charts | **visx**, extracted to `@argo/charts` (theme-agnostic, `VxThemeProvider`) |
| Date library | `date-fns` (frontend only; backend uses ISO strings) |
| Schema lib (E2E) | **Zod** (env, route validators, search params, forms) |
| Telemetry | `@elysiajs/opentelemetry` (backend) + `@hyperdx/browser` (frontend) → ClickStack/HyperDX at `127.0.0.1:4318` |
| TypeScript | `tsconfig.base.json` max strict (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `exactOptionalPropertyTypes`) |
| Testing | `bun test` (native) — unit + summary endpoint tests against fresh Postgres |
| React perf | `babel-plugin-react-compiler` via `vite-plugin-babel` |
| Pre-commit | `lefthook` running `oxlint` + `oxfmt --check` on staged |
| Lint | oxlint with `react`, `react-perf`, `typescript`, `import`, `unicorn`, `jsx-a11y`, `promise`, `oxc`, `jsdoc` |
| Format | oxfmt |
| Static analysis | `fallow` (CI, report-only/non-blocking initially) |
| Secrets | 1Password CLI (`op run --account tkrumm` / `op read --account tkrumm`); password at `op://vps/argo/DB_PASSWORD` |
| Production host | VPS (`ssh vps`), compose at `~/vps/apps/argo/compose.yml` |

---

## Validation Commands

The repo state changes shape during the migration. The runner's validation gate uses these commands at the **root**; they are tolerant of missing workspaces (e.g. before `apps/dashboard` exists).

**Primary (run after every group, post-Group-1):**

```bash
bun install                                                     # always must succeed
bun run lint                                                    # oxlint clean
bun run format:check                                            # oxfmt clean
[ -d apps/api ]       && bun --cwd apps/api typecheck       || true
[ -d apps/dashboard ] && bun --cwd apps/dashboard typecheck || true
[ -d packages/charts ] && bun --cwd packages/charts typecheck || true
```

After Group 10 wires up `bun test`:
```bash
bun --cwd apps/api test
```

**E2E / production smoke (only when the group instructs):**
- Group 2: `docker compose -f apps/api/docker-compose.dev.yml up -d` + `op run … bun --cwd apps/api start` + curl-driven smoke against every route.
- Group 7: open the dashboard locally, perform a request, inspect HyperDX for the cross-boundary trace.
- Group 11: production cutover — see PRD Group 11.

The runner script auto-runs the primary block pre- and post-group. **Each group must leave the repo with all primary commands green.**

---

## Research Before Implementing

Always start your group with:

1. **Read the relevant PRD section.** Your prompt names the section — read it carefully. The PRD is the single source of truth for scope, acceptance, and architecture.
2. **Explore the existing code.** Glob/Grep/Read the files you are about to touch. Understand what is there before you change it. Read sibling files for patterns.
3. **Research libraries you do not know cold.** Mantine v9 + React 19, TanStack Router (file-based), TanStack Query (loaders + `ensureQueryData`), `@elysiajs/openapi` with Zod, `drizzle-orm/postgres-js`, `pgSchema`, `@hyperdx/browser`, `babel-plugin-react-compiler`, `lefthook`, `fallow`. Use the `/research` skill (`claude -p` subprocess) when in doubt. The model training cutoff is mid-2025; verify everything that changed after.
4. **Cross-reference dotfiles rules.** `~/SourceRoot/dotfiles/rules/{visx-charts,research-first,commit-conventions,attribution,code-style,docker-makefile,formatting,security,typescript,elysia,tanstack-router,tanstack-start,react-best-practices}.md` already capture conventions. Apply them.
5. **The PRD is direction, not prescription.** If you find a strictly better approach while researching, use it — and record the deviation in `RALPH_NOTES.md`.

---

## Cross-Cutting Constraints

These apply to every group:

- **No AI/tool attribution anywhere** (commits, comments, PR bodies). See `~/SourceRoot/dotfiles/rules/attribution.md`.
- **Conventional commits.** `feat(scope): …`, `refactor(scope): …`, `fix(scope): …`, `chore(scope): …`. Stage only the files you changed. Commit before signaling completion.
- **No raw `process.env.X` outside `apps/api/src/env.ts` and `vite.config.ts`** (enforced from Group 7 onward).
- **No raw `docker` / `docker-compose` commands** in scripts or docs — use Makefile targets when one exists. See `~/SourceRoot/dotfiles/rules/docker-makefile.md`.
- **No secrets in git.** All secrets via `op` CLI with `--account tkrumm`. Use `op://vps/argo/DB_PASSWORD` for the DB password. Placeholders only in `.env.local.tpl` files.
- **English in artifacts.** All code, comments, commits, docs in English.
- **Roadmap voice in the PRD; descriptive voice in CLAUDE.md / rules.** Until Group 12 does the formal pass, lean toward descriptive present-tense in any rule file you create.
- **No new packages without a reason.** The PRD enumerates the runtime + tooling set. If you need something else, justify it in `RALPH_NOTES.md`.
- **Type safety.** No `any` without a one-line justification comment. Prefer `unknown` + narrowing. Use `satisfies` for type validation without widening. See `~/SourceRoot/dotfiles/rules/typescript.md`.
- **Code style.** Low nesting, early returns, deep modules, port-and-adapter boundaries. See `~/SourceRoot/dotfiles/rules/code-style.md`.
- **No premature abstractions.** Three similar lines is better than a wrong helper. The PRD already names what to extract (`@argo/charts`, `env.ts`, query factories, summary endpoints).

---

## Production Deploy Pause

**From Group 6 landing on `master` until Group 11 cutover lands, production must not be redeployed.** The new API shape (`page/limit/sort/order`, `{ data, total }` body, Zod, new summary endpoints) is incompatible with the legacy production dashboard. The cutover ships both halves in one release.

Implementing agents for Groups 6 through 10: when committing on `master`, the CI `check` workflow still runs, but **do not trigger `deploy.yml`**. Either work on a long-lived branch or coordinate with the maintainer before merging.

---

## Learning Notes — Always Append

After completing each group, **always append** to `docs/ralph/RALPH_NOTES.md`:

```markdown
## Group N: <title>

### What was implemented
<1–3 sentences describing the actual outcome>

### Deviations from PRD
<what you did differently and why — be specific>

### Gotchas & surprises
<library quirks, API changes since training cutoff, undocumented behavior>

### Security notes
<secrets handling, env validation, anything that touches auth or DB credentials>

### Tests added
<list test files / functions / fixtures>

### Future improvements
<deferred work, tech debt, better approaches you saw but didn't take>
```

Group 12's final descriptive-voice pass consumes these notes — write them as if a future Claude session will read them cold.

---

## Commit Format

Conventional commits, **no AI attribution**:

```
feat(api): swap SQLite → Postgres with drizzle-kit migrations
refactor(dashboard): extract visx primitives to @argo/charts
fix(api): correct ON CONFLICT clause on workout_sets
chore(repo): add tsconfig.base.json max-strict baseline
docs(api): document the pgSchema convention
```

Scopes used in this repo: `api`, `dashboard`, `charts`, `repo` (root config), `ci`, `docs`, `deploy`.

Stage only the files you changed (no `git add -A`). Commit before signaling completion. If a pre-commit hook fails after Group 10, fix the issue and create a **new** commit — never `--amend` to bypass.

---

## Completion Signal

Output exactly one of these as the **very last line** of your response:

```
RALPH_TASK_COMPLETE: Group N
```

If you cannot proceed due to an unresolvable blocker:

```
RALPH_TASK_BLOCKED: Group N - <reason in one sentence>
```

Do not put the signal inside a code block. The runner greps the raw log for these strings.
