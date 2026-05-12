---
paths:
  - apps/api/**
---

# Route Conventions

## Pagination

All list endpoints use the same shape:

```ts
query: z.object({
  page: z.number().int().min(1).default(1).optional(),
  limit: z.number().int().min(1).max(200).default(50).optional(),
  sort: z.enum([...validColumns]).optional(),
  order: z.enum(['asc', 'desc']).default('desc').optional(),
})
response: z.object({ data: z.array(ItemSchema), total: z.number().int() })
```

`page` is 1-indexed. `total` is the unfiltered row count (for pagination UI).

## Summary endpoints

Summary endpoints use `WindowQuerySchema` (from `src/lib/window.ts`):

```ts
query: WindowQuerySchema // { window?: '7d'|'30d'|'90d'|'all'; from?: string; to?: string }
```

Parse with `parseWindow(query)` to get `{ from: Date; to: Date }`. Default window is 30 days.

## Response shapes

- `200`: data payload
- `201`: `{ id: number }` for creates
- `400`: `z.string()` for validation errors (e.g., unknown `exercise_id`)
- `404`: `z.string()` for missing resources

## Naming

- Route files: `<resource>.ts` (e.g., `workouts.ts`, `weight-log.ts`)
- Exported constant: `<resource>Routes` (e.g., `workoutRoutes`, `weightLogRoutes`)
- Prefix: `/<resource>` (e.g., `/workouts`, `/weight-log`)
- **Use `.get('', ...)` (empty string) for the prefix root** — `.get('/', ...)` produces a trailing slash (`/workouts/`) which is inconsistent with `/workouts/{id}`. See `openapi.md` path conventions.
- **All path and query params: camelCase** (`{exerciseId}`, `dateFrom`, `workoutId`). Never snake_case.
- **Collections are plural** (`/workouts`, `/ticktick/projects`, `/ticktick/tasks`). Never `/project/{id}` for a nested resource.

## Transactions

Use `db.transaction(async (tx) => { ... })` when creating/updating multiple tables atomically (e.g., workout + sets).
