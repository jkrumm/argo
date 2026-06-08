---
paths:
  - apps/api/**
---

# OpenAPI — Tags, Paths, and Detail Blocks

The Argo API is consumed by **two classes of clients**: the Argo dashboard (Eden Treaty, gets full TypeScript types) and **AI agents** (Hermes Agent, external tools — they read the OpenAPI spec at `/openapi/json` or browse Scalar at `/openapi`). The spec is the agent contract. Treat every route's `detail` block as documentation for a stranger who has only the OpenAPI JSON.

## Discovery

- `GET /` — public root, returns `{ name, version, docs: { scalar, json }, auth, tags }`. AI agents start here.
- `GET /openapi` — Scalar interactive UI.
- `GET /openapi/json` — raw spec.

## Tag taxonomy (enum — do not invent new tags)

Every route MUST use exactly one of these twelve tags:

| Tag              | Belongs to it                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Garmin Health`  | daily-metrics, recovery, training-load, fitness-direction, activities, weight-log, user-profile, and all corresponding `*/summary` and `*/series` endpoints |
| `Strength`       | workouts, workout-sets, exercises, and all `workouts/summary/*` analytics                                                                                   |
| `WalkingPad`     | KingSmith treadmill sessions synced from the `king-smith-walkingpad-mac` Go daemon — closed-session upsert and read endpoints under `/walking-pad/*`        |
| `Productivity`   | ticktick, slack, gmail, calendar                                                                                                                            |
| `M365`           | IU Microsoft 365 via the IU MCP server — Outlook calendar, mail, Teams (chats/channels/messages), OneDrive, OneNote                                         |
| `Atlassian`      | IU Atlassian Cloud — Jira (boards, sprints, backlog, issues, JQL search) and Confluence reads                                                               |
| `GitLab`         | IU GitLab on gitlab.com — merge requests, discussions, approvals, project commits, releases, push events                                                    |
| `Infrastructure` | uptime-kuma, docker (homelab + vps)                                                                                                                         |
| `External Data`  | weather (and future read-only third-party feeds)                                                                                                            |
| `Hermes Chat`    | Hermes agent chat — streaming chat proxy (`/hermes/chat`), thread/message reads, Hermes-hosted audio range proxy (`/hermes/*`)                              |
| `AI Gateway`     | Argo-side OpenAI-compatible gateway (`/ai/v1/*`) — DeepSeek v4 Flash (titling/classification), STT, TTS                                                     |
| `System`         | `/`, `/health`, `/summary`, `/query`, `/oauth/*`                                                                                                            |

If a new route doesn't fit one of these, **expand the taxonomy in this file first**, in lockstep with the `tags:` array in `src/index.ts`. Free-form tags break the agent contract.

## Path conventions

- **No trailing slashes.** Use `.get('', handler)` (empty string), never `.get('/', handler)`. Elysia's prefix already provides the leading slash; `.get('/')` produces `/prefix/` which is inconsistent with `/prefix/{id}`.
- **Path params: camelCase.** `{exerciseId}`, `{channelId}`, `{projectId}` — never `{exercise_id}`.
- **Query params: camelCase.** `dateFrom`, `dateTo`, `displayOrder`, `sortDir`, `workoutId` — never `date_from`.
- **Collections plural.** `/workouts`, `/exercises`, `/ticktick/projects`, `/ticktick/tasks` — never `/ticktick/project/{id}` for a nested resource.
- **Action subroutes are fine** (`/daily-metrics/refresh`, `/ticktick/projects/{id}/tasks/{tid}/complete`) — a personal API isn't strict REST.
- **Cross-domain analytics live at the top level**, not nested. `/recovery`, `/training-load`, `/fitness-direction` — not `/daily-metrics/recovery`. Daily metrics are the _input_ to recovery, but recovery is its own domain.

## Required fields on every `detail` block

```ts
.get('/endpoint', handler, {
  query: QuerySchema,
  response: ResponseSchema,
  detail: {
    tags: ['Garmin Health'],         // MUST be from the enum above
    summary: 'One-line imperative',   // MUST be present (shown in Scalar sidebar)
    description: '...',                // MUST be present (1–3 sentences, see below)
    security: [{ BearerAuth: [] }],    // MUST be present except /, /health, /oauth/*
  },
})
```

### Description quality bar

The description is what an AI agent reads to decide whether to call this endpoint. It MUST cover:

1. **What it returns** — shape and semantics (e.g. "rolling 7-day HRV trend with deviation from baseline", not just "HRV data").
2. **Parameter semantics** — when does `dateFrom`/`dateTo` differ from `window`? What does `sort=date` mean for activities?
3. **When to use this vs. an alternative** — e.g. `/daily-metrics/summary` (current snapshot) vs. `/daily-metrics/series` (time series). Mention sibling endpoints by name so the agent can pivot.

Bad: `"Returns daily metrics."`
Good: `"Returns the latest day's Garmin metrics (HRV, resting HR, sleep score, stress, body battery) plus 7-day baseline deviations. Use this for an at-a-glance current snapshot; for time series across a date range use /daily-metrics/series."`

## Plugin config

```ts
import { openapi } from '@elysiajs/openapi'
import { z } from 'zod'

app.use(openapi({
  mapJsonSchema: { zod: z.toJSONSchema },     // required for Zod v4
  documentation: {
    info: { ... },
    servers: [...],
    components: { securitySchemes: { BearerAuth: { type: 'http', scheme: 'bearer' } } },
    tags: [
      { name: 'Garmin Health',  description: '...' },
      { name: 'Strength',       description: '...' },
      { name: 'Productivity',   description: '...' },
      { name: 'M365',           description: '...' },
      { name: 'Atlassian',      description: '...' },
      { name: 'Infrastructure', description: '...' },
      { name: 'External Data',  description: '...' },
      { name: 'System',         description: '...' },
    ],
  },
}))
```

The `tags` array in `documentation` must mirror this file's taxonomy exactly. Tag descriptions in `src/index.ts` explain the group to agents; route descriptions explain the operation.

## Safety net: Eden Treaty catches dashboard breakage

The dashboard imports `type App = typeof app` (apps/dashboard/src/lib/eden.ts), so path, param, and query renames surface as TypeScript errors in dashboard query files. **Always run `bun run --cwd apps/dashboard typecheck` after touching route shapes.** If TS is clean, the dashboard is fixed.

## Cross-references

- `elysia-zod.md` — Zod v4 + `@elysiajs/openapi` constraints (e.g. `z.enum` over `z.union` of literals, `z.coerce.number()` for query params)
- `routes.md` — pagination shape, summary endpoints, response codes, transactions
