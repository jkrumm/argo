# Group 8: API pagination convention swap

## What You're Doing

Swap Refine-style `_start/_end/_sort/_order` + `x-total-count` header for `page/limit/sort/order` + `{ data, total }` body on the seven dashboard-consumed list routes:

`workouts`, `workout-sets`, `exercises`, `daily-metrics`, `activities`, `weight-log`, `user-profile`.

Single-resource GETs (`/exercises/:id`) keep their shape. The deploy pause from Group 7 is still in effect.

---

## Required Reading

1. **The PRD section:** `docs/MANTINE-MIGRATION-PRD.md` — Group 6a (Pagination convention swap).
2. The **Light API cleanup** subsection in the PRD's Architecture block.
3. The seven route files listed above, post-Group-7 (they already use Zod).
4. Drizzle pagination patterns: `.limit()` + `.offset()`, plus a separate `count(*)` query for `total`.

---

## What to Implement

For each of the seven routes:

### Query schema

```ts
z.object({
  page:  z.coerce.number().int().min(1).default(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
  sort:  z.enum(['…allowed columns…']).optional(),
  order: z.enum(['asc', 'desc']).default('desc').optional(),
  // plus any resource-specific filters
})
```

### Response schema

```ts
z.object({
  data:  z.array(<rowSchema>),
  total: z.number().int(),
})
```

### Handler

```ts
const offset = (page - 1) * limit;
const [rows, countRow] = await Promise.all([
  db.select().from(table).where(filter).orderBy(orderClause).limit(limit).offset(offset),
  db.select({ count: count() }).from(table).where(filter),
]);
return { data: rows, total: countRow[0].count };
```

Or a window function in the same statement — your call per route, whichever is cleaner.

### Update `detail.description`

Document the new pagination contract: "Returns paginated rows. `page` 1-indexed, `limit` ≤ 200." Reflect in OpenAPI tags from Group 7.

---

## Validation

```bash
bun install
bun --cwd apps/api typecheck
bun run lint
bun run format:check

# Smoke
make db-up || docker compose -f apps/api/docker-compose.dev.yml up -d
bun --cwd apps/api start &
sleep 2
curl -fsS "http://localhost:3000/workouts?page=1&limit=10"      | jq '.data | length, .total'
curl -fsS "http://localhost:3000/daily-metrics?page=1&limit=10" | jq '.data | length, .total'
curl -fsS "http://localhost:3000/activities?page=2&limit=5"     | jq '.data | length, .total'
# Confirm x-total-count header is gone (or unused; some clients still read it — fine to keep emitting it as a bonus)
curl -fsSI "http://localhost:3000/workouts?page=1&limit=10" | grep -i x-total-count || echo "OK"
kill %1
```

---

## Commit

```
feat(api): swap pagination convention to page/limit/sort/order with { data, total }
```

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then output as the literal last line:

```
RALPH_TASK_COMPLETE: Group 8
```
