---
paths:
  - apps/api/**
---

# OpenAPI — Route Detail Conventions

Every route must have a `detail` block:

```ts
.get('/my-endpoint', handler, {
  query: QuerySchema,
  response: ResponseSchema,
  detail: {
    tags: ['TagName'],
    summary: 'Short one-line summary',
    description: 'Full description with parameter semantics and examples.',
    security: [{ BearerAuth: [] }],
  },
})
```

## Tags

| Tag            | Routes                               |
| -------------- | ------------------------------------ |
| `Summaries`    | `*/summary` and `*/series` endpoints |
| `Workouts`     | workout CRUD                         |
| `DailyMetrics` | daily health metrics                 |
| `WeightLog`    | body weight entries                  |
| `Exercises`    | exercise reference                   |
| `UserProfile`  | user profile singleton               |

## Scalar UI

Available at `/openapi` (interactive). Raw JSON at `/openapi/json`. The plugin config in `src/index.ts` uses `mapJsonSchema: { zod: z.toJSONSchema }` — required for Zod v4 schemas to render correctly.

## Security

All routes except `/health` require `BearerAuth`. Include `security: [{ BearerAuth: [] }]` in every `detail` block. The auth guard is wired in `src/index.ts` — individual route modules do not need to re-apply it, but the OpenAPI spec still needs the annotation.
