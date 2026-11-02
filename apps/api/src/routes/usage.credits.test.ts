import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { sql } from 'drizzle-orm'
import { usageRoutes } from './usage.js'
import { loadCreditPools } from './usage-credits.js'
import { db, runMigrations } from '../db/index.js'

// Integration tests for the Credits tab's endpoints and the credit payers. They need the scratch
// Postgres of `bun test:api`, whose usage schema comes from usage-tracker's migrations (0014 api_credit,
// 0015 platform_cost).

beforeAll(async () => {
  await runMigrations()
})

const app = new Elysia().use(usageRoutes)
const SOURCE = 'gateway'
const MACHINE = 'credits-test'

interface Row {
  id: string
  ts: string | Date
  billing?: 'api_credit' | 'api_key' | 'max'
  account?: string | null
  apiKey?: string | null
  source?: string
  /** lane_detail.caller; null = the key is absent */
  caller?: string | null
  /** cost_usd; null = unpriced */
  cost: number | null
  /** lane_detail.costEstimatedUsd */
  estimate?: number
  input?: number
  read?: number
  write?: number
}

async function seedRows(rows: Row[]): Promise<void> {
  for (const r of rows) {
    const billing = r.billing ?? 'api_credit'
    const detail = {
      ...(r.caller === null ? {} : { caller: r.caller ?? 'agw' }),
      ...(r.estimate === undefined ? {} : { costEstimatedUsd: r.estimate }),
    }
    await db.execute(sql`
      INSERT INTO usage.records (
        source, source_id, grain, ts, billing, account, api_key, machine, outcome, lane, lane_detail,
        input_tokens, output_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens,
        reasoning_tokens, cost_usd, cost_source
      ) VALUES (
        ${r.source ?? SOURCE}, ${r.id}, 'message', ${new Date(r.ts).toISOString()}::timestamptz, ${billing},
        ${billing === 'api_key' ? null : (r.account ?? 'iu')}, ${r.apiKey ?? null}, ${MACHINE}, 'ok', 'other',
        ${JSON.stringify(detail)}::text::jsonb,
        ${r.input ?? 0}, 0, ${r.read ?? 0}, ${r.write ?? 0}, 0, 0, ${r.cost}, ${r.cost === null ? 'none' : 'prices'}
      )`)
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await app.handle(new Request(`http://localhost${path}`))
  expect(res.status).toBe(200)
  return (await res.json()) as T
}

afterEach(async () => {
  await db.execute(sql`DELETE FROM usage.records WHERE machine = ${MACHINE}`)
  await db.execute(sql`DELETE FROM usage.credit_cycles`)
  await db.execute(sql`DELETE FROM usage.platform_cost`)
  await db.execute(sql`DELETE FROM usage.gateway_picks WHERE machine = ${MACHINE}`)
})

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000)

describe('credit payers', () => {
  it('derives iu-credit, me-credit and me2-credit from api_credit + account; none is unknown', async () => {
    await seedRows([
      { id: 'p1', ts: hoursAgo(1), account: 'iu', cost: 1 },
      { id: 'p2', ts: hoursAgo(1), account: 'me', cost: 2 },
      { id: 'p3', ts: hoursAgo(1), account: 'me2', cost: 4 },
      // The IU passthrough through the gateway and a Max row are unaffected.
      { id: 'p4', ts: hoursAgo(1), billing: 'api_key', apiKey: 'personal', cost: 8 },
      { id: 'p5', ts: hoursAgo(1), billing: 'max', account: 'iu', cost: 16 },
    ])
    const grouped = await getJson<{ rows: Array<{ key: string; value: number }> }>(
      `/usage/breakdown?range=7d&metric=cost&dimension=payer&sources=${SOURCE}`,
    )
    expect(Object.fromEntries(grouped.rows.map((r) => [r.key, r.value]))).toEqual({
      'iu-credit': 1,
      'me-credit': 2,
      'me2-credit': 4,
      'iu-api': 8,
      'iu-sub': 16,
    })
    const only = await getJson<{ total: number }>(
      `/usage/breakdown?range=7d&metric=cost&dimension=source&sources=${SOURCE}&payer=me-credit&payer=me2-credit`,
    )
    expect(only.total).toBe(6)
    // The billing filter knows api_credit: it keeps the three credit rows and drops the rest.
    const byBilling = await getJson<{ total: number }>(
      `/usage/breakdown?range=7d&metric=cost&dimension=source&sources=${SOURCE}&billing=api_credit`,
    )
    expect(byBilling.total).toBe(7)
  })

  it('shows up as a payer in the split totals', async () => {
    await seedRows([{ id: 's1', ts: hoursAgo(1), account: 'me2', cost: 3, caller: 'oc' }])
    const split = await getJson<{ totals: Array<{ payer: string; cost: number }> }>(
      `/usage/split?by=sub_tool&range=7d&payer=me2-credit`,
    )
    expect(split.totals).toEqual([expect.objectContaining({ payer: 'me2-credit', cost: 3 })])
  })
})

describe('GET /usage/credits/pools', () => {
  const now = new Date('2026-11-02T12:00:00Z')

  it('burns a cycle that crosses a month end down, counting estimates and outside spend', async () => {
    await db.execute(sql`
      INSERT INTO usage.credit_cycles (account, cycle_start, cycle_end, grant_usd, metered_usd, reconciled_usd, unspent_usd, closed_at)
      VALUES ('iu', '2026-10-29T14:00:00Z', '2026-11-05T14:00:00Z', 200, 0, NULL, NULL, NULL),
             ('iu', '2026-10-01T14:00:00Z', '2026-10-29T14:00:00Z', 200, 140, 150, 50, '2026-10-30T02:00:00Z')`)
    await seedRows([
      { id: 'c0', ts: '2026-10-29T10:00:00Z', cost: 100 }, // before the cycle started
      { id: 'c1', ts: '2026-10-29T15:00:00Z', cost: 10 },
      { id: 'c2', ts: '2026-10-31T10:00:00Z', cost: 5 },
      { id: 'c3', ts: '2026-11-01T10:00:00Z', cost: null, estimate: 4 }, // unpriced: the estimate counts
      { id: 'c4', ts: '2026-11-02T01:00:00Z', cost: 1 },
      { id: 'c5', ts: '2026-11-01T10:00:00Z', account: 'me', cost: 50 }, // another pool
    ])
    await db.execute(sql`
      INSERT INTO usage.platform_cost (account, day, model, api_key_id, cost_usd, refreshed_at) VALUES
        ('iu', '2026-10-29', 'claude-opus-5-5', 'k1', 20, '2026-11-02T09:00:00Z'),
        ('iu', '2026-10-31', 'claude-opus-5-5', 'k1', 40, '2026-11-02T09:00:00Z'),
        ('iu', '2026-10-31', NULL, NULL, 16.11, '2026-11-02T09:00:00Z')`)

    const { pools } = await loadCreditPools(now)
    const iu = pools.find((p) => p.account === 'iu')!
    expect(iu.cycle).toEqual({
      status: 'open',
      start: '2026-10-29T14:00:00.000Z',
      end: '2026-11-05T14:00:00.000Z',
    })
    expect(iu.points.map((p) => p.day)).toEqual([
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
    ])
    expect(iu.points.map((p) => p.meteredUsd)).toEqual([10, 10, 15, 19, 20, null, null, null])
    expect(iu.points.map((p) => p.reportedUsd)).toEqual([
      20,
      20,
      76.11,
      76.11,
      76.11,
      null,
      null,
      null,
    ])
    expect(iu.points.map((p) => p.creditLeftUsd)).toEqual([
      180,
      180,
      123.89,
      123.89,
      123.89,
      null,
      null,
      null,
    ])
    expect(iu).toMatchObject({
      grantUsd: 200,
      meteredUsd: 20,
      meteredEstimatedUsd: 4,
      meteredEstimatedRows: 1,
      spentUsd: 76.11,
      creditLeftUsd: 123.89,
      reported: { available: true, usd: 76.11, refreshedAt: '2026-11-02T09:00:00.000Z' },
    })
    // Five days elapsed: 76.11 / 5 a day over 3 d 2 h left.
    expect(iu.dailyRateUsd).toBeCloseTo(15.222, 3)
    expect(iu.projectedUnspentUsd).toBeCloseTo(200 - 76.11 - (76.11 / 5) * (3 + 2 / 24), 3)
    expect(iu.previous).toEqual({
      cycleStart: '2026-10-01T14:00:00.000Z',
      cycleEnd: '2026-10-29T14:00:00.000Z',
      grantUsd: 200,
      meteredUsd: 140,
      reconciledUsd: 150,
      unspentUsd: 50,
    })
  })

  it('reads a null cycle_end as the last 31 days, and a pool without a cycle row as ungranted', async () => {
    await db.execute(sql`
      INSERT INTO usage.credit_cycles (account, cycle_start, cycle_end, grant_usd, metered_usd)
      VALUES ('me', '2026-10-20T00:00:00Z', NULL, 100, 0)`)
    await seedRows([
      { id: 'n1', ts: '2026-10-25T10:00:00Z', account: 'me', cost: 3 },
      { id: 'n2', ts: '2026-10-10T10:00:00Z', account: 'me', cost: 99 }, // before the cycle start
      { id: 'n3', ts: '2026-10-30T10:00:00Z', account: 'me2', cost: 7 },
    ])
    const { pools } = await loadCreditPools(now)
    expect(pools.map((p) => p.account)).toEqual(['me', 'me2'])
    const me = pools[0]!
    expect(me.cycle).toEqual({
      status: 'unknown-end',
      start: '2026-10-20T00:00:00.000Z',
      end: null,
    })
    expect(me.points).toHaveLength(31)
    expect([me.points[0]!.day, me.points.at(-1)!.day]).toEqual(['2026-10-03', '2026-11-02'])
    expect(me).toMatchObject({
      grantUsd: 100,
      meteredUsd: 3,
      creditLeftUsd: 97,
      daysLeft: null,
      projectedUnspentUsd: null,
      previous: null,
    })
    expect(me.reported).toEqual({ available: true, usd: null, refreshedAt: null })
    expect(me.points.at(-1)!.reportedUsd).toBeNull()
    const me2 = pools[1]!
    expect(me2).toMatchObject({ grantUsd: null, creditLeftUsd: null, spentUsd: 7 })
    expect(me2.points.every((p) => p.creditLeftUsd === null)).toBe(true)
  })

  it('bounds the provider figure of an open cycle by its start, and gives a pool with only closed cycles no grant', async () => {
    await db.execute(sql`
      INSERT INTO usage.credit_cycles (account, cycle_start, cycle_end, grant_usd, metered_usd)
      VALUES ('me', '2026-10-20T00:00:00Z', NULL, 100, 0)`)
    await db.execute(sql`
      INSERT INTO usage.credit_cycles (account, cycle_start, cycle_end, grant_usd, metered_usd, closed_at)
      VALUES ('iu', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', 200, 150, '2026-10-02T00:00:00Z')`)
    await db.execute(sql`
      INSERT INTO usage.platform_cost (account, day, model, api_key_id, cost_usd, refreshed_at) VALUES
        ('me', '2026-10-10', NULL, NULL, 40, '2026-11-02T09:00:00Z'),
        ('me', '2026-10-21', NULL, NULL, 6, '2026-11-02T09:00:00Z')`)
    await seedRows([{ id: 'b1', ts: '2026-10-30T10:00:00Z', account: 'iu', cost: 5 }])
    const { pools } = await loadCreditPools(now)
    const me = pools.find((p) => p.account === 'me')!
    expect(me.reported.usd).toBe(6) // the 10 Oct row predates the cycle
    expect(me.spentUsd).toBe(6)
    const iu = pools.find((p) => p.account === 'iu')!
    expect(iu).toMatchObject({ grantUsd: null, creditLeftUsd: null, spentUsd: 5 })
    expect(iu.previous).toMatchObject({ reconciledUsd: null, grantUsd: 200 })
  })

  it('counts the balance of a cycle with no known end from its start, past the 31-day chart window', async () => {
    await db.execute(sql`
      INSERT INTO usage.credit_cycles (account, cycle_start, cycle_end, grant_usd, metered_usd)
      VALUES ('me', '2026-09-20T00:00:00Z', NULL, 100, 0)`)
    await seedRows([
      { id: 'w1', ts: '2026-09-25T10:00:00Z', account: 'me', cost: 30 }, // before the axis starts
      { id: 'w2', ts: '2026-10-25T10:00:00Z', account: 'me', cost: 3 },
    ])
    await db.execute(sql`
      INSERT INTO usage.platform_cost (account, day, model, api_key_id, cost_usd, refreshed_at)
      VALUES ('me', '2026-09-25', NULL, NULL, 35, '2026-11-02T09:00:00Z')`)
    const { pools } = await loadCreditPools(now)
    const me = pools[0]!
    expect(me).toMatchObject({ meteredUsd: 33, spentUsd: 35, creditLeftUsd: 65 })
    expect(me.points).toHaveLength(31)
    // The chart starts at the balance the cycle had reached, not at the full grant.
    expect(me.points[0]).toMatchObject({ day: '2026-10-03', meteredUsd: 30, creditLeftUsd: 65 })
  })

  it('shows an ended, unclosed cycle as awaiting reconcile, never as credit left; a newer open one wins', async () => {
    await db.execute(sql`
      INSERT INTO usage.credit_cycles (account, cycle_start, cycle_end, grant_usd, metered_usd)
      VALUES ('iu', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', 200, 0)`)
    await seedRows([{ id: 'a1', ts: '2026-10-20T10:00:00Z', cost: 25 }])
    const awaiting = (await loadCreditPools(now)).pools[0]!
    expect(awaiting.cycle).toEqual({
      status: 'awaiting-reconcile',
      start: '2026-10-01T00:00:00.000Z',
      end: '2026-11-01T00:00:00.000Z',
    })
    expect(awaiting).toMatchObject({
      grantUsd: 200,
      creditLeftUsd: null,
      projectedUnspentUsd: null,
      meteredUsd: 25,
      spentUsd: 25,
    })
    expect(awaiting.points.every((p) => p.creditLeftUsd === null)).toBe(true)

    await db.execute(sql`
      INSERT INTO usage.credit_cycles (account, cycle_start, cycle_end, grant_usd, metered_usd)
      VALUES ('iu', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', 200, 0)`)
    const open = (await loadCreditPools(now)).pools[0]!
    expect(open.cycle.status).toBe('open')
    expect(open).toMatchObject({ creditLeftUsd: 200, meteredUsd: 0 })
  })

  it('degrades to the spend alone while usage.credit_cycles is missing', async () => {
    await db.execute(sql`ALTER TABLE usage.credit_cycles RENAME TO credit_cycles_away`)
    try {
      await seedRows([{ id: 'g1', ts: '2026-11-01T10:00:00Z', cost: 2 }])
      const result = await loadCreditPools(now)
      expect(result.cyclesAvailable).toBe(false)
      expect(result.pools[0]).toMatchObject({
        account: 'iu',
        grantUsd: null,
        creditLeftUsd: null,
        spentUsd: 2,
        cycle: { status: 'none' },
      })
    } finally {
      await db.execute(sql`ALTER TABLE usage.credit_cycles_away RENAME TO credit_cycles`)
    }
  })

  it('reads a platform_cost of another shape as no provider report instead of failing', async () => {
    await db.execute(sql`ALTER TABLE usage.platform_cost RENAME COLUMN cost_usd TO cost_cents`)
    try {
      await seedRows([{ id: 'sh1', ts: '2026-11-01T10:00:00Z', cost: 2 }])
      const { pools } = await loadCreditPools(now)
      expect(pools[0]).toMatchObject({
        meteredUsd: 2,
        reported: { available: false, usd: null, refreshedAt: null },
      })
    } finally {
      await db.execute(sql`ALTER TABLE usage.platform_cost RENAME COLUMN cost_cents TO cost_usd`)
    }
  })

  it('answers without a reported series while usage.platform_cost is missing', async () => {
    await db.execute(sql`ALTER TABLE usage.platform_cost RENAME TO platform_cost_away`)
    try {
      await seedRows([{ id: 'm1', ts: '2026-11-01T10:00:00Z', cost: 2 }])
      const { pools } = await loadCreditPools(now)
      expect(pools[0]).toMatchObject({
        account: 'iu',
        meteredUsd: 2,
        reported: { available: false, usd: null },
      })
    } finally {
      await db.execute(sql`ALTER TABLE usage.platform_cost_away RENAME TO platform_cost`)
    }
  })

  it('serves the pools through the route with its response schema', async () => {
    const start = hoursAgo(72).toISOString()
    const end = new Date(Date.now() + 27 * 86_400_000).toISOString()
    await db.execute(sql`
      INSERT INTO usage.credit_cycles (account, cycle_start, cycle_end, grant_usd, metered_usd)
      VALUES ('iu', ${start}::timestamptz, ${end}::timestamptz, 200, 0)`)
    await seedRows([{ id: 'r1', ts: hoursAgo(1), cost: 12.5 }])
    const body = await getJson<{
      pools: Array<{ account: string; spentUsd: number; projectedUnspentUsd: number | null }>
    }>('/usage/credits/pools')
    expect(body.pools.map((p) => p.account)).toEqual(['iu'])
    expect(body.pools[0]!.spentUsd).toBe(12.5)
    expect(body.pools[0]!.projectedUnspentUsd).toBeGreaterThan(0)
  })
})

describe('GET /usage/credits/picks', () => {
  async function seedPicks(picks: Array<[picked: string, reason: string, at: Date]>) {
    let n = 0
    for (const [picked, reason, at] of picks) {
      await db.execute(sql`
        INSERT INTO usage.gateway_picks (ts, caller, session, picked, reason, machine, request_id)
        VALUES (${at.toISOString()}::timestamptz, 'agw', NULL, ${picked}, ${reason}, ${MACHINE}, ${`req-${n++}`})`)
    }
  }

  it('counts picks by target and reason, per day, and splits fallbacks from forced and refusals', async () => {
    await seedPicks([
      ['me', 'soonest-expiry', hoursAgo(2)],
      ['me', 'soonest-expiry', hoursAgo(3)],
      ['iu', 'soonest-expiry', hoursAgo(4)],
      ['iu-api', 'forced', hoursAgo(5)],
      ['iu-api', 'claude-code', hoursAgo(6)],
      ['iu-api', 'drained', hoursAgo(7)],
      ['iu-api', 'drained', hoursAgo(8)],
      ['refused', 'balance', hoursAgo(9)],
      ['iu-api', 'no-pool', hoursAgo(24 * 20)], // outside 7d
    ])
    const week = await getJson<{
      total: number
      fallbacks: number
      refused: number
      cells: Array<{ picked: string; reason: string; count: number; fallback: boolean }>
      daily: Array<{ day: string; picked: string; reason: string; count: number }>
    }>('/usage/credits/picks?range=7d')
    expect(week).toMatchObject({ total: 8, fallbacks: 3, refused: 1 })
    expect(week.cells).toEqual([
      { picked: 'iu-api', reason: 'drained', count: 2, fallback: true },
      { picked: 'me', reason: 'soonest-expiry', count: 2, fallback: false },
      { picked: 'iu', reason: 'soonest-expiry', count: 1, fallback: false },
      { picked: 'iu-api', reason: 'claude-code', count: 1, fallback: true },
      { picked: 'iu-api', reason: 'forced', count: 1, fallback: false },
      { picked: 'refused', reason: 'balance', count: 1, fallback: false },
    ])
    // Daily rows add up to the cells, every day a UTC date.
    expect(week.daily.reduce((acc, d) => acc + d.count, 0)).toBe(8)
    expect(week.daily.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.day))).toBe(true)

    const month = await getJson<{ total: number; fallbacks: number }>(
      '/usage/credits/picks?range=30d',
    )
    expect(month).toMatchObject({ total: 9, fallbacks: 4 })
  })

  it('answers an empty, unavailable list while usage.gateway_picks is missing', async () => {
    await db.execute(sql`ALTER TABLE usage.gateway_picks RENAME TO gateway_picks_away`)
    try {
      expect(await getJson('/usage/credits/picks?range=7d')).toMatchObject({
        available: false,
        total: 0,
        cells: [],
        daily: [],
      })
    } finally {
      await db.execute(sql`ALTER TABLE usage.gateway_picks_away RENAME TO gateway_picks`)
    }
  })

  it('is empty without picks', async () => {
    expect(await getJson('/usage/credits/picks?range=7d')).toMatchObject({
      total: 0,
      fallbacks: 0,
      refused: 0,
      cells: [],
      daily: [],
    })
  })
})

describe('GET /usage/credits/cache', () => {
  it('rates the cache per caller over every gateway row, with request counts', async () => {
    await seedRows([
      { id: 'a1', ts: hoursAgo(1), caller: 'agw', cost: 1, input: 100, read: 600, write: 50 },
      { id: 'a2', ts: hoursAgo(2), caller: 'agw', cost: 1, input: 50, read: 200, write: 0 },
      { id: 'h1', ts: hoursAgo(3), caller: 'hermes', cost: 1, input: 300, read: 0, write: 100 },
      // The IU passthrough through the gateway counts: the cache belongs to the caller.
      {
        id: 'o1',
        ts: hoursAgo(4),
        caller: 'oc',
        billing: 'api_key',
        apiKey: 'personal',
        cost: 1,
        input: 10,
        read: 30,
        write: 0,
      },
      { id: 'u1', ts: hoursAgo(5), caller: null, cost: 1, input: 0, read: 0, write: 0 },
      // Not a gateway row.
      {
        id: 'x1',
        ts: hoursAgo(1),
        source: 'claude-code',
        caller: 'agw',
        cost: 1,
        input: 1000,
        read: 0,
        write: 0,
      },
    ])
    const { callers } = await getJson<{
      callers: Array<{
        caller: string
        requests: number
        input: number
        cacheRead: number
        cacheWrite: number
        hitRate: number | null
      }>
    }>('/usage/credits/cache?range=7d')
    expect(callers).toEqual([
      {
        caller: 'agw',
        requests: 2,
        input: 150,
        cacheRead: 800,
        cacheWrite: 50,
        hitRate: 800 / 1000,
      },
      { caller: '(unset)', requests: 1, input: 0, cacheRead: 0, cacheWrite: 0, hitRate: null },
      { caller: 'hermes', requests: 1, input: 300, cacheRead: 0, cacheWrite: 100, hitRate: 0 },
      { caller: 'oc', requests: 1, input: 10, cacheRead: 30, cacheWrite: 0, hitRate: 0.75 },
    ])
  })
})
