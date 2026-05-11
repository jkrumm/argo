# RALPH Migration Notes

## Group 2: Strictness baseline (tsconfig + oxlint + lefthook)

### What was implemented

Created `tsconfig.base.json` at repo root with max-strict settings (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noPropertyAccessFromIndexSignature`, `noImplicitOverride`, `isolatedModules`, `forceConsistentCasingInFileNames`, ES2022 target). Updated `apps/api/tsconfig.json` to extend it (adding `exclude: ["src/generated/**"]`). Fixed all TypeScript errors surfaced in `apps/api/src` (19 files). Extended `.oxlintrc.json` with 9 plugins and scoped `no-restricted-imports` overrides for `apps/dashboard`, `packages/charts`, and `apps/api`. Installed `lefthook@2.1.6` with `pre-commit` hooks running `oxlint` and `oxfmt --check` on staged files.

### Deviations from PRD

- Added `// @ts-nocheck` to 5 auto-generated ticktick client files (`client.gen.ts`, `client/utils.gen.ts`, `core/params.gen.ts`, `core/pathSerializer.gen.ts`, `core/serverSentEvents.gen.ts`) rather than creating a separate tsconfig for generated code. The `exclude` option in tsconfig doesn't prevent type-checking of imported files, so this was the only clean solution.
- Added `apps/api/src/db/index.ts` to the `no-restricted-imports` override exclusions alongside `scripts/migrate-sqlite-to-pg.ts`. The `bun:sqlite`/`drizzle-orm/bun-sqlite` ban is correct but `db/index.ts` still uses SQLite until Group 3 migrates it. This override will be removed when Group 3 lands.
- `lefthook.yml` uses `bun run lint -- {staged_files}` (passing staged files through the root script) rather than `bunx oxlint {staged_files}` directly, to ensure the project's `.oxlintrc.json` config is always picked up.

### Gotchas & surprises

- `noPropertyAccessFromIndexSignature` requires bracket notation for ALL properties accessed via index signatures, including `process.env.XYZ` (must be `process.env['XYZ']`) and any `Record<string, T>` field accesses in weather.ts, ticktick.ts. About 40 `process.env` dot-access calls needed fixing.
- `exactOptionalPropertyTypes` is the most viral flag: any `{ key: value | undefined }` object cannot be passed to `{ key?: value }` typed parameters. Required switching to conditional spread patterns (`...(x !== undefined ? { key: x } : undefined)`) throughout slack.ts, gmail.ts, google.ts route handlers.
- `noUncheckedIndexedAccess` breaks `const [{ count }] = await db.select(...)` — array destructuring returns `T | undefined` for the first element. Fixed to `const countResult = await db.select(...); const count = countResult[0]?.count ?? 0`.
- Regex capture groups (`match[1]`, `match[2]`) become `string | undefined` with `noUncheckedIndexedAccess`; added `!` assertions since the surrounding `if (match)` guarantees the groups exist.
- `unicorn(no-useless-spread)` fired on `{...(condition ? value : {})}` patterns — fixed by using `undefined` in the falsy branch instead of `{}` (spreading `undefined` in an object is valid JS and doesn't trigger the rule).
- `unicorn(no-single-promise-in-promise-methods)` and `unicorn(no-useless-spread)` required 4 fixes in existing google.ts and uptime-kuma.ts code.

### Security notes

No secrets touched. All `process.env` access remains bracket notation only after this group, setting precedent for `env.ts` centralization in Group 3/7.

### Tests added

None (Group 2 is tooling-only).

### Future improvements

- `packages/dashboard` has 72 lint warnings from the new unicorn/promise plugins (`no-array-sort`, `no-underscore-dangle`, `promise/always-return`). These are in legacy code that will be deleted in Group 11 — not worth fixing now.
- `apps/api/src/db/index.ts` override for `no-restricted-imports` should be removed in Group 3 when SQLite is replaced with Postgres.
- Generated ticktick files have `// @ts-nocheck`. When the API client is regenerated in a future group, the generator config should be updated to add this pragma automatically, or the files should be moved to a package with its own loose tsconfig.

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
