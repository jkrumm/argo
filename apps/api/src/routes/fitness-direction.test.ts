import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { fitnessDirectionRoutes } from './fitness-direction.js'
import { db, runMigrations } from '../db/index.js'
import { dailyMetrics } from '../db/schema.js'

beforeAll(async () => {
  await runMigrations()
})

type Body = {
  signal: 'improving' | 'stable' | 'declining'
  label: string
  symbol: string
  color: string
  rhrSlope: number | null
  hrvSlope: number | null
  rhrDelta: number | null
  hrvDelta: number | null
  vo2max: number | null
}

describe('GET /fitness-direction', () => {
  afterEach(async () => {
    await db.delete(dailyMetrics)
  })

  it('returns stable signal with no data', async () => {
    const app = new Elysia().use(fitnessDirectionRoutes)
    const res = await app.handle(
      new Request('http://localhost/fitness-direction?from=2025-06-01&to=2025-06-30', {
        headers: { Authorization: `Bearer ${process.env['API_SECRET'] ?? ''}` },
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Body
    expect(body.signal).toBe('stable')
    expect(body.rhrSlope).toBeNull()
    expect(body.hrvSlope).toBeNull()
  })

  it('classifies improving when RHR drops + HRV rises over 14 days', async () => {
    const rows = []
    for (let i = 0; i < 14; i++) {
      const day = String(i + 1).padStart(2, '0')
      rows.push({
        date: `2025-06-${day}`,
        resting_hr: 60 - i, // slope -1 bpm/day → far below -0.05
        hrv_last_night_avg: 30 + i * 2, // slope +2 ms/day → far above 0.1
        vo2_max: 45 + i * 0.1,
      })
    }
    await db.insert(dailyMetrics).values(rows)

    const app = new Elysia().use(fitnessDirectionRoutes)
    const res = await app.handle(
      new Request('http://localhost/fitness-direction?from=2025-06-01&to=2025-06-30', {
        headers: { Authorization: `Bearer ${process.env['API_SECRET'] ?? ''}` },
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Body
    expect(body.signal).toBe('improving')
    expect(body.label).toBe('Improving')
    expect(body.symbol).toBe('▲')
    expect(body.rhrSlope).toBeLessThan(0)
    expect(body.hrvSlope).toBeGreaterThan(0)
    expect(body.vo2max).not.toBeNull()
  })
})
