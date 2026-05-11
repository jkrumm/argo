# Group 7: API schema lib swap (TypeBox → Zod) + OpenAPI plugin

> **🚨 PRODUCTION DEPLOY PAUSE STARTS HERE.** After this group lands, production must **not** be redeployed until the Group 14 cutover. The new validation library + OpenAPI plugin alone don't break the dashboard contract, but the next two groups (pagination convention + summary endpoints) do — they all ship in the same cutover. Coordinate with the maintainer before pushing `master`.

## What You're Doing

Migrate every route's `body` / `query` / `params` / `response` from TypeBox `t.*` to Zod `z.*` via Standard Schema. Replace `@elysiajs/swagger` with `@elysiajs/openapi` configured with `mapJsonSchema: { zod: z.toJSONSchema }`. Add `detail: { summary, description, tags }` to every route.

This group changes the **validation library and OpenAPI tooling** — it does **not** change route shapes or behavior. Pagination convention is Group 8; summary endpoints are Group 9.

After this group, `apps/api/src/` has zero `t.*` (TypeBox) usages.

---

## Required Reading

1. **The PRD section:** `docs/MANTINE-MIGRATION-PRD.md` — Group 6c (Schema lib swap + OpenAPI curation).
2. The **Schema validation** + **Sweet patterns** subsections in the PRD's Architecture block.
3. Every route file in `apps/api/src/routes/*.ts` — you are rewriting their validators.
4. The existing `apps/api/src/index.ts` for the current `@elysiajs/swagger` setup.
5. `@elysiajs/openapi` docs: https://elysiajs.com/plugins/openapi.html
6. Zod via Standard Schema in Elysia: https://elysiajs.com/integrations/zod
7. `~/SourceRoot/dotfiles/rules/elysia.md`.
8. **basalt-ui-playground reference:** `apps/api/src/app.ts` (the `@elysiajs/openapi` + `mapJsonSchema` config) — read it first.

---

## What to Implement

### 1. Swap the plugin

Remove `@elysiajs/swagger`. Add `@elysiajs/openapi`. Configure in `apps/api/src/index.ts`:

```ts
import { openapi } from '@elysiajs/openapi';
import { z } from 'zod';

app.use(openapi({
  mapJsonSchema: { zod: z.toJSONSchema },
  documentation: {
    info: { title: 'Argo API', version: '1.0.0' },
    tags: [
      { name: 'workouts',       description: 'Strength training workouts and sets' },
      { name: 'daily-metrics',  description: 'Garmin daily health metrics' },
      { name: 'weight-log',     description: 'Body weight log' },
      { name: 'activities',     description: 'Garmin activities' },
      { name: 'exercises',      description: 'Exercise catalog' },
      { name: 'user-profile',   description: 'User profile' },
      { name: 'admin',          description: 'Cron, query, internal' },
    ],
  },
}));
```

(The `summaries` tag is added by Group 9.)

### 2. Migrate every route's validators TypeBox → Zod

Grep first: `grep -rE "from 'elysia'" apps/api/src/routes/ | grep " t " ` to find TypeBox usages.

Convert `body` / `query` / `params` / `response` per route. Zod constraints:

- Use `z.enum([...])` for literal unions (avoids the `@elysiajs/openapi` `z.union` response-serialization bug).
- Dates as ISO strings: `z.string().describe('ISO 8601 date')` or `.regex(/^\d{4}-\d{2}-\d{2}/)`. **Do not** use `z.date()` / `z.transform()`.
- No `z.custom()`, no `z.void()`, no branded types in route schemas.
- `.optional()` for optional, `.nullable()` for nullable, `.nullish()` for both.

### 3. Add `detail` to every route

Every Elysia route handler gets `detail: { summary, description, tags }`. Group routes by tag matching the OpenAPI config. Provide `.describe(...)` on schemas where field names are ambiguous.

### 4. `apps/api/.claude/rules/elysia-zod.md`

Two-page rule file capturing the Zod constraints above. Future contributors don't relearn them. The dotfiles `elysia.md` rule covers the framework basics — this rule only documents Argo's Zod constraints + the known `@elysiajs/openapi` degradations.

---

## Validation

```bash
bun install
bun --cwd apps/api typecheck
bun run lint
bun run format:check

# Confirm zero TypeBox usages
grep -rE "from 'elysia'" apps/api/src/ | grep " t " | grep -v 'src/lib' || echo "OK: no t.* remaining"
grep -rE "t\.(Object|String|Number|Array|Union|Optional|Literal)" apps/api/src/ || echo "OK"

# Spec lands cleanly
make db-up || docker compose -f apps/api/docker-compose.dev.yml up -d
bun --cwd apps/api start &
sleep 2
curl -fsS http://localhost:3000/openapi.json | jq '.paths | keys | length' # > 0
curl -fsS http://localhost:3000/openapi.json | jq '.paths | to_entries[] | .value | to_entries[] | .value.tags' | head
kill %1
```

Spec must round-trip through `openapi-typescript` cleanly. Spot-check Scalar UI in a browser at `http://localhost:3000/openapi`.

---

## Commit

```
refactor(api): migrate route validation from typebox to zod
chore(api): replace @elysiajs/swagger with @elysiajs/openapi + curated tags
docs(api): add elysia-zod rule documenting known degradations
```

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then output as the literal last line:

```
RALPH_TASK_COMPLETE: Group 7
```
