# Group 1: Data-model foundation (summary + type columns)

## What You're Doing

Add the two `hermes_thread` columns the Slack-feed needs — a one-line `summary` and a thread
`type` (the badge category) — wire them through the read path and frontend type, and stop
there. **No generation logic** (that's Group 2) and **no UI** (Group 5). This is a build-green
schema + plumbing foundation: after this group the columns exist, the API returns them
(always `null` for now), and everything still compiles and passes.

---

## Research & Exploration First

1. `apps/api/src/db/schema.ts` — the `hermesThread` table (lines ~338–357) under
   `pgSchema('argo')`. Note the existing nullable `title` column pattern.
2. `apps/api/src/routes/hermes.ts` — the `GET /hermes/threads` handler + its response schema
   (the thread list shape). Find how `title`/`pinned`/`status` are surfaced.
3. `apps/dashboard/src/lib/queries/hermes.ts` — the `HermesThread` frontend type.
4. `apps/api/src/routes/hermes.test.ts` — the `beforeAll` that applies the Hermes migration
   SQL **directly** via `client.unsafe()`. You will extend it.
5. An existing idempotent migration in `apps/api/drizzle/` (the Hermes one, `0009_*`) — copy
   its `IF NOT EXISTS` style.
6. `apps/api/.claude/rules/elysia-zod.md` — response-schema rules (use `z.enum`, nullable).

---

## What to Implement

### 1. Schema — `apps/api/src/db/schema.ts`

Add to `hermesThread`:

```ts
summary: text('summary'),                 // nullable — DeepSeek one-line, filled in Group 2
type: text('type'),                       // nullable — badge category, filled in Group 2
```

`type` is stored as free `text` but constrained at the application layer to a small set.
Define and export a const tuple for reuse (response schema + Group 2 classifier):

```ts
export const HERMES_THREAD_TYPES = [
  'todo',
  'podcast',
  'infra',
  'note',
  'research',
  'general',
] as const
export type HermesThreadType = (typeof HERMES_THREAD_TYPES)[number]
```

### 2. Migration

```bash
bun run --cwd apps/api db:generate
```

Then **hand-edit the generated SQL** so both `ADD COLUMN`s are idempotent:
`ALTER TABLE "argo"."hermes_thread" ADD COLUMN IF NOT EXISTS "summary" text;` (same for
`type`). This is required for the direct-apply test pattern (see shared context).

### 3. Extend the Hermes test bootstrap

In `apps/api/src/routes/hermes.test.ts`, extend the `beforeAll` to also apply your new
migration file (after `0009`), so the new columns exist in the test DB. Keep the same
`split('--> statement-breakpoint')` + `client.unsafe()` loop.

### 4. Surface in the read path

- `GET /hermes/threads` response schema in `hermes.ts`: add `summary: z.string().nullable()`
  and `type: z.enum(HERMES_THREAD_TYPES).nullable()` (import the tuple). Ensure the select
  returns these columns.
- `apps/dashboard/src/lib/queries/hermes.ts`: add `summary: string | null` and
  `type: HermesThreadType | null` (mirror the tuple) to `HermesThread`.

---

## Validation

```bash
bun run --cwd apps/api typecheck
bun run --cwd apps/dashboard typecheck
bun test --cwd apps/api src/routes/hermes.test.ts   # new columns exist, existing tests pass
bun run lint && bun run format:check
bun run --cwd apps/dashboard build
```

Add/extend a test asserting `GET /hermes/threads` returns `summary` and `type` (both `null`
for a fresh thread).

---

## Commit

```
feat(hermes-chat): add thread summary + type columns and read-path plumbing
```

Stage `apps/api/src/db/schema.ts`, the new `apps/api/drizzle/*` files, `apps/api/src/routes/hermes.ts`, `apps/api/src/routes/hermes.test.ts`, `apps/dashboard/src/lib/queries/hermes.ts`.

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then:

```
RALPH_TASK_COMPLETE: Group 1
```
