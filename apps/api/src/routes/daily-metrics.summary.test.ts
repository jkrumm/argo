import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { dailyMetricsRoutes } from './daily-metrics.js'
import { db, runMigrations } from '../db/index.js'
import { dailyMetrics } from '../db/schema.js'

beforeAll(async () => {
  await runMigrations()
})

type MetricStats = {
  current: number | null
  ma7: number | null
  ma30: number | null
  trend: string
}
type SummaryBody = {
  hrv: MetricStats
  restingHr: MetricStats
  sleep: MetricStats
  stress: MetricStats
}

describe('GET /daily-metrics/summary', () => {
  afterEach(async () => {
    await db.delete(dailyMetrics)
  })

  it('returns flat nulls when no data in window', async () => {
    const app = new Elysia().use(dailyMetricsRoutes)
    const res = await app.handle(
      new Request('http://localhost/daily-metrics/summary?from=2025-02-01&to=2025-02-28'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as SummaryBody
    expect(body.hrv.current).toBeNull()
    expect(body.hrv.trend).toBe('flat')
    expect(body.restingHr.current).toBeNull()
    expect(body.sleep.current).toBeNull()
    expect(body.stress.current).toBeNull()
  })

  it('computes rolling stats from two daily metric rows', async () => {
    await db.insert(dailyMetrics).values([
      {
        date: '2025-02-01',
        hrv_last_night_avg: 45,
        resting_hr: 55,
        sleep_score: 80,
        avg_stress: 30,
      },
      {
        date: '2025-02-02',
        hrv_last_night_avg: 50,
        resting_hr: 52,
        sleep_score: 85,
        avg_stress: 25,
      },
    ])

    const app = new Elysia().use(dailyMetricsRoutes)
    const res = await app.handle(
      new Request('http://localhost/daily-metrics/summary?from=2025-02-01&to=2025-02-28'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as SummaryBody

    // Ordered most-recent-first → 2025-02-02 is current
    expect(body.hrv.current).toBe(50)
    // ma7 = avg(50, 45) = 47.5
    expect(body.hrv.ma7).toBe(47.5)
    expect(body.hrv.ma30).toBe(47.5)

    expect(body.restingHr.current).toBe(52)
    // ma7 = avg(52, 55) = 53.5
    expect(body.restingHr.ma7).toBe(53.5)

    expect(body.sleep.current).toBe(85)
    expect(body.stress.current).toBe(25)
  })

  it('excludes rows outside the date window', async () => {
    await db.insert(dailyMetrics).values([
      { date: '2025-01-15', hrv_last_night_avg: 30 }, // outside window
      { date: '2025-02-10', hrv_last_night_avg: 60 }, // inside window
    ])

    const app = new Elysia().use(dailyMetricsRoutes)
    const res = await app.handle(
      new Request('http://localhost/daily-metrics/summary?from=2025-02-01&to=2025-02-28'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as SummaryBody
    expect(body.hrv.current).toBe(60)
    expect(body.hrv.ma7).toBe(60)
  })
})
