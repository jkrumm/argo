# Group 1: Workspace move & legacy preservation

## What You're Doing

Move `packages/api` → `apps/api`. Update root `package.json` workspaces to `["apps/*", "packages/*"]`. Legacy `packages/dashboard` stays where it is and keeps building/deploying. Update `.github/workflows/deploy.yml` so the api job builds from `apps/api/Dockerfile`. Keep the `@argo/api` path alias importable from its new location.

This is the foundation group — no validation gate runs ahead of it. Leave the repo in a state where Group 2 (Postgres) and Group 3 (dashboard scaffold) can both start in parallel.

---

## Required Reading

1. **The PRD section** for this group: `docs/MANTINE-MIGRATION-PRD.md` lines 601-607 (Group 1) plus the **Migration Strategy** section (lines 508-557) for the parallelism windows and the production-deploy-pause callout.
2. The current root `package.json` (workspace globs, scripts).
3. The current `packages/api/package.json`, `packages/api/tsconfig.json`, `packages/api/Dockerfile`.
4. The current `.github/workflows/deploy.yml` (which Dockerfile paths it references for the api job).
5. Any cross-package import that hits `@argo/api` — grep for it.
6. `~/SourceRoot/dotfiles/rules/code-style.md` and `~/SourceRoot/dotfiles/rules/commit-conventions.md`.

---

## What to Implement

### 1. Move `packages/api` → `apps/api`

Use `git mv` so history follows.

### 2. Update root `package.json`

```json
{
  "workspaces": ["apps/*", "packages/*"]
}
```

Keep the existing root scripts working (`lint`, `format`, `format:check`). Adjust the format globs if they reference `packages/api`.

### 3. Update `apps/api/tsconfig.json`

Path alias `@argo/api` (or whatever it currently is) still resolves from the new location. Verify by typechecking.

### 4. Update `.github/workflows/deploy.yml`

The api job's Docker build context and Dockerfile path point at `apps/api/`. The dashboard job stays on `packages/dashboard/Dockerfile` (legacy is still deployed until Group 11). Do not change the dashboard job in this group.

### 5. Update `.gitignore`

Adjust path-specific entries: `/packages/api/node_modules/` → `/apps/api/node_modules/`. Same for `data/` if it appears.

### 6. Update root `CLAUDE.md`

A single short note that the workspace layout is `apps/*` + `packages/*`. Do not rewrite the file — Group 12 does the descriptive-voice polish.

### 7. Re-run `bun install`

Regenerate `bun.lock`. Commit the result.

---

## Validation

```bash
bun install                        # clean
bun --cwd apps/api typecheck       # passes (no behavior change)
bun --cwd apps/api start &         # boots; kill after smoke
curl -fsS http://localhost:3000/health
kill %1
bun --cwd packages/dashboard build # legacy still builds against renamed api alias
bun run lint                       # clean
bun run format:check               # clean
```

The legacy dashboard does not need to run as a dev server — `build` is enough to verify the alias still resolves.

The api deploy job's Dockerfile path is the only `.github/workflows/deploy.yml` change in this group. The dashboard job is changed in Group 11.

---

## Commit

```
refactor(repo): move packages/api → apps/api; switch workspaces to apps/* + packages/*
```

If you adjust scripts, gitignore, or deploy.yml in separate logical commits, that is fine too.

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then output as the literal last line:

```
RALPH_TASK_COMPLETE: Group 1
```
