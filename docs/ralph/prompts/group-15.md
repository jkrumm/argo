# Group 15: Documentation polish (descriptive-voice final pass)

## What You're Doing

Cutover is live and stable. This group is the careful, extensive rewrite of every `CLAUDE.md` and `.claude/rules/*.md` against the as-built code. The output is docs that an agent could land cold and start contributing from. **No code changes** in this group except small tweaks the doc pass surfaces (renaming an export for clarity, splitting a too-large file).

The acceptance bar is an **onboarding smoke test**: a fresh-context Claude Code session, given a single prompt ("add a Docker containers dashboard page that lists running containers from `/docker/homelab/containers`"), produces a working result using only the rules + CLAUDE.md. If it can't, the rules are insufficient — iterate.

---

## Required Reading

1. **The PRD section** for this group: `docs/MANTINE-MIGRATION-PRD.md` lines 848-899 (Group 12).
2. The **Rule & doc voice convention** subsection in the PRD's Architecture block.
3. Every file you are about to rewrite:
   - Root `CLAUDE.md`.
   - `apps/api/CLAUDE.md` + `apps/api/.claude/rules/*.md`.
   - `apps/dashboard/CLAUDE.md` + `apps/dashboard/.claude/rules/*.md`.
   - `packages/charts/CLAUDE.md` (if it exists) or write one.
4. The as-built code in `apps/api/`, `apps/dashboard/`, `packages/charts/` — the docs describe what is **realized**, not what was planned.
5. `~/SourceRoot/dotfiles/rules/visx-charts.md`, `~/SourceRoot/dotfiles/rules/elysia.md`, `~/SourceRoot/dotfiles/rules/tanstack-router.md` for tone calibration and to check whether any dotfiles rule needs updating.
6. `docs/RALPH_NOTES.md` — captures the gotchas you'll convert into rules.

---

## What to Implement

### 1. Voice pass — every CLAUDE.md and rule file

Rewrite in **descriptive present-tense**. Strip:

- "we will" / "should" / "going to" / "must (someday)" — replace with what is.
- TODO / FIXME / migration roadmap residue.
- "If migrating from X" sections — convert to brief `## Legacy notes` at file bottom only if useful for archaeology.

Example transformation:

> **Before (roadmap voice):** "We will migrate from SQLite to Postgres in Group 2. Then we'll add `pgSchema('argo')`."
>
> **After (descriptive voice):** "The API uses Postgres. All tables live under the `argo` schema, declared via `pgSchema('argo')` in `apps/api/src/db/schema.ts`."

### 2. Realized-pattern capture

Read the as-built code, then write rules from what is true:

- **Mantine** — exact component preferences (Stack vs Group vs Grid), spacing tokens used, theme overrides applied, common patterns (modals, notifications, forms).
- **TanStack Router** — actual loader / `ensureQueryData` / `useSuspenseQuery` pattern; how search params are validated (the `zodValidator` adapter you ended up using).
- **TanStack Query** — real query-key factory in `apps/dashboard/src/lib/queries/`; mutation + invalidation convention; devtools-only-in-dev.
- **Forms** — `@mantine/form` + `zodResolver`, exact list-helper pattern used in strength-tracker.
- **Charts** — how `@argo/charts` is consumed; the `VxBridge` wiring; sparkline exception.
- **Observability** — `hyperdx.ts` first-import rule, OTLP env vars, what a representative trace looks like.
- **Postgres** — pgSchema pattern, migration commands, SQLite legacy note at the bottom.
- **Pagination** — `page/limit/sort/order` + `{ data, total }` convention.
- **Summary endpoints** — `?window=` / `?from=&to=`, trend rule (`ma7 vs ma30`).
- **Zod constraints** — the `@elysiajs/openapi` degradations (no `z.union` in response, no `z.date()`, etc.).

### 3. "Add a page" walkthrough — `apps/dashboard/CLAUDE.md`

Single canonical walkthrough from blank file → working page, using the realized helpers. Reference real file paths:

```
1. Create `apps/dashboard/src/routes/<name>.tsx`.
2. Define a Zod `SearchSchema`; wire `validateSearch: zodValidator(SearchSchema)`.
3. Add a query factory at `apps/dashboard/src/lib/queries/<resource>.ts`.
4. Loader: `({ context, deps }) => context.queryClient.ensureQueryData(...)`.
5. Component: `useSuspenseQuery(<factory>(deps))`.
6. Add a sidebar entry in `apps/dashboard/src/routes/__root.tsx`.
7. Run `bun --cwd apps/dashboard dev` — the page is served at `/<name>`.
```

### 4. "Add a route" walkthrough — `apps/api/CLAUDE.md`

Same for adding a CRUD or summary endpoint:

```
1. Add columns / table to `apps/api/src/db/schema.ts` (under `pgSchema('argo')`).
2. `bun --cwd apps/api db:generate` produces `drizzle/NNNN_*.sql`.
3. Create the route under `apps/api/src/routes/<resource>.ts`:
   - Zod body / query / params / response schemas.
   - `detail: { summary, description, tags }`.
4. Mount the route in `apps/api/src/index.ts`.
5. Add a query factory + (if needed) a hook in `apps/dashboard/src/lib/queries/`.
6. Test in `apps/api/src/routes/<resource>.test.ts`.
```

### 5. Root `CLAUDE.md` sanity pass

Reads top-down without confusion. Links to the right per-app rules. No dangling references to `packages/dashboard`. Mentions the `apps/*` + `packages/*` layout, the `op://vps/argo/DB_PASSWORD` secret location, the local dev story.

### 6. Cross-link audit

Every rule file links to:
- Code locations it governs (`apps/dashboard/src/routes/__root.tsx:42`).
- Upstream dotfiles rules where relevant (`~/SourceRoot/dotfiles/rules/tanstack-router.md`).
- Other project rules where they interact (e.g. `forms.md` links to `tanstack-query.md` for the invalidation pattern).

### 7. Stale doc removal

Audit `docs/`:

- `docs/PRD.md` (the original) — move to `docs/archive/PRD-original.md` or annotate at the top as historical.
- `docs/MANTINE-MIGRATION-PRD.md` (this file) — annotate at the top as **completed**; keep for reference.
- `docs/GARMIN-HEALTH.md`, `docs/STRENGTH-ANALYTICS.md`, `docs/THE-QUANTIFIED-ATHLETE.md` — verify they describe current behavior; update or annotate as historical.

### 8. Dotfiles rule updates

Where the migration changed how a personal dotfiles rule applies, edit in `~/SourceRoot/dotfiles/rules/`:

- `visx-charts.md` — confirm import examples reference `@argo/charts` (Group 5 did this, verify).
- `elysia.md` — note that Argo uses Zod via Standard Schema with `@elysiajs/openapi`.
- Capture any new universal patterns as candidates for promotion to dotfiles (e.g. lefthook config shape, `tsconfig.base.json` baseline).

Commit dotfiles changes separately in `~/SourceRoot/dotfiles`.

### 9. Root `README.md`

A real README explaining: what argo is, how to clone-and-run (dev), how to deploy, where the docs live. ~150 lines max. Replaces or augments any existing minimal README.

### 10. Onboarding smoke test

In a **fresh-context Claude Code session**, run:

> "Add a Docker containers dashboard page that lists running containers from `GET /docker/homelab/containers`."

Observe whether the fresh session produces a working result using only the rules + CLAUDE.md, without re-reading the migration PRD. If it stumbles, identify the missing rule/walkthrough/cross-link and add it. Document the smoke test outcome (pass / iterations needed / final gaps closed) in `RALPH_NOTES.md`.

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

# Voice grep — should be empty / very few results:
grep -rE 'TODO|FIXME|we will|we should|we are going' apps/*/CLAUDE.md apps/*/.claude/rules/*.md packages/*/CLAUDE.md 2>/dev/null

# Cross-link sanity (no broken file refs)
# Eyeball each CLAUDE.md and rule file
```

The acceptance is human-judgment: the onboarding smoke test passes, the rule files read like documentation rather than a migration plan, and a reading pass from root → app CLAUDE.md → rules surfaces no contradictions or stale references.

---

## Commit

```
docs: descriptive-voice rewrite of every CLAUDE.md + rule file
docs: add root README
docs: archive completed migration PRDs
chore: rename `<X>` for clarity (if doc pass surfaced it)
```

Dotfiles changes commit separately in `~/SourceRoot/dotfiles`:
```
docs(rules): update elysia + visx-charts notes for argo
```

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md` (including the smoke-test outcome), then output as the literal last line:

```
RALPH_TASK_COMPLETE: Group 15
```
