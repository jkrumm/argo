import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'bun:test'
import { Elysia } from 'elysia'
import { usageRoutes } from './usage.js'
import { runMigrations } from '../db/index.js'
import { deleteAllUsageRecords, seedUsageRecords, type SeedRecord } from '../test/usage-seed.js'

beforeAll(async () => {
  await runMigrations()
})

const app = new Elysia().use(usageRoutes)
const get = async <T>(path: string) =>
  (await (await app.handle(new Request(`http://localhost/usage${path}`))).json()) as T

let seq = 0
const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()

function row(over: Partial<SeedRecord>) {
  seq += 1
  const ts = over.ts ?? ago(1)
  return {
    source: 'claude-code',
    source_id: `split-${seq}`,
    grain: 'message',
    ts,
    billing: 'max',
    account: 'iu',
    iu_key: over.billing === 'iu' ? 'personal' : null,
    ingested_at: ts,
    ...over,
  } satisfies SeedRecord
}

beforeEach(async () => {
  await deleteAllUsageRecords()
})
afterAll(async () => {
  await deleteAllUsageRecords()
})

interface Split {
  prior: { from: string; to: string } | null
  totals: Array<{ payer: string; cost: number; fresh: number; prior: { cost: number } | null }>
  rows: Array<{
    key: string
    cost: number
    fresh: number
    cacheRead: number
    prior: { cost: number; fresh: number } | null
    payers: Array<{ payer: string; cost: number }>
  }>
}

describe('GET /usage/split', () => {
  const seed = () =>
    seedUsageRecords([
      row({
        project: 'argo',
        cost_usd: 10,
        input_tokens: 5,
        output_tokens: 5,
        cache_read_tokens: 100,
      }),
      row({ project: 'argo', billing: 'iu', account: null, cost_usd: 2, input_tokens: 50 }),
      row({ project: 'basalt-ui', account: 'me', cost_usd: 4 }),
      row({ project: '', billing: 'iu', account: null, cost_usd: 1 }),
      // prior window (8–14 days ago for 7d)
      row({ project: 'argo', cost_usd: 6, ts: ago(10) }),
    ])

  it('splits each key by payer and carries the prior window', async () => {
    await seed()
    const body = await get<Split>('/split?by=project&range=7d')
    expect(body.rows.map((r) => r.key)).toEqual(['argo', 'basalt-ui', '(unset)'])
    const argo = body.rows[0]!
    expect(argo).toMatchObject({ cost: 12, fresh: 60, cacheRead: 100, prior: { cost: 6 } })
    expect(argo.payers.map((p) => p.payer)).toEqual(['iu-sub', 'iu-api'])
    expect(body.totals.find((t) => t.payer === 'iu-sub')).toMatchObject({
      cost: 10,
      prior: { cost: 6 },
    })
    expect(body.prior).not.toBeNull()
  })

  it('filters by payer', async () => {
    await seed()
    const body = await get<Split>('/split?by=project&range=7d&payer=iu-api')
    expect(body.rows.map((r) => r.key)).toEqual(['argo', '(unset)'])
    expect(body.totals.map((t) => t.payer)).toEqual(['iu-api'])
  })

  it('has no prior for all time', async () => {
    await seed()
    const body = await get<Split>('/split?by=sub_tool&range=all')
    expect(body.prior).toBeNull()
    expect(body.rows[0]!.prior).toBeNull()
  })
})

describe('GET /usage/rhythm', () => {
  it('returns 168 dense cells bucketed in the requested zone', async () => {
    // Monday 2026-10-19 23:30 UTC is Tuesday 01:30 in Berlin (CEST, +2).
    await seedUsageRecords([row({ ts: '2026-10-19T23:30:00Z', cost_usd: 3 })])
    const body = await get<{
      tz: string
      cells: Array<{ dow: number; hour: number; value: number }>
    }>('/rhythm?range=all&tz=Europe/Berlin')
    expect(body.tz).toBe('Europe/Berlin')
    expect(body.cells).toHaveLength(168)
    expect(body.cells.find((c) => c.value > 0)).toEqual({ dow: 1, hour: 1, value: 3 })
  })

  it('reads an unknown zone as UTC', async () => {
    const body = await get<{ tz: string }>('/rhythm?tz=Not/AZone')
    expect(body.tz).toBe('UTC')
  })
})

describe('GET /usage/timeseries grain=hour', () => {
  it('buckets by UTC hour as instants', async () => {
    await seedUsageRecords([row({ ts: ago(0.5), cost_usd: 2 })])
    const body = await get<{ buckets: Array<{ bucket: string; groups: Record<string, number> }> }>(
      '/timeseries?range=7d&grain=hour&metric=cost&groupBy=payer',
    )
    expect(body.buckets.length).toBeGreaterThan(160)
    expect(body.buckets[0]!.bucket).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/)
    const total = body.buckets.reduce((s, b) => s + (b.groups['iu-sub'] ?? 0), 0)
    expect(total).toBe(2)
  })
})

describe('me2 payer and the project filter', () => {
  it('derives me2-sub and filters a timeseries to one project', async () => {
    await seedUsageRecords([
      row({ project: 'argo', account: 'me2', cost_usd: 3 }),
      row({ project: 'brain', account: 'me2', cost_usd: 1 }),
      row({ project: 'argo', account: 'iu', cost_usd: 2 }),
    ])
    const split = await get<Split>('/split?by=project&range=7d&payer=me2-sub')
    expect(split.totals).toMatchObject([{ payer: 'me2-sub', cost: 4 }])
    const ts = await get<{ buckets: Array<{ groups: Record<string, number> }> }>(
      '/timeseries?range=7d&grain=day&metric=cost&groupBy=payer&project=argo',
    )
    const sum = (k: string) => ts.buckets.reduce((s, b) => s + (b.groups[k] ?? 0), 0)
    expect([sum('me2-sub'), sum('iu-sub')]).toEqual([3, 2])
  })
})

describe('project filter', () => {
  it('matches nothing when every value normalizes away', async () => {
    await seedUsageRecords([row({ project: 'argo', cost_usd: 3 })])
    const body = await get<Split>('/split?by=project&range=7d&project=%20')
    expect(body.rows).toEqual([])
  })
})
