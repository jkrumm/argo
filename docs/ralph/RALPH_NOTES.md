# RALPH Migration Notes

## Group 1: Workspace move & legacy preservation

### What was implemented
Moved `packages/api` → `apps/api` via `git mv` (history preserved). Updated root `package.json` workspaces to `["apps/*", "packages/*"]` and extended format globs to cover `apps/**`. Updated all Dockerfile COPY paths, `packages/dashboard/tsconfig.json` path alias (`../../apps/api/src/index.ts`), `.github/workflows/deploy.yml` api job Dockerfile path, `.gitignore`, and created a root `CLAUDE.md` with workspace layout note.

### Deviations from PRD
None — strictly followed scope.

### Gotchas & surprises
- `packages/dashboard/Dockerfile` copies `packages/api/` source for `@argo/api` type resolution during the dashboard build (type-only, stripped at compile). Both paths needed updating in this Dockerfile as well.
- The api `Dockerfile` references `packages/dashboard/package.json` for workspace resolution during `bun install --filter @argo/api`. After the workspace glob change, bun resolves `packages/*` correctly without needing `apps/dashboard` to exist yet.
- The API server cannot be smoke-tested without a live Postgres/SQLite database — the process exits before binding if env vars are missing. Typecheck + legacy dashboard build confirm module resolution is correct.
- Root `CLAUDE.md` did not exist prior to Group 1; created fresh (not a rewrite).

### Security notes
No secrets touched. `.gitignore` updated to drop `/packages/api/data/` (moved as `/apps/api/data/` which was already ignored) and `/packages/api/node_modules/`.

### Tests added
None (Group 1 is a structural move only).

### Future improvements
- The legacy dashboard `Dockerfile` still copies `apps/api/src/` for type resolution. Group 11 prune will remove this once `packages/dashboard` is deleted.
- `oxlint` reports 41 pre-existing warnings (generated ticktick code, legacy `_start/_end/_sort/_order` route params, `no-underscore-dangle` in chart internals). These predate Group 1; plan to address in Group 10 (lint/tooling pass).
