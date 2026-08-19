import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { weightLogRoutes } from './weight-log.js'
import { db, runMigrations } from '../db/index.js'
import { weightLog } from '../db/schema.js'

beforeAll(async () => {
  await runMigrations()
})

type WeightSummary = {
  current: number | null
  ma7: number | null
  ma30: number | null
  trend: string
  weeklyDelta: number | null
  monthlyDelta: number | null
}

describe('GET /weight-log/summary', () => {
  afterEach(async () => {
    await db.delete(weightLog)
  })

  it('returns flat nulls when no entries in window', async () => {
    const app = new Elysia().use(weightLogRoutes)
    const res = await app.handle(
      new Request('http://localhost/weight-log/summary?from=2025-03-01&to=2025-03-31'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as WeightSummary
    expect(body.current).toBeNull()
    expect(body.ma7).toBeNull()
    expect(body.ma30).toBeNull()
    expect(body.trend).toBe('flat')
    expect(body.weeklyDelta).toBeNull()
    expect(body.monthlyDelta).toBeNull()
  })

  it('computes summary stats from three weight entries', async () => {
    await db.insert(weightLog).values([
      { date: '2025-03-01', weight_kg: 82 },
      { date: '2025-03-08', weight_kg: 81.5 },
      { date: '2025-03-15', weight_kg: 81 },
    ])

    const app = new Elysia().use(weightLogRoutes)
    const res = await app.handle(
      new Request('http://localhost/weight-log/summary?from=2025-03-01&to=2025-03-31'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as WeightSummary

    // Ordered most-recent-first → 2025-03-15 (81) is current
    expect(body.current).toBe(81)
    // ma7 = ma30 = avg(81, 81.5, 82) = 244.5 / 3 = 81.5
    expect(body.ma7).toBe(81.5)
    expect(body.ma30).toBe(81.5)
    // trend: ma7 === ma30 → delta = 0 → 'flat'
    expect(body.trend).toBe('flat')
    // weeklyDelta: rows[0] - rows[last] = 81 - 82 = -1 (losing weight)
    expect(body.weeklyDelta).toBe(-1)
    expect(body.monthlyDelta).toBe(-1)
  })

  // Regression: `weightLog` has no unique index on `date`, so two same-day
  // weigh-ins are storable. computeStats / weeklyDelta / monthlyDelta all
  // slice rows positionally (most-recent-first) — without folding same-date
  // rows first, a duplicated day is double-weighted in every moving average
  // and delta. Two entries on one date must produce the exact same stats as
  // a single entry at their average.
  it('folds two same-date entries into their average before computing stats', async () => {
    await db.insert(weightLog).values([
      { date: '2025-03-01', weight_kg: 82 },
      { date: '2025-03-08', weight_kg: 81.5 },
      // Two weigh-ins on 2025-03-15 averaging to 81 — same as the single-entry
      // baseline in "computes summary stats from three weight entries" above.
      { date: '2025-03-15', weight_kg: 80 },
      { date: '2025-03-15', weight_kg: 82 },
    ])

    const app = new Elysia().use(weightLogRoutes)
    const res = await app.handle(
      new Request('http://localhost/weight-log/summary?from=2025-03-01&to=2025-03-31'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as WeightSummary

    // Folded to 3 daily entries (82, 81.5, 81) — identical to the single-entry baseline.
    expect(body.current).toBe(81)
    expect(body.ma7).toBe(81.5)
    expect(body.ma30).toBe(81.5)
    expect(body.trend).toBe('flat')
    expect(body.weeklyDelta).toBe(-1)
    expect(body.monthlyDelta).toBe(-1)
  })

  it('computes single-entry summary with null deltas', async () => {
    await db.insert(weightLog).values([{ date: '2025-03-10', weight_kg: 80 }])

    const app = new Elysia().use(weightLogRoutes)
    const res = await app.handle(
      new Request('http://localhost/weight-log/summary?from=2025-03-01&to=2025-03-31'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as WeightSummary
    expect(body.current).toBe(80)
    // Only 1 entry — not enough for delta (needs ≥ 2)
    expect(body.weeklyDelta).toBeNull()
    expect(body.monthlyDelta).toBeNull()
  })
})
