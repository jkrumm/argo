# Group 2: Strictness baseline (TS base + extended oxlint + lefthook)

## What You're Doing

Land the strictness scaffolding **before** any large code changes hit the codebase. After this group:

- `tsconfig.base.json` at the repo root holds max-strict settings; `apps/api/tsconfig.json` (the only existing tsconfig at this point) extends it. Every later `tsconfig.json` (dashboard, charts) extends it on creation.
- `.oxlintrc.json` carries an extended plugin set + `no-restricted-imports` patterns scoped per-workspace.
- `lefthook` is installed at the repo root and runs `oxlint` + `oxfmt --check` on staged files before commit.
- (React Compiler is **not** wired here — `apps/dashboard` does not exist yet. Group 4 wires it during the scaffold.)

Why this group runs **before** Groups 3–9: pulling strictness forward catches errors at write-time across every later group, instead of cascading into a single end-of-migration cleanup pit.

---

## Required Reading

1. **The PRD section** for the related work — `docs/MANTINE-MIGRATION-PRD.md` Group 10 covers types/lint/lefthook in detail. Lift the TypeScript / oxlint / lefthook subsections; **leave** tests, rules, CLAUDE.md, and CI to the renumbered Group 13.
2. The **TypeScript baseline**, **Pre-commit lefthook**, **oxlint extensions** subsections in the PRD's Architecture block.
3. Existing `.oxlintrc.json` (read it before extending).
4. `~/SourceRoot/dotfiles/rules/typescript.md` + `~/SourceRoot/dotfiles/rules/code-style.md`.
5. lefthook docs: https://lefthook.dev/
6. Whatever oxlint plugin set is current — verify via `/research` if a plugin name appears unrecognized.

---

## What to Implement

### 1. `tsconfig.base.json` at repo root

Max-strict baseline (exact content per the PRD's TypeScript baseline section). Includes `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noPropertyAccessFromIndexSignature`, `isolatedModules`, `forceConsistentCasingInFileNames`, `useDefineForClassFields`, ES2022 target.

### 2. Update `apps/api/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["bun-types"]
  }
}
```

Run `bun --cwd apps/api typecheck`. Fix surfaced errors **properly** — never loosen the baseline. The current api code (still SQLite) is small enough that fixes are bounded. Common patterns: `assertExists()`, `?? default`, narrowing with `if (!x) throw`, model the optional in the type definition.

### 3. Extend `.oxlintrc.json`

Plugins: `react`, `react-perf`, `typescript`, `import`, `unicorn`, `jsx-a11y`, `promise`, `oxc`, `jsdoc`.

`overrides` blocks (scoped to paths that may not exist yet — that's fine, oxlint ignores missing globs):

- `apps/dashboard/src/**`: ban `antd`, `@ant-design/*`, `@refinedev/*`, `react-router`, `react-router-dom`, `@visx/tooltip`.
- `packages/charts/src/**`: ban `@mantine/*`, `apps/*` (relative or absolute).
- `apps/api/src/**`: ban `bun:sqlite`, `drizzle-orm/bun-sqlite` (Group 3 leaves them only in `scripts/migrate-sqlite-to-pg.ts`, which gets a per-file override).
- `apps/api/scripts/migrate-sqlite-to-pg.ts`: turn `no-restricted-imports` off.

See `docs/MANTINE-MIGRATION-PRD.md` Group 10 for the exact JSON shape — copy that as the starting point.

### 4. Install `lefthook`

```bash
bun add -D lefthook
```

Write `lefthook.yml` at repo root:

```yaml
pre-commit:
  parallel: true
  commands:
    oxlint:
      glob: "*.{ts,tsx,js,jsx}"
      run: bun run lint -- {staged_files}
    oxfmt:
      glob: "*.{ts,tsx,js,jsx,json,md,yml,yaml}"
      run: bunx oxfmt --check {staged_files}
```

Install hooks: `bun lefthook install`. Note: the ralph runner installs its own `pre-push` hook that overrides any lefthook config — that's expected and only active while the runner is running.

### 5. Update root `package.json` scripts

Confirm `lint`, `format`, `format:check` still work after the oxlint changes. Adjust globs if needed.

### 6. Smoke-test the chain

```bash
bun install
bun run lint
bun run format:check
bun --cwd apps/api typecheck
# Stage a file, attempt a commit, verify oxlint runs via lefthook pre-commit
echo "" >> apps/api/src/index.ts
git add apps/api/src/index.ts
git commit -m "test: lefthook smoke" --dry-run 2>&1 | head -5
git restore --staged apps/api/src/index.ts
git checkout -- apps/api/src/index.ts
```

---

## Validation

```bash
bun install
bun --cwd apps/api typecheck
bun run lint
bun run format:check
bun lefthook run pre-commit  # should pass with no staged files (noop) or run cleanly
```

---

## Commit

```
chore(repo): add tsconfig.base.json max-strict baseline
chore(repo): extend oxlint plugins + scoped no-restricted-imports bans
chore(repo): add lefthook pre-commit hooks (oxlint + oxfmt)
```

Or one bundled commit if you prefer:
```
chore(repo): land strictness baseline (tsconfig + oxlint + lefthook)
```

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then output as the literal last line:

```
RALPH_TASK_COMPLETE: Group 2
```
