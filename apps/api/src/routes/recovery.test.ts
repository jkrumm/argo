import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { recoveryRoutes } from './recovery.js'
import { db, runMigrations } from '../db/index.js'
import { dailyMetrics } from '../db/schema.js'

beforeAll(async () => {
  await runMigrations()
})

type SnapshotBody = {
  date: string | null
  recovery: number | null
  components: { hrv: number | null; sleep: number | null; rhr: number | null }
  yesterdayActivityScore: number | null
  ceiling: number | null
  strainDebt: number
  penalty: number
}

type SeriesBody = {
  points: Array<{
    date: string
    recovery: number | null
    sleepScore: number | null
    bbHigh: number | null
  }>
}

describe('GET /recovery', () => {
  afterEach(async () => {
    await db.delete(dailyMetrics)
  })

  it('returns null snapshot when no data in window', async () => {
    const app = new Elysia().use(recoveryRoutes)
    const res = await app.handle(
      new Request('http://localhost/recovery?from=2025-03-01&to=2025-03-31'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as SnapshotBody
    expect(body.date).toBeNull()
    expect(body.recovery).toBeNull()
  })

  it('computes recovery snapshot with weighted components', async () => {
    // Seed two days. Use HRV at parity (avgHrv=50 → 50/50*100=100*0.4=40).
    // Sleep 80*0.35 = 28. RHR (50-40)/(60-40) = 0.5 → 50 → 50*0.25 = 12.5.
    // Raw = 80.5. No yesterday for first day, but snapshot returns last day.
    // Last day has yesterday = activity score of day 1.
    await db.insert(dailyMetrics).values([
      {
        date: '2025-03-01',
        hrv_last_night_avg: 50,
        sleep_score: 80,
        resting_hr: 50,
        vigorous_intensity_min: 0,
        moderate_intensity_min: 0,
        steps: 0,
      },
      {
        date: '2025-03-02',
        hrv_last_night_avg: 50,
        sleep_score: 80,
        resting_hr: 50,
        vigorous_intensity_min: 0,
        moderate_intensity_min: 0,
        steps: 0,
      },
    ])

    const app = new Elysia().use(recoveryRoutes)
    const res = await app.handle(
      new Request('http://localhost/recovery?from=2025-03-01&to=2025-03-31'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as SnapshotBody
    expect(body.date).toBe('2025-03-02')
    // min=max would make RHR component null, but min=max=50 fails maxRhr>minRhr.
    // So RHR component drops out, weight redistributes:
    // weightedSum = 40 + 28 = 68; totalWeight = 0.75; raw = 90.66… → 91
    expect(body.components.hrv).toBe(40)
    expect(body.components.sleep).toBe(28)
    expect(body.components.rhr).toBeNull()
    expect(body.recovery).toBe(91)
  })
})

describe('GET /recovery/series', () => {
  afterEach(async () => {
    await db.delete(dailyMetrics)
  })

  it('returns empty points when no data', async () => {
    const app = new Elysia().use(recoveryRoutes)
    const res = await app.handle(
      new Request('http://localhost/recovery/series?from=2025-04-01&to=2025-04-30'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as SeriesBody
    expect(body.points).toEqual([])
  })

  it('returns one point per day in ascending order', async () => {
    await db.insert(dailyMetrics).values([
      {
        date: '2025-04-01',
        hrv_last_night_avg: 45,
        sleep_score: 70,
        resting_hr: 55,
        bb_highest: 80,
      },
      {
        date: '2025-04-02',
        hrv_last_night_avg: 50,
        sleep_score: 75,
        resting_hr: 53,
        bb_highest: 85,
      },
      {
        date: '2025-04-03',
        hrv_last_night_avg: 55,
        sleep_score: 80,
        resting_hr: 50,
        bb_highest: 90,
      },
    ])

    const app = new Elysia().use(recoveryRoutes)
    const res = await app.handle(
      new Request('http://localhost/recovery/series?from=2025-04-01&to=2025-04-30'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as SeriesBody
    expect(body.points).toHaveLength(3)
    expect(body.points[0]?.date).toBe('2025-04-01')
    expect(body.points[2]?.date).toBe('2025-04-03')
    expect(body.points[2]?.bbHigh).toBe(90)
  })
})
