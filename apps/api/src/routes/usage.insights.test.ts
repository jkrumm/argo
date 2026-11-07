import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'bun:test'
import { Elysia } from 'elysia'
import { usageRoutes } from './usage.js'
import { sql } from 'drizzle-orm'
import { db, runMigrations } from '../db/index.js'
import {
  deleteCreditFixtures,
  deleteIuPortal,
  deleteUsageBySource,
  seedIuPortal,
  seedUsageRecords,
  type SeedRecord,
} from '../test/usage-seed.js'

// Integration tests for GET /usage/insights over seeded gateway rows. They need the scratch Postgres of
// `bun test:api`. The detectors' thresholds are pinned by the pure tests in lib/usage-insights.test.ts; this
// file proves the loaders feed them, the ranking and the cap survive the wire, and a quiet store is empty.

beforeAll(async () => {
  await runMigrations()
})

const app = new Elysia().use(usageRoutes)
const get = async <T>(path: string, status = 200) => {
  const res = await app.handle(new Request(`http://localhost/usage${path}`))
  expect(res.status).toBe(status)
  return (await res.json()) as T
}

const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()

interface Insights {
  asOf: string
  period: '7d' | '30d' | '90d'
  unavailable: string[]
  items: Array<{
    id: string
    rank: number
    node: string
    sentence: string
    facts: Record<string, number | string | null>
    usdMoved: number
    thin: boolean
  }>
}
const ids = (r: Insights) => r.items.map((i) => i.id)

let seq = 0
/** A gateway row on a credit pool (`iu-api` = the IU key), with a run of its own. */
function gw(
  over: Partial<SeedRecord> & { pool?: string; detail?: Record<string, unknown> } = {},
): SeedRecord {
  seq += 1
  const { pool = 'iu', detail, ...rest } = over
  const ts = over.ts ?? ago(2)
  return {
    source: 'gateway',
    source_id: `ins-${seq}`,
    ts,
    model: 'claude-sonnet-5-5',
    model_norm: 'claude-sonnet-5-5',
    billing: pool === 'iu-api' ? 'iu' : 'api_credit',
    account: pool === 'iu-api' ? null : pool,
    iu_key: pool === 'iu-api' ? 'personal' : null,
    lane: 'agw_workflow',
    lane_detail: {
      caller: 'agw',
      pool,
      workflow: 'review',
      purpose: 'prod',
      run_id: `run-${seq}`,
      ...detail,
    },
    cost_usd: 1,
    input_tokens: 60,
    cache_read_tokens: 40,
    ingested_at: ts,
    ...rest,
  }
}
const many = (n: number, make: () => SeedRecord) => Array.from({ length: n }, make)

async function clean() {
  await deleteUsageBySource('gateway')
  await deleteCreditFixtures()
  await deleteIuPortal()
}
beforeEach(clean)
afterAll(clean)

/** 15 portal days of $30 on the personal key: $450 of $500, 90 % of the cap. */
const portal = () =>
  seedIuPortal({
    costs: Array.from({ length: 15 }, (_, i) => ({
      day: ago(i).slice(0, 10),
      label: 'claude-sonnet-5-5',
      row: 1,
      cost_usd: 30,
      fetched_at: new Date(),
    })),
  })

describe('GET /usage/insights', () => {
  it('is empty when nothing stands out', async () => {
    const r = await get<Insights>('/insights')
    expect(r.period).toBe('7d')
    expect(r.items).toEqual([])
    expect(r.unavailable).toEqual([])
    expect(Number.isNaN(Date.parse(r.asOf))).toBe(false)
  })

  it('reassures when gateway traffic never touched IU with Claude', async () => {
    await seedUsageRecords(gw({ pool: 'me', ts: ago(0.1) }))
    const r = await get<Insights>('/insights')
    // The row is production on `me`, so top-share fires too; the reassurance, worth $0, ranks last.
    expect(ids(r)).toEqual(['top-share', 'claude-on-iu'])
    expect(r.items[1]).toMatchObject({
      rank: 2,
      node: 'router',
      usdMoved: 0,
      thin: true,
    })
    expect(r.items[1]!.sentence).toStartWith('no Claude work fell back to IU in the last 7 days')
  })

  it('ranks the fired detectors by money moved and keeps the top five', async () => {
    // Previous period (9–10 days ago): 50 review runs at $2 with a 90 % cache hit.
    // Current: 50 review runs at $1 with a 40 % hit, 5 digest runs, 6 `review-eval` runs on `me`.
    await seedUsageRecords([
      ...many(50, () => gw({ ts: ago(10), cost_usd: 2, input_tokens: 10, cache_read_tokens: 90 })),
      ...many(50, () => gw()),
      ...many(5, () => gw({ detail: { workflow: 'digest' } })),
      ...many(6, () => gw({ pool: 'me', detail: { purpose: 'eval', workflow: 'review-eval' } })),
    ])
    await portal()

    const r = await get<Insights>('/insights')
    expect(r.items).toHaveLength(5)
    expect(r.items.map((i) => i.rank)).toEqual([1, 2, 3, 4, 5])
    for (let i = 1; i < r.items.length; i++) {
      expect(r.items[i - 1]!.usdMoved).toBeGreaterThanOrEqual(r.items[i]!.usdMoved)
    }
    // cap-near leads on its $450 rolling spend; cache-drop and pool-split carry the caller's $61 / the two
    // pools' $61; the $50 tie of cost-per-run, mover and top-share sorts by id and top-share is cut.
    expect(ids(r)).toEqual(['cap-near', 'cache-drop', 'pool-split', 'cost-per-run', 'mover'])
    expect(r.unavailable).toEqual([])

    const by = Object.fromEntries(r.items.map((i) => [i.id, i]))
    expect(by['pool-split']).toMatchObject({
      node: 'pool:iu',
      sentence: 'me carries every eval, iu every production call.',
      usdMoved: 61,
      thin: false,
    })
    expect(by['cache-drop']!.sentence).toBe(
      "agw's cache hit rate on iu fell from 90 % to 40 % against the previous 7 days.",
    )
    expect(by['cap-near']).toMatchObject({
      node: 'key:personal',
      sentence: 'the personal key has $50 of headroom.',
      usdMoved: 450,
      thin: false,
    })
    expect(by['cap-near']!.facts['freshness']).toBe('fresh')
    expect(typeof by['cap-near']!.facts['fetchedAt']).toBe('string')
    expect(by['cost-per-run']!.sentence).toBe(
      'the cost per review fell from $2.00 to $1.00 (50 runs before, 50 now).',
    )
    expect(by['mover']!.sentence).toBe(
      'review spend fell 50 %, from $100 to $50, against the previous 7 days.',
    )
  })

  it('warns when Claude work lands on IU and names the top share', async () => {
    await seedUsageRecords([
      ...many(8, () => gw({ pool: 'iu-api', cost_usd: 1 })),
      ...many(8, () => gw({ pool: 'iu', cost_usd: 3 })),
    ])
    const r = await get<Insights>('/insights?period=30d')
    expect(r.period).toBe('30d')
    // Without gateway_picks rows the Claude rows on IU have no pick: they read as credit fallback.
    const warn = r.items.find((i) => i.id === 'claude-on-iu')
    expect(warn?.usdMoved).toBe(8)
    expect(warn?.sentence).toContain('Claude work reached IU: $8.00 in the last 30 days')
    const share = r.items.find((i) => i.id === 'top-share')
    expect(share?.sentence).toStartWith('review is 100 % of production credit in the last 30 days')
  })

  it('reads a 90 day period with the 90 days before as the comparison', async () => {
    await seedUsageRecords([
      ...many(8, () =>
        gw({ pool: 'iu', cost_usd: 3, ts: new Date(Date.now() - 60 * 86_400_000).toISOString() }),
      ),
    ])
    const r = await get<Insights>('/insights?period=90d')
    expect(r.period).toBe('90d')
    expect(r.items.find((i) => i.id === 'claude-on-iu')?.sentence).toContain('in the last 90 days')
  })

  it('drops the prior-based detectors when the previous window predates the data floor', async () => {
    const at = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()
    await seedUsageRecords([
      ...many(8, () => gw({ pool: 'iu', cost_usd: 10, ts: at(5) })),
      ...many(8, () => gw({ pool: 'iu', cost_usd: 1, ts: at(40) })),
      ...many(8, () => gw({ pool: 'iu', cost_usd: 1, ts: at(100) })),
    ])
    // 30d: the previous window (30-60 days) is inside the data, the workflow's spend moved.
    const thirty = await get<Insights>('/insights?period=30d')
    expect(ids(thirty)).toContain('mover')
    // 90d: the previous window starts before 2026-06-15, so nothing is compared against it.
    const ninety = await get<Insights>('/insights?period=90d')
    expect(ninety.unavailable).toEqual([])
    expect(
      ids(ninety).filter((id) => ['mover', 'cost-per-run', 'cache-drop'].includes(id)),
    ).toEqual([])
    expect(ids(ninety)).toContain('claude-on-iu')
  })

  it('names an unreadable source instead of looking quiet', async () => {
    await seedUsageRecords(many(3, () => gw()))
    await portal()
    // The portal table is gone for a moment: both budget reads throw, everything else still reads.
    await db.execute(sql`ALTER TABLE usage.iu_portal_cost RENAME TO iu_portal_cost_hidden`)
    let r: Insights
    try {
      r = await get<Insights>('/insights')
    } finally {
      await db.execute(sql`ALTER TABLE usage.iu_portal_cost_hidden RENAME TO iu_portal_cost`)
    }
    expect(r.unavailable).toEqual(['iu-budget:personal', 'iu-budget:athena-team'])
    expect(ids(r)).not.toContain('cap-near')
    expect(ids(r)).toContain('top-share')
  })

  it('rejects an unknown period', async () => {
    await get('/insights?period=365d', 422)
  })
})
