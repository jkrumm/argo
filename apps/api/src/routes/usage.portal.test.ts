import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'bun:test'
import { Elysia } from 'elysia'
import { usageRoutes } from './usage.js'
import { db, runMigrations } from '../db/index.js'
import { iuPortalCost, iuPortalTotal, usageRecord } from '../db/schema.js'

beforeAll(async () => {
  await runMigrations()
})

const app = new Elysia().use(usageRoutes)
const FETCHED = '2026-10-26T12:00:00.000Z'

const post = (body: unknown) =>
  app.handle(
    new Request('http://localhost/usage/iu-portal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
const get = async <T>(path: string) =>
  (await (await app.handle(new Request(`http://localhost/usage${path}`))).json()) as T

const cost = (over: Record<string, unknown> = {}) => ({
  day: '2026-10-26',
  label: 'GPT 5.6 Terra',
  row: 0,
  model: 'gpt-5.6-terra',
  costUsd: 10,
  fetchedAt: FETCHED,
  ...over,
})

beforeEach(async () => {
  await db.delete(iuPortalCost)
  await db.delete(iuPortalTotal)
  await db.delete(usageRecord)
})
afterAll(async () => {
  await db.delete(iuPortalCost)
  await db.delete(iuPortalTotal)
  await db.delete(usageRecord)
})

describe('POST /usage/iu-portal', () => {
  it('upserts costs and totals', async () => {
    const res = await post({
      costs: [cost(), cost({ label: 'Haiku', row: 1, model: null, costUsd: 2 })],
      totals: [{ month: '2026-10', totalUsd: 12, fetchedAt: FETCHED }],
    })
    expect(await res.json()).toEqual({ costs: 2, totals: 1, rejected: 0 })
    expect((await db.select().from(iuPortalCost)).length).toBe(2)
  })

  it('treats a replay as a no-op', async () => {
    const body = { costs: [cost()], totals: [] }
    await post(body)
    await post(body)
    expect((await db.select().from(iuPortalCost)).length).toBe(1)
  })

  it('overwrites a settled day on re-post', async () => {
    await post({ costs: [cost({ costUsd: 5 })], totals: [] })
    await post({ costs: [cost({ costUsd: 9, fetchedAt: '2026-10-26T16:00:00.000Z' })], totals: [] })
    const [row] = await db.select().from(iuPortalCost)
    expect(row?.cost_usd).toBe(9)
    expect(new Date(row!.fetched_at).toISOString()).toBe('2026-10-26T16:00:00.000Z')
  })

  it('ignores an older report that arrives after a newer one', async () => {
    await post({
      costs: [cost({ costUsd: 9, fetchedAt: '2026-10-26T16:00:00.000Z' })],
      totals: [{ month: '2026-10', totalUsd: 9, fetchedAt: '2026-10-26T16:00:00.000Z' }],
    })
    await post({
      costs: [cost({ costUsd: 5, fetchedAt: '2026-10-26T12:00:00.000Z' })],
      totals: [{ month: '2026-10', totalUsd: 5, fetchedAt: '2026-10-26T12:00:00.000Z' }],
    })
    expect((await db.select().from(iuPortalCost))[0]?.cost_usd).toBe(9)
    expect((await db.select().from(iuPortalTotal))[0]?.total_usd).toBe(9)
  })

  it('drops invalid rows without failing the batch', async () => {
    const res = await post({
      costs: [
        cost(),
        cost({ day: '2026-13-40', label: 'bad-day' }),
        cost({ label: 'neg', costUsd: -1 }),
        cost({ label: '', row: 2 }),
        cost({ label: 'no-time', fetchedAt: 'yesterday' }),
      ],
      totals: [{ month: 'oct', totalUsd: 1, fetchedAt: FETCHED }],
    })
    expect(await res.json()).toEqual({ costs: 1, totals: 0, rejected: 5 })
  })

  it('accepts an empty batch', async () => {
    expect(await (await post({ costs: [], totals: [] })).json()).toEqual({
      costs: 0,
      totals: 0,
      rejected: 0,
    })
  })

  it('rejects more than 1000 cost rows', async () => {
    const res = await post({ costs: Array.from({ length: 1001 }, () => cost()), totals: [] })
    expect(res.status).toBe(422)
  })
})

describe('GET /usage/iu-budget', () => {
  it('returns the empty shape without portal data', async () => {
    const b = await get<{
      fetchedAt: string | null
      rolling30Usd: number
      canSpendTodayUsd: number
    }>('/iu-budget')
    expect(b.fetchedAt).toBeNull()
    expect(b.rolling30Usd).toBe(0)
    expect(b.canSpendTodayUsd).toBe(500)
  })

  it('anchors the rolling window on the newest portal day', async () => {
    await post({
      costs: [
        cost({ day: '2026-10-26', costUsd: 22.55 }),
        cost({ day: '2026-10-25', costUsd: 26.87, label: 'B', row: 1 }),
        cost({ day: '2026-09-27', costUsd: 4.78, label: 'C', row: 2 }),
        cost({ day: '2026-09-26', costUsd: 5.43, label: 'D', row: 3 }),
      ],
      totals: [],
    })
    const b = await get<{
      fetchedAt: string
      windowFrom: string
      windowTo: string
      rolling30Usd: number
      canSpendTodayUsd: number
      dropoffNext7: Array<{ day: string; freesUsd: number }>
      topModels: Array<{ label: string }>
    }>('/iu-budget')
    expect(b.fetchedAt).toBe(FETCHED)
    expect([b.windowFrom, b.windowTo]).toEqual(['2026-09-27', '2026-10-26'])
    expect(b.rolling30Usd).toBe(54.2)
    expect(b.canSpendTodayUsd).toBe(500 - 31.65)
    expect(b.dropoffNext7[0]).toMatchObject({ day: '2026-09-27', freesUsd: 4.78 })
    expect(b.topModels[0]?.label).toBe('B')
  })
})

const track = (
  id: string,
  ts: string,
  usd: number | null,
  model: string | null = 'gpt-5.6-terra',
  iuKey: string | null = 'personal',
) =>
  db.insert(usageRecord).values({
    source: 't',
    source_id: id,
    grain: 'event',
    ts,
    billing: 'iu',
    iu_key: iuKey,
    model_norm: model,
    cost_usd: usd,
    ingested_at: ts,
  })

describe('GET /usage/iu-reconcile', () => {
  it('is empty without portal data', async () => {
    const r = await get<{ days: unknown[]; unpricedRows: number }>('/iu-reconcile')
    expect(r.days).toEqual([])
    expect(r.unpricedRows).toBe(0)
  })

  it('does not flag days before the first portal report', async () => {
    await post({ costs: [cost({ day: '2026-10-25' }), cost({ day: '2026-10-26' })], totals: [] })
    await track('early', '2026-10-20T10:00:00Z', 50)
    const r = await get<{ days: Array<{ day: string }> }>('/iu-reconcile?days=30')
    expect(r.days.map((d) => d.day)).toEqual(['2026-10-25', '2026-10-26'])
  })

  it('compares portal and tracked per UTC day and flags the gap', async () => {
    await post({
      costs: [
        cost({ day: '2026-10-22', costUsd: 71.44 }),
        cost({ day: '2026-10-26', costUsd: 10 }),
      ],
      totals: [],
    })
    await track('a', '2026-10-22T23:30:00Z', 30.21)
    await track('b', '2026-10-26T01:00:00Z', 10)
    await track('c', '2026-10-26T02:00:00Z', null)
    const r = await get<{
      days: Array<{ day: string; flagged: boolean; partial: boolean; trackedUsd: number }>
      models: Array<{ label: string; portalUsd: number; trackedUsd: number }>
      unpricedRows: number
      windowTotals: { portalUsd: number; trackedUsd: number }
    }>('/iu-reconcile?days=5')
    expect(r.days.map((d) => d.day)).toEqual([
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
    ])
    expect(r.days[0]).toMatchObject({ flagged: true, trackedUsd: 30.21 })
    expect(r.days[4]).toMatchObject({ flagged: false, partial: true })
    expect(r.unpricedRows).toBe(1)
    expect(r.windowTotals).toEqual({ portalUsd: 81.44, trackedUsd: 40.21 })
    expect(r.models[0]).toMatchObject({ portalUsd: 81.44, trackedUsd: 40.21 })
  })
})
