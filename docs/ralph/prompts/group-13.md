# Group 13: Tests + React Compiler + rules + CLAUDE.md + CI workflow

## What You're Doing

The tail end of the original "tooling" group, now slimmed down because the **strictness baseline (TS base + extended oxlint + lefthook)** already landed in Group 2 and propagated through Groups 3–12. This group's remaining concerns:

- **Tests** — `bun test` unit tests for formulas + summary endpoints + env.
- **React Compiler** — wire `babel-plugin-react-compiler` into `apps/dashboard/vite.config.ts`.
- **Rules + CLAUDE.md** — minimum viable set per workspace (full descriptive-voice rewrite is Group 15).
- **CI** — `.github/workflows/check.yml` running on PR + push to master.

---

## Required Reading

1. **The PRD section:** `docs/MANTINE-MIGRATION-PRD.md` Group 10. Skip the TypeScript baseline + oxlint extensions + lefthook subsections — they shipped in Group 2.
2. The **Testing surface**, **React Compiler**, **Claude Code rule set** subsections in the PRD's Architecture block.
3. React Compiler + Vite docs — verify via `/research` because the API has shifted during the React 19 rollout.
4. `basalt-ui-playground/apps/web/vite.config.ts` for the proven Babel plugin wiring.
5. `fallow`: https://github.com/fallow-rs/fallow

---

## What to Implement

### 1. Tests (`apps/api`)

Add `"test": "bun test"` to `apps/api/package.json`. Bun's native test runner — no Vitest.

Create:

- `apps/api/src/lib/formulas.test.ts` — Epley, Brzycki, average 1RM, pull-up total load, set volume.
- `apps/api/src/routes/workouts.summary.test.ts` — boots the api in-process against test Postgres, hits `/workouts/summary/strength` with fixtures, asserts window math + trend rules.
- `apps/api/src/routes/daily-metrics.summary.test.ts` — same shape.
- `apps/api/src/routes/weight-log.summary.test.ts` — same shape.
- `apps/api/src/env.test.ts` — happy path + one failure case (`expect(() => Env.parse({})).toThrow()`).

Tests seed fixtures in `beforeEach`, tear down in `afterEach`. CI uses a fresh Postgres service container.

### 2. React Compiler

```bash
bun add --cwd apps/dashboard -D babel-plugin-react-compiler vite-plugin-babel
```

Update `apps/dashboard/vite.config.ts`:

```ts
import babel from 'vite-plugin-babel';

export default defineConfig({
  plugins: [
    babel({ babelConfig: { plugins: ['babel-plugin-react-compiler'] } }),
    react(),
    TanStackRouterVite({ target: 'react', autoCodeSplitting: true }),
  ],
  // …
});
```

(Order matters: babel before react. Verify against current docs.)

Confirm `bun --cwd apps/dashboard build` succeeds. Any component that needs to opt out for now uses `'use no memo'`; document each in `RALPH_NOTES.md`.

### 3. Rules + CLAUDE.md (minimum viable)

Per the PRD — short and pointed; Group 15 does the descriptive-voice polish.

`apps/dashboard/CLAUDE.md`:
- Quick walkthrough: "Add a page = file under `src/routes/` + loader + query factory + component". Reference rules.
- Tech stack reminder line.

`apps/dashboard/.claude/rules/`:
- `mantine.md` — provider order, theming, common components.
- `tanstack-router.md` — file-based routes, `validateSearch`, loader + `ensureQueryData` pattern.
- `tanstack-query.md` — query-key factory, mutation + invalidation, devtools-only-in-dev.
- `forms.md` — `useForm` + `zodResolver`, list helpers.
- `state.md` — Zustand minimal scope; theme owned by Mantine.
- `observability.md` — already exists from Group 10; verify content.

`apps/api/CLAUDE.md`:
- Connection string format (`postgres://argo:…@host:port/argo`).
- Migration commands.
- OTel env vars.
- Test commands.

`apps/api/.claude/rules/`:
- `elysia-zod.md` — already exists from Group 7; verify content.
- `openapi.md` — every route has `detail: { summary, description, tags }`.
- `routes.md` — pagination + summary endpoint conventions.

Root `CLAUDE.md` — short update for `apps/*` + `packages/*` layout.

### 4. CI workflow

`.github/workflows/check.yml`:

```yaml
name: check
on:
  pull_request:
  push:
    branches: [master]

jobs:
  check:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: argo
          POSTGRES_PASSWORD: argo
          POSTGRES_DB: argo
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U argo"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL: postgres://argo:argo@localhost:5432/argo
      API_SECRET: test
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run lint
      - run: bun run format:check
      - run: bun --cwd apps/api typecheck
      - run: bun --cwd apps/dashboard typecheck
      - run: bun --cwd packages/charts typecheck
      - run: bun --cwd apps/api db:migrate
      - run: bun --cwd apps/api test
      - name: fallow analysis (report-only)
        continue-on-error: true
        run: bunx fallow --json | tee fallow-report.json
```

`fallow` step is `continue-on-error: true` until baseline is clean. `deploy.yml` is **not** edited in this group — Group 14 swaps it.

---

## Validation

```bash
bun install
bun --cwd apps/api typecheck
bun --cwd apps/dashboard typecheck
bun --cwd packages/charts typecheck
bun --cwd apps/api test
bun run lint
bun run format:check

# React Compiler healthcheck
bunx react-compiler-healthcheck || true

# CI: push a no-op PR; verify check.yml is green end-to-end
```

---

## Commit

Likely a logical split:
```
test(api): add formulas, env, and summary endpoint tests
feat(dashboard): enable react compiler via babel-plugin
docs: add minimal CLAUDE.md + rules per workspace
ci: add check workflow with postgres service + fallow report
```

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then output as the literal last line:

```
RALPH_TASK_COMPLETE: Group 13
```
