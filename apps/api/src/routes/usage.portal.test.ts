import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'bun:test'
import { Elysia } from 'elysia'
import { usageRoutes } from './usage.js'
import { runMigrations } from '../db/index.js'
import {
  deleteAllUsageRecords,
  deleteIuPortal,
  seedIuPortal,
  seedUsageRecords,
} from '../test/usage-seed.js'

beforeAll(async () => {
  await runMigrations()
})

const app = new Elysia().use(usageRoutes)
const FETCHED = '2026-10-26T12:00:00.000Z'

const get = async <T>(path: string) =>
  (await (await app.handle(new Request(`http://localhost/usage${path}`))).json()) as T

const cost = (over: { day?: string; label?: string; row?: number; costUsd?: number } = {}) => ({
  day: over.day ?? '2026-10-26',
  label: over.label ?? 'GPT 5.6 Terra',
  row: over.row ?? 0,
  model: 'gpt-5.6-terra',
  cost_usd: over.costUsd ?? 10,
  fetched_at: FETCHED,
})

const clear = async () => {
  await deleteIuPortal()
  await deleteAllUsageRecords()
}
beforeEach(clear)
afterAll(clear)

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
    await seedIuPortal({
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
  seedUsageRecords({
    source: 't',
    source_id: id,
    ts,
    billing: 'iu',
    iu_key: iuKey,
    model_norm: model,
    cost_usd: usd,
  })

/** Day i of the 30-day window ending 2026-10-26 (i = 0 is 2026-09-27). */
const dayWindow = (usd: (i: number) => number) =>
  Array.from({ length: 30 }, (_, i) =>
    cost({
      day: new Date(Date.parse('2026-09-27T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10),
      label: 'GPT 5.6 Terra',
      row: i,
      costUsd: usd(i),
    }),
  )

describe('GET /usage/iu-budget underCapOn', () => {
  it('is null without portal data', async () => {
    expect((await get<{ underCapOn: string | null }>('/iu-budget')).underCapOn).toBeNull()
  })

  it('names the first day the rolling sum drops under the cap at the last 7 days’ mean', async () => {
    // 15 × 38.5 + 15 × 1.4 = 598.5; every day the heaviest rolls off and 1.4 comes in: −37.1 a day
    await seedIuPortal({ costs: dayWindow((i) => (i < 15 ? 38.5 : 1.4)), totals: [] })
    const b = await get<{ rolling30Usd: number; underCapOn: string | null }>('/iu-budget')
    expect(b.rolling30Usd).toBe(598.5)
    // 598.5 → 561.4 (27 Oct) → 524.3 (28 Oct) → 487.2 (29 Oct)
    expect(b.underCapOn).toBe('2026-10-29')
  })

  it('is null when the key is already under the cap', async () => {
    await seedIuPortal({ costs: dayWindow(() => 5), totals: [] })
    expect((await get<{ underCapOn: string | null }>('/iu-budget')).underCapOn).toBeNull()
  })

  it('is null when it stays over for 60 days', async () => {
    await seedIuPortal({ costs: dayWindow(() => 30), totals: [] })
    expect((await get<{ underCapOn: string | null }>('/iu-budget')).underCapOn).toBeNull()
  })

  it('reads each key on its own cap', async () => {
    await seedIuPortal({
      costs: dayWindow(() => 5).map((c) => ({ ...c, iu_key: 'athena-team' })),
      totals: [],
    })
    expect(
      (await get<{ underCapOn: string | null }>('/iu-budget?iuKey=athena-team')).underCapOn,
    ).toBeNull()
  })
})

describe('GET /usage/iu-reconcile', () => {
  it('is empty without portal data', async () => {
    const r = await get<{ days: unknown[]; unpricedRows: number }>('/iu-reconcile')
    expect(r.days).toEqual([])
    expect(r.unpricedRows).toBe(0)
  })

  it('does not flag days before the first portal report', async () => {
    await seedIuPortal({
      costs: [cost({ day: '2026-10-25' }), cost({ day: '2026-10-26' })],
      totals: [],
    })
    await track('early', '2026-10-20T10:00:00Z', 50)
    const r = await get<{ days: Array<{ day: string }> }>('/iu-reconcile?days=30')
    expect(r.days.map((d) => d.day)).toEqual(['2026-10-25', '2026-10-26'])
  })

  it('compares portal and tracked per UTC day and flags the gap', async () => {
    await seedIuPortal({
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
