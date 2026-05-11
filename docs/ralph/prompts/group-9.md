# Group 9: API summary endpoints (server-computed aggregates)

## What You're Doing

Add the seven server-computed summary + series endpoints so AI agents, cron jobs, and the dashboard all consume the same numbers (rolling averages, trend direction, PR detection). After this group, no dashboard page needs to do client-side aggregation — Groups 11 and 12 (pages) consume these endpoints directly.

The deploy pause from Group 7 is still in effect.

---

## Required Reading

1. **The PRD section:** `docs/MANTINE-MIGRATION-PRD.md` — Group 6b (Summary endpoints).
2. The **Sweet patterns** subsection of the PRD's Architecture block.
3. `apps/api/src/lib/formulas.ts` — Epley, Brzycki, e1RM averaging, volume, PR detection. Reuse; if a formula is missing, add it.
4. Drizzle aggregate query patterns: https://orm.drizzle.team/docs/select#aggregations
5. The Group 7 OpenAPI tags config — add a new `summaries` tag in `apps/api/src/index.ts`.

---

## What to Implement

### Endpoint set

Each summary endpoint accepts `?window=7d|30d|90d|all` (default `30d`) **or** `?from=&to=` (ISO date strings). Parse with Zod, normalize internally to `{ from: Date, to: Date }`. No caching layer; Postgres handles these aggregates trivially.

| Endpoint | Returns (sketch) |
|-|-|
| `GET /workouts/summary/strength` | `{ byExercise: [{ exercise, currentE1RM, bestE1RM, prDate, totalVolumeWindow, sessionCountWindow }] }` |
| `GET /workouts/summary/series` | `{ byExercise: [{ exercise, points: [{ date, e1rm, volume, maxWeight }] }] }` |
| `GET /daily-metrics/summary` | `{ hrv: { current, ma7, ma30, trend }, restingHr: {…}, sleep: {…}, stress: {…} }` |
| `GET /daily-metrics/series` | `{ points: [{ date, hrv, restingHr, sleepScore, stress, … }] }` |
| `GET /weight-log/summary` | `{ current, ma7, ma30, trend, weeklyDelta, monthlyDelta }` |
| `GET /weight-log/series` | `{ points: [{ date, weightKg }] }` |
| `GET /activities/summary` | `{ weeklyMinutes, weeklyByType, totalsWindow }` |

### Trend rule

`'up' | 'down' | 'flat'` derived from `ma7 vs ma30` (or equivalent). **Document the rule per metric in `detail.description`** — agents need to interpret the field without reading source.

### Window parser

A shared helper at `apps/api/src/lib/window.ts`:

```ts
export function parseWindow(input: { window?: '7d'|'30d'|'90d'|'all'; from?: string; to?: string }) {
  if (input.from && input.to) return { from: new Date(input.from), to: new Date(input.to) };
  const to = new Date();
  const days = { '7d': 7, '30d': 30, '90d': 90, 'all': 9999 }[input.window ?? '30d'];
  const from = new Date(to.getTime() - days * 86_400_000);
  return { from, to };
}
```

### Tag the endpoints

In OpenAPI, summaries belong to a `summaries` tag (added in `apps/api/src/index.ts`). Detail descriptions include the trend rule per metric.

### Smoke against real data

Group 3's local SQLite snapshot + migration gave you real data. Hit each endpoint and sanity-check the numbers against legacy production (`https://argo.jkrumm.com`).

---

## Validation

```bash
bun install
bun --cwd apps/api typecheck
bun run lint
bun run format:check

# Smoke against migrated local data
make db-up || docker compose -f apps/api/docker-compose.dev.yml up -d
bun --cwd apps/api start &
sleep 2
for ep in \
  "workouts/summary/strength" \
  "workouts/summary/series" \
  "daily-metrics/summary" \
  "daily-metrics/series" \
  "weight-log/summary" \
  "weight-log/series" \
  "activities/summary"
do
  for w in 7d 30d 90d all; do
    echo "=== /${ep}?window=${w} ==="
    curl -fsS "http://localhost:3000/${ep}?window=${w}" | jq 'if type=="object" then keys else length end'
  done
done

# Date-range form
curl -fsS "http://localhost:3000/daily-metrics/summary?from=2024-01-01&to=2024-12-31" | jq

kill %1
```

Cross-check at least one summary value (e.g. `hrv.ma7`) against legacy production for the same window. They should match within rounding error.

---

## Commit

```
feat(api): add server-computed summary + series endpoints
```

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then output as the literal last line:

```
RALPH_TASK_COMPLETE: Group 9
```
