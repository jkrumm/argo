import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { trainingLoadRoutes } from './training-load.js'
import { db, runMigrations } from '../db/index.js'
import { dailyMetrics } from '../db/schema.js'

beforeAll(async () => {
  await runMigrations()
})

type ZoneName = 'undertrained' | 'optimal' | 'caution' | 'danger'
type Body = {
  points: Array<{
    date: string
    dailyLoad: number | null
    acute: number | null
    chronic: number | null
    acwr: number | null
    zone: ZoneName | null
    divergence: number | null
    divPos: number | null
    divNeg: number | null
  }>
}

describe('GET /daily-metrics/training-load', () => {
  afterEach(async () => {
    await db.delete(dailyMetrics)
  })

  it('returns empty points when no data', async () => {
    const app = new Elysia().use(trainingLoadRoutes)
    const res = await app.handle(
      new Request('http://localhost/daily-metrics/training-load?from=2025-05-01&to=2025-05-31'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Body
    expect(body.points).toEqual([])
  })

  it('first day seeds EWMA so ACWR starts at 1.0 (optimal zone)', async () => {
    await db.insert(dailyMetrics).values([
      {
        date: '2025-05-01',
        vigorous_intensity_min: 30,
        moderate_intensity_min: 0,
        steps: 3000,
      },
    ])

    const app = new Elysia().use(trainingLoadRoutes)
    const res = await app.handle(
      new Request('http://localhost/daily-metrics/training-load?from=2025-05-01&to=2025-05-31'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Body
    expect(body.points).toHaveLength(1)
    const p = body.points[0]!
    // activity score: 30*8 + 0 + walkingSteps=max(0,3000-3000)*0.03=0 → 240
    expect(p.dailyLoad).toBe(240)
    expect(p.acute).toBe(240)
    expect(p.chronic).toBe(240)
    expect(p.acwr).toBe(1)
    expect(p.zone).toBe('optimal')
    expect(p.divergence).toBe(0)
  })

  it('load spike classifies as danger after acute outruns chronic', async () => {
    const rows = []
    for (let i = 1; i <= 14; i++) {
      const day = String(i).padStart(2, '0')
      rows.push({
        date: `2025-05-${day}`,
        vigorous_intensity_min: 5,
        moderate_intensity_min: 0,
        steps: 1000,
      })
    }
    // Days 15-17: massive spike
    for (let i = 15; i <= 17; i++) {
      rows.push({
        date: `2025-05-${i}`,
        vigorous_intensity_min: 120,
        moderate_intensity_min: 60,
        steps: 30000,
      })
    }
    await db.insert(dailyMetrics).values(rows)

    const app = new Elysia().use(trainingLoadRoutes)
    const res = await app.handle(
      new Request('http://localhost/daily-metrics/training-load?from=2025-05-01&to=2025-05-31'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Body
    const last = body.points[body.points.length - 1]!
    expect(last.acute).not.toBeNull()
    expect(last.chronic).not.toBeNull()
    expect(last.acute! > last.chronic!).toBe(true)
    expect(last.divPos! > 0).toBe(true)
    expect(['caution', 'danger']).toContain(last.zone as string)
  })
})
