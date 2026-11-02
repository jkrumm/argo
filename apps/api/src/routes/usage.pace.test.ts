import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'bun:test'
import { Elysia } from 'elysia'
import { sql } from 'drizzle-orm'
import { usageRoutes } from './usage.js'
import { loadPace } from './usage-pace.js'
import { db, runMigrations } from '../db/index.js'
import {
  deleteAllUsageRecords,
  deleteCreditFixtures,
  deleteIuPortal,
  seedCreditCycles,
  seedGatewayPicks,
  seedGatewayRows,
  seedIuPortal,
  seedPlatformCost,
} from '../test/usage-seed.js'

// Integration tests for GET /usage/pace against the scratch Postgres of `bun test:api` (usage schema from
// usage-tracker's migrations). The pure arithmetic is pinned in lib/usage-pace.test.ts; this file pins
// what the reads feed it, and that every guarded table degrades to a 200.

beforeAll(async () => {
  await runMigrations()
})

const app = new Elysia().use(usageRoutes)
// The spec's headline instant: 2 Nov 2026, 16:00 UTC, the gateway's first day.
const NOW = new Date('2026-11-02T16:00:00Z')

const clear = async () => {
  await deleteAllUsageRecords()
  await deleteCreditFixtures()
  await deleteIuPortal()
}
beforeEach(clear)
afterAll(clear)

interface Pace {
  asOf: string
  cutover: string
  verdict: string
  thin: boolean
  rate: { productionUsdPerDay: number; evalUsdPerDay: number; windowHours: number }
  pools: Array<{
    account: string
    enabled: boolean
    note: string | null
    grantUsd: number
    cycle: { start: string; end: string | null; status: string }
    spentUsd: number
    meteredUsd: number
    reportedUsd: number | null
    outsideUsd: number
    reportedAt: string | null
    leftUsd: number | null
    daysLeft: number | null
    requiredUsdPerDay: number | null
    evalReserveUsd: number | null
    evalAvailableUsd: number | null
    projection: { drawsFrom: string | null; dryAt: string | null; unspentAtEndUsd: number | null }
    days: Array<{ day: string; meteredUsd: number; reportedUsd: number | null; leftUsd: number }>
    previous: { start: string; end: string; unspentUsd: number | null } | null
  }>
  spill: { from: string; until: string; days: number; claudeListUsd: number } | null
  claudeOnIuUsd: number
  personalKey: {
    rolling30Usd: number
    capUsd: number
    state: string
    underCapOn: string | null
    fetchedAt: string | null
  }
}

const near = (actual: number | null | undefined, expected: number, tolerance = 0.01) => {
  expect(actual).not.toBeNull()
  expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(tolerance)
}

async function getPace(): Promise<Pace> {
  const res = await app.handle(new Request('http://localhost/usage/pace'))
  expect(res.status).toBe(200)
  return (await res.json()) as Pace
}

/** Today's cycles, ledger and report, close to the spec's headline table. */
async function seedHeadline(): Promise<void> {
  await seedCreditCycles([
    {
      account: 'iu',
      cycle_start: '2026-10-21T00:00:00Z',
      cycle_end: '2026-11-21T00:00:00Z',
      grant_usd: 200,
    },
    {
      account: 'iu',
      cycle_start: '2026-09-21T00:00:00Z',
      cycle_end: '2026-10-21T00:00:00Z',
      grant_usd: 200,
      reconciled_usd: 181,
      unspent_usd: 19,
      closed_at: '2026-11-02T09:15:33Z',
    },
    {
      account: 'me',
      cycle_start: '2026-10-27T00:00:00Z',
      cycle_end: '2026-11-27T00:00:00Z',
      grant_usd: 100,
    },
  ])
  await seedPlatformCost([
    { account: 'iu', day: '2026-10-31', cost_usd: 56.1054, refreshed_at: '2026-11-02T15:40:27Z' },
    { account: 'iu', day: '2026-11-01', cost_usd: 0.0043, refreshed_at: '2026-11-02T15:40:27Z' },
    { account: 'iu', day: '2026-11-02', cost_usd: 43.5, refreshed_at: '2026-11-02T15:40:27Z' },
  ])
  await seedGatewayRows([
    // iu pool: production $50 + verify $5.46 = $55.46; one row has no cost_usd, only an estimate
    { id: 'g1', ts: '2026-11-02T00:26:44Z', account: 'iu', cost_usd: 30, purpose: 'prod' },
    { id: 'g2', ts: '2026-11-02T09:00:00Z', account: 'iu', cost_usd: 15, purpose: 'prod' },
    {
      id: 'g3',
      ts: '2026-11-02T11:00:00Z',
      account: 'iu',
      cost_usd: null,
      estimate: 5,
      purpose: 'prod',
    },
    { id: 'g4', ts: '2026-11-02T12:00:00Z', account: 'iu', cost_usd: 5.46, purpose: 'verify' },
    // me pool: evals only
    { id: 'g5', ts: '2026-11-02T10:00:00Z', account: 'me', cost_usd: 6.91, purpose: 'eval' },
    // IU passthrough: a Claude-Code-shaped probe, a no-pool and a drained-retry fallback, a forced
    // probe, and a GPT row agw marked as a route fallback
    { id: 'i1', ts: '2026-11-02T13:00:00Z', cost_usd: 0.25, purpose: 'verify' },
    { id: 'i2', ts: '2026-11-02T13:10:00Z', cost_usd: 2, purpose: 'prod' },
    { id: 'i3', ts: '2026-11-02T13:20:00Z', cost_usd: 0.75, purpose: 'prod' },
    { id: 'i4', ts: '2026-11-02T13:30:00Z', cost_usd: 0.01 },
    {
      id: 'i5',
      ts: '2026-11-02T13:40:00Z',
      cost_usd: 1.5,
      purpose: 'prod',
      routeFallback: 'g-refused',
    },
  ])
  await seedGatewayPicks([
    { ts: '2026-11-02T13:00:00Z', picked: 'iu-api', reason: 'claude-code', request_id: 'i1' },
    { ts: '2026-11-02T13:10:00Z', picked: 'iu-api', reason: 'no-pool', request_id: 'i2' },
    // a drained retry writes the pool pick first, then the passthrough
    { ts: '2026-11-02T13:20:00Z', picked: 'me', reason: 'soonest-expiry', request_id: 'i3' },
    { ts: '2026-11-02T13:20:00Z', picked: 'iu-api', reason: 'drained-retry', request_id: 'i3' },
    { ts: '2026-11-02T13:30:00Z', picked: 'iu-api', reason: 'forced', request_id: 'i4' },
  ])
}

describe('GET /usage/pace', () => {
  it('reads the money flow of a gateway day: spent, left, rate, waterfall, spill', async () => {
    await seedHeadline()
    const body = await loadPace(NOW)
    const pool = (account: string) => body.pools.find((p) => p.account === account)!

    // per-day max: 56.1097 outside the gateway + max(55.46 metered, 43.5 reported) today
    expect(pool('iu').meteredUsd).toBe(55.46)
    near(pool('iu').reportedUsd, 99.6097, 0.001)
    near(pool('iu').outsideUsd, 56.11, 0.001)
    near(pool('iu').spentUsd, 111.57, 0.001)
    near(pool('iu').leftUsd, 88.43, 0.001)
    expect(pool('iu').reportedAt).toBe('2026-11-02T15:40:27.000Z')
    expect(pool('iu').cycle).toEqual({
      start: '2026-10-21T00:00:00.000Z',
      end: '2026-11-21T00:00:00.000Z',
      status: 'open',
    })
    near(pool('iu').requiredUsdPerDay, 4.82, 0.01)
    near(pool('me').leftUsd, 93.09, 0.001)
    expect(pool('me').reportedUsd).toBeNull()
    near(pool('me').requiredUsdPerDay, 3.83, 0.01)

    // R: iu 55.46 + no-pool 2 + drained-retry 0.75 over the 15.55 h since the first gateway row; the
    // Claude-Code probe, the forced probe and the route-fallback row are not credit-eligible demand
    near(body.rate.windowHours, 15.55, 0.01)
    near(body.rate.productionUsdPerDay, 58.21 / (body.rate.windowHours / 24), 0.01)
    near(body.rate.evalUsdPerDay, 6.91 / (body.rate.windowHours / 24), 0.01)
    expect(body.thin).toBe(true)
    expect(body.cutover).toBe('2026-11-02T00:26:44.000Z')

    expect(body.verdict).toBe('over')
    expect(pool('iu').projection.dryAt?.slice(0, 10)).toBe('2026-11-03')
    expect(pool('me').projection.dryAt?.slice(0, 10)).toBe('2026-11-04')
    expect(body.spill?.until).toBe('2026-11-21T00:00:00.000Z')
    expect(body.spill?.from.slice(0, 10)).toBe('2026-11-04')
    expect(body.spill?.claudeListUsd).toBeGreaterThan(1000)

    // Claude on IU: claude-code 0.25 + no-pool 2 + drained-retry 0.75 + route fallback 1.5; not forced
    expect(body.claudeOnIuUsd).toBe(4.5)
  })

  it('lists me2 as not enabled with its registry grant, and every pool in the registry order', async () => {
    await seedHeadline()
    const body = await loadPace(NOW)
    expect(body.pools.map((p) => p.account)).toEqual(['iu', 'me', 'me2'])
    expect(body.pools[2]).toMatchObject({
      enabled: false,
      note: 'not enabled',
      grantUsd: 100,
      cycle: { status: 'none', end: null },
      leftUsd: null,
      days: [],
      projection: { drawsFrom: null, dryAt: null, unspentAtEndUsd: null },
    })
  })

  it('carries the burn-down and the previous cycle', async () => {
    await seedHeadline()
    const iu = (await loadPace(NOW)).pools[0]!
    expect(iu.days[0]?.day).toBe('2026-10-21')
    expect(iu.days.at(-1)?.day).toBe('2026-11-02')
    expect(iu.days.find((d) => d.day === '2026-10-31')).toMatchObject({
      meteredUsd: 0,
      reportedUsd: 56.1054,
    })
    expect(iu.days.at(-1)?.leftUsd).toBe(iu.leftUsd as number)
    expect(iu.previous).toMatchObject({
      start: '2026-09-21T00:00:00.000Z',
      end: '2026-10-21T00:00:00.000Z',
      unspentUsd: 19,
    })
  })

  it('reads a pool with a null cycle end as cycle unknown, with a balance and no projection', async () => {
    await seedCreditCycles([
      { account: 'me2', cycle_start: '2026-10-25T00:00:00Z', cycle_end: null, grant_usd: 100 },
    ])
    await seedGatewayRows([{ id: 'u1', ts: '2026-10-26T10:00:00Z', account: 'me2', cost_usd: 12 }])
    const me2 = (await loadPace(NOW)).pools.find((p) => p.account === 'me2')!
    expect(me2).toMatchObject({
      enabled: true,
      note: 'cycle unknown',
      cycle: { status: 'unknown-end', end: null },
      leftUsd: 88,
      daysLeft: null,
      projection: { drawsFrom: null, dryAt: null, unspentAtEndUsd: null },
    })
  })

  it('answers the empty shape on an empty database over HTTP', async () => {
    const body = await getPace()
    expect(body.verdict).toBe('no-pool')
    expect(body.thin).toBe(true)
    expect(body.cutover).toBe(body.asOf)
    expect(body.rate).toEqual({ productionUsdPerDay: 0, evalUsdPerDay: 0, windowHours: 0 })
    expect(body.pools.map((p) => [p.account, p.enabled])).toEqual([
      ['iu', false],
      ['me', false],
      ['me2', false],
    ])
    expect(body.spill).toBeNull()
    expect(body.claudeOnIuUsd).toBe(0)
    expect(body.personalKey).toEqual({
      rolling30Usd: 0,
      capUsd: 500,
      state: 'ok',
      underCapOn: null,
      fetchedAt: null,
    })
  })

  it('reads the personal key from the portal with its under-cap day', async () => {
    const fetched = '2026-11-02T12:00:00Z'
    // $38.5 a day for the first 15 days of the window, $1.4 after: 598.5 over the 500 cap, falling
    // by 37.1 a day as the heavy days roll off, so under on the third day
    const costs = Array.from({ length: 30 }, (_, i) => ({
      day: new Date(Date.parse('2026-10-04T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10),
      label: 'GPT 5.6 Terra',
      row: i,
      cost_usd: i < 15 ? 38.5 : 1.4,
      fetched_at: fetched,
    }))
    await seedIuPortal({ costs, totals: [] })
    const key = (await getPace()).personalKey
    expect(key).toMatchObject({
      rolling30Usd: 598.5,
      capUsd: 500,
      state: 'over',
      underCapOn: '2026-11-05',
      fetchedAt: '2026-11-02T12:00:00.000Z',
    })
  })

  it('degrades while usage.credit_cycles is missing', async () => {
    await seedHeadline()
    await db.execute(sql`ALTER TABLE usage.credit_cycles RENAME TO credit_cycles_away`)
    try {
      const body = await loadPace(NOW)
      expect(body.verdict).toBe('no-pool')
      expect(body.pools.every((p) => !p.enabled)).toBe(true)
      // the gateway rows are still read
      expect(body.claudeOnIuUsd).toBe(4.5)
    } finally {
      await db.execute(sql`ALTER TABLE usage.credit_cycles_away RENAME TO credit_cycles`)
    }
  })

  it('degrades without a provider report while usage.platform_cost is missing', async () => {
    await seedHeadline()
    await db.execute(sql`ALTER TABLE usage.platform_cost RENAME TO platform_cost_away`)
    try {
      const iu = (await loadPace(NOW)).pools[0]!
      expect(iu.reportedUsd).toBeNull()
      expect(iu.reportedAt).toBeNull()
      expect(iu.outsideUsd).toBe(0)
      near(iu.leftUsd, 144.54, 0.001)
    } finally {
      await db.execute(sql`ALTER TABLE usage.platform_cost_away RENAME TO platform_cost`)
    }
  })

  it('degrades a platform_cost of another shape to no report', async () => {
    await seedHeadline()
    await db.execute(sql`ALTER TABLE usage.platform_cost RENAME COLUMN cost_usd TO cost_cents`)
    try {
      const iu = (await loadPace(NOW)).pools[0]!
      expect(iu.reportedUsd).toBeNull()
      near(iu.leftUsd, 144.54, 0.001)
    } finally {
      await db.execute(sql`ALTER TABLE usage.platform_cost RENAME COLUMN cost_cents TO cost_usd`)
    }
  })

  it('degrades while usage.gateway_picks is missing: no IU fallback demand, route fallbacks still count', async () => {
    await seedHeadline()
    await db.execute(sql`ALTER TABLE usage.gateway_picks RENAME TO gateway_picks_away`)
    try {
      const body = await loadPace(NOW)
      near(body.rate.productionUsdPerDay, 55.46 / (body.rate.windowHours / 24), 0.01)
      expect(body.claudeOnIuUsd).toBe(1.5)
      expect(body.pools[0]?.enabled).toBe(true)
    } finally {
      await db.execute(sql`ALTER TABLE usage.gateway_picks_away RENAME TO gateway_picks`)
    }
  })

  it('serves the documented response schema over HTTP', async () => {
    await seedHeadline()
    const res = await app.handle(new Request('http://localhost/usage/pace'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Pace
    expect(Object.keys(body).toSorted()).toEqual(
      [
        'asOf',
        'claudeOnIuUsd',
        'cutover',
        'personalKey',
        'pools',
        'rate',
        'spill',
        'thin',
        'verdict',
      ].toSorted(),
    )
  })
})
