import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { skinfoldLogRoutes } from './skinfold-log.js'
import { db, runMigrations } from '../db/index.js'
import { skinfoldLog } from '../db/schema.js'

beforeAll(async () => {
  await runMigrations()
})

type SkinfoldSummary = {
  current: number | null
  ma7: number | null
  ma30: number | null
  trend: string
  weeklyDelta: number | null
  monthlyDelta: number | null
  mmPerWeek: number | null
  direction: string
  perSite: Array<{ site: string; current: number | null }>
}

type SkinfoldSeries = {
  points: Array<{
    date: string
    average: number
    readings: Array<{ site: string; valueMm: number }>
  }>
}

describe('GET /skinfold-log/summary', () => {
  afterEach(async () => {
    await db.delete(skinfoldLog)
  })

  it('returns flat nulls and stable perSite when no readings in window', async () => {
    const app = new Elysia().use(skinfoldLogRoutes)
    const res = await app.handle(
      new Request('http://localhost/skinfold-log/summary?from=2025-03-01&to=2025-03-31'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as SkinfoldSummary
    expect(body.current).toBeNull()
    expect(body.ma7).toBeNull()
    expect(body.ma30).toBeNull()
    expect(body.trend).toBe('flat')
    expect(body.weeklyDelta).toBeNull()
    expect(body.monthlyDelta).toBeNull()
    expect(body.mmPerWeek).toBeNull()
    expect(body.direction).toBe('stable')
    expect(body.perSite).toEqual([
      { site: 'abdominal', current: null },
      { site: 'suprailiac', current: null },
    ])
  })

  it('computes the per-date average across two sites', async () => {
    await db.insert(skinfoldLog).values([
      { date: '2025-03-01', site: 'abdominal', value_mm: 20 },
      { date: '2025-03-01', site: 'suprailiac', value_mm: 10 },
      { date: '2025-03-15', site: 'abdominal', value_mm: 18 },
      { date: '2025-03-15', site: 'suprailiac', value_mm: 8 },
    ])

    const app = new Elysia().use(skinfoldLogRoutes)
    const res = await app.handle(
      new Request('http://localhost/skinfold-log/summary?from=2025-03-01&to=2025-03-31'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as SkinfoldSummary

    // 2025-03-15 average = (18 + 8) / 2 = 13; 2025-03-01 average = (20 + 10) / 2 = 15
    expect(body.current).toBe(13)
    expect(body.ma7).toBe(14)
    expect(body.ma30).toBe(14)
    expect(body.weeklyDelta).toBe(-2)
    expect(body.monthlyDelta).toBe(-2)
    expect(body.perSite).toEqual([
      { site: 'abdominal', current: 18 },
      { site: 'suprailiac', current: 8 },
    ])
  })
})

describe('GET /skinfold-log/series', () => {
  afterEach(async () => {
    await db.delete(skinfoldLog)
  })

  it('pivots readings into one point per date', async () => {
    await db.insert(skinfoldLog).values([
      { date: '2025-03-01', site: 'abdominal', value_mm: 20 },
      { date: '2025-03-01', site: 'suprailiac', value_mm: 10 },
    ])

    const app = new Elysia().use(skinfoldLogRoutes)
    const res = await app.handle(
      new Request('http://localhost/skinfold-log/series?from=2025-03-01&to=2025-03-31'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as SkinfoldSeries
    expect(body.points).toHaveLength(1)
    expect(body.points[0]!.date).toBe('2025-03-01')
    expect(body.points[0]!.average).toBe(15)
    expect(body.points[0]!.readings).toEqual(
      expect.arrayContaining([
        { site: 'abdominal', valueMm: 20 },
        { site: 'suprailiac', valueMm: 10 },
      ]),
    )
  })
})

describe('POST /skinfold-log', () => {
  afterEach(async () => {
    await db.delete(skinfoldLog)
  })

  it('upserts readings, replacing an existing (date, site) on a second submit', async () => {
    const app = new Elysia().use(skinfoldLogRoutes)

    const first = await app.handle(
      new Request('http://localhost/skinfold-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: '2025-04-01',
          readings: [{ site: 'abdominal', value_mm: 20 }],
        }),
      }),
    )
    expect(first.status).toBe(201)

    const second = await app.handle(
      new Request('http://localhost/skinfold-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: '2025-04-01',
          readings: [{ site: 'abdominal', value_mm: 22 }],
        }),
      }),
    )
    expect(second.status).toBe(201)

    const rows = await db.select().from(skinfoldLog)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.value_mm).toBe(22)
  })
})

describe('DELETE /skinfold-log/:id', () => {
  afterEach(async () => {
    await db.delete(skinfoldLog)
  })

  it('returns 404 for a missing id', async () => {
    const app = new Elysia().use(skinfoldLogRoutes)
    const res = await app.handle(
      new Request('http://localhost/skinfold-log/999999', { method: 'DELETE' }),
    )
    expect(res.status).toBe(404)
  })
})
