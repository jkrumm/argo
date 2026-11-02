import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'bun:test'
import { Elysia } from 'elysia'
import { sql } from 'drizzle-orm'
import { usageRoutes } from './usage.js'
import { iuCause } from './usage-router.js'
import { db, runMigrations } from '../db/index.js'
import {
  deleteGatewayPicksByMachine,
  deleteUsageBySource,
  seedGatewayPicks,
  seedUsageRecords,
  type SeedRecord,
} from '../test/usage-seed.js'

// Integration tests for GET /usage/router. They need the scratch Postgres of `bun test:api`, whose
// usage schema comes from usage-tracker's migrations (0014 api_credit adds gateway_picks).

beforeAll(async () => {
  await runMigrations()
})

const app = new Elysia().use(usageRoutes)
const get = async <T>(path: string) => {
  const res = await app.handle(new Request(`http://localhost/usage${path}`))
  expect(res.status).toBe(200)
  return (await res.json()) as T
}

const MACHINE = 'router-test'
const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()
const day = (iso: string) => iso.slice(0, 10)

interface Router {
  picks: Array<{ day: string; target: string; reason: string; n: number }>
  iu: Array<{ day: string; cause: string; usd: number; requests: number }>
  cache: Array<{ caller: string; target: string; requests: number; hitRate: number | null }>
  picksAvailable: boolean
  routeFallbackMeasured: boolean
  lastRequestAt: string | null
}

let seq = 0
/** A gateway row; `pool` sets the billing (a credit pool, or `iu-api` for the IU key). */
function gw(
  over: Partial<SeedRecord> & {
    pool?: string
    detail?: Record<string, unknown>
    pick?: string | null
  },
): SeedRecord & { pick: string | null } {
  seq += 1
  const { pool = 'iu-api', detail, pick = null, ...rest } = over
  const ts = over.ts ?? ago(1)
  return {
    source: 'gateway',
    source_id: `rt-${seq}`,
    ts,
    model: 'claude-sonnet-5-5',
    model_norm: 'claude-sonnet-5-5',
    billing: pool === 'iu-api' ? 'iu' : 'api_credit',
    account: pool === 'iu-api' ? null : pool,
    iu_key: pool === 'iu-api' ? 'personal' : null,
    machine: MACHINE,
    lane: 'agw_workflow',
    lane_detail: { caller: 'agw', pool, ...detail },
    cost_usd: 1,
    ingested_at: ts,
    ...rest,
    pick,
  }
}

/** Seeds rows and the picks that routed them (`pick` = the reason; the target follows the pool). */
async function seed(rows: Array<ReturnType<typeof gw>>) {
  for (const { pick, ...record } of rows) {
    await seedUsageRecords(record)
    if (pick !== null) {
      await seedGatewayPicks([
        {
          ts: record.ts,
          picked: record.billing === 'iu' ? 'iu-api' : (record.account ?? 'iu'),
          reason: pick,
          machine: MACHINE,
          request_id: record.source_id,
        },
      ])
    }
  }
}

async function clean() {
  await deleteUsageBySource('gateway')
  await deleteUsageBySource('agent-workflows')
  await deleteGatewayPicksByMachine(MACHINE)
}
beforeEach(clean)
afterAll(clean)

describe('iuCause', () => {
  const base = { claude: true, evalPurpose: false, routeFallback: false, reason: null }
  it('maps every reason to a cause', () => {
    expect(iuCause({ ...base, reason: 'claude-code' })).toBe('claude-code')
    expect(iuCause({ ...base, reason: 'forced' })).toBe('forced')
    expect(iuCause({ ...base, reason: 'no-pool' })).toBe('credit-fallback')
    expect(iuCause({ ...base, reason: 'drained-retry' })).toBe('credit-fallback')
    expect(iuCause({ ...base, reason: 'eval-reserve' })).toBe('credit-fallback')
    expect(iuCause({ ...base, reason: 'eval-claude-code' })).toBe('claude-code')
    expect(iuCause({ ...base, reason: 'eval-forced' })).toBe('forced')
    expect(iuCause(base)).toBe('credit-fallback')
  })
  it('puts route fallback first and non-Claude models on design or eval', () => {
    expect(iuCause({ ...base, claude: false, routeFallback: true, reason: null })).toBe(
      'route-fallback',
    )
    expect(iuCause({ ...base, claude: false })).toBe('design')
    expect(iuCause({ ...base, claude: false, evalPurpose: true })).toBe('eval')
    // An eval-purpose Claude row is judged by its pick, not by its purpose.
    expect(iuCause({ ...base, evalPurpose: true, reason: 'forced' })).toBe('forced')
  })
})

describe('GET /usage/router iu', () => {
  it('splits IU spend by cause and equals the gateway api_key rows', async () => {
    await seed([
      gw({
        model: 'gpt-6.1-terra',
        model_norm: 'openai.gpt-6.1-terra',
        cost_usd: 2,
        pick: 'forced',
      }),
      gw({ model: 'deepseek-v4.1-flash', model_norm: 'deepseek-v4.1-flash', cost_usd: 0.5 }),
      gw({
        model: 'gpt-6.1-terra',
        model_norm: 'openai.gpt-6.1-terra',
        cost_usd: 0.25,
        detail: { purpose: 'eval' },
      }),
      gw({ cost_usd: 0.125, pick: 'claude-code' }),
      gw({ cost_usd: 4, pick: 'forced' }),
      gw({ cost_usd: 8, pick: 'no-pool' }),
      gw({ cost_usd: 16, pick: 'drained-retry' }),
      // No pick row, estimate only: a Claude row on IU nobody forced.
      gw({ cost_usd: null, detail: { costEstimated: true, costEstimatedUsd: 32 } }),
      gw({
        model: 'gpt-6.1-terra',
        model_norm: 'openai.gpt-6.1-terra',
        cost_usd: 64,
        detail: { routeFallback: 'req-refused-1' },
      }),
      // Not IU: a credit row, an Athena team row.
      gw({ pool: 'iu', cost_usd: 1000, pick: 'bound' }),
      gw({ cost_usd: 2000, iu_key: 'athena-team' }),
      // An api_key row with no IU key is OpenRouter's, not IU's.
      gw({ cost_usd: 3000, billing: 'openrouter', iu_key: null }),
    ])
    const body = await get<Router>('/router?range=7d')
    const byCause = Object.fromEntries(
      body.iu.map((r) => [r.cause, { usd: r.usd, requests: r.requests }]),
    )
    expect(byCause).toEqual({
      design: { usd: 2.5, requests: 2 },
      eval: { usd: 0.25, requests: 1 },
      'claude-code': { usd: 0.125, requests: 1 },
      forced: { usd: 4, requests: 1 },
      'credit-fallback': { usd: 56, requests: 3 },
      'route-fallback': { usd: 64, requests: 1 },
    })
    expect(body.iu.every((r) => r.day === day(ago(1)))).toBe(true)

    // Pass criterion 3: the IU total is the gateway's api_key rows (estimate for the unpriced one), Athena aside.
    const [truth] = (await db.execute(sql`
      SELECT COALESCE(SUM(COALESCE(cost_usd, (lane_detail->>'costEstimatedUsd')::float8)), 0)::float8 AS usd
      FROM usage.records
      WHERE source = 'gateway' AND billing = 'api_key' AND api_key = 'personal' AND machine = ${MACHINE}
    `)) as unknown as Array<{ usd: number }>
    expect(body.iu.reduce((acc, r) => acc + r.usd, 0)).toBeCloseTo(truth!.usd, 6)
    expect(truth!.usd).toBeCloseTo(126.875, 6)
  })

  it('prefers the IU pick of a request that a pool refused first', async () => {
    const row = gw({ cost_usd: 3 })
    await seed([row])
    await seedGatewayPicks([
      {
        ts: ago(1),
        picked: 'iu',
        reason: 'bound',
        machine: MACHINE,
        request_id: row.source_id,
      },
      {
        ts: ago(1),
        picked: 'iu-api',
        reason: 'drained-retry',
        machine: MACHINE,
        request_id: row.source_id,
      },
    ])
    const body = await get<Router>('/router?range=7d')
    expect(body.iu).toEqual([{ day: day(ago(1)), cause: 'credit-fallback', usd: 3, requests: 1 }])
  })

  it('keeps rows out of the window', async () => {
    await seed([
      gw({ cost_usd: 5, ts: ago(20), pick: 'forced' }),
      gw({ cost_usd: 1, pick: 'forced' }),
    ])
    expect((await get<Router>('/router?range=7d')).iu.map((r) => r.usd)).toEqual([1])
    expect((await get<Router>('/router?range=30d')).iu.reduce((a, r) => a + r.usd, 0)).toBe(6)
  })
})

describe('GET /usage/router picks', () => {
  it('counts picks per day, target and reason, refusals included', async () => {
    const ts = ago(1)
    await seedGatewayPicks(
      [
        ['iu', 'bound'],
        ['iu', 'bound'],
        ['iu', 'soonest-expiry'],
        ['me', 'bound'],
        ['iu-api', 'claude-code'],
        ['refused', 'no-pool'],
      ].map(([picked, reason], i) => ({
        ts,
        picked: picked!,
        reason: reason!,
        machine: MACHINE,
        request_id: `pk-${i}`,
      })),
    )
    await seedGatewayPicks([
      { ts: ago(3), picked: 'me', reason: 'bound', machine: MACHINE, request_id: 'pk-old' },
    ])
    const body = await get<Router>('/router?range=7d')
    const mine = body.picks.filter((p) => [day(ts), day(ago(3))].includes(p.day))
    expect(mine).toEqual([
      { day: day(ago(3)), target: 'me', reason: 'bound', n: 1 },
      { day: day(ts), target: 'iu', reason: 'bound', n: 2 },
      { day: day(ts), target: 'iu', reason: 'soonest-expiry', n: 1 },
      { day: day(ts), target: 'iu-api', reason: 'claude-code', n: 1 },
      { day: day(ts), target: 'me', reason: 'bound', n: 1 },
      { day: day(ts), target: 'refused', reason: 'no-pool', n: 1 },
    ])
  })
})

describe('GET /usage/router cache', () => {
  it('computes the hit rate per caller and target, null without input', async () => {
    await seed([
      gw({
        pool: 'iu',
        detail: { caller: 'agw-opencode' },
        input_tokens: 100,
        cache_read_tokens: 300,
        cache_write_tokens: 100,
      }),
      gw({
        pool: 'iu',
        detail: { caller: 'agw-opencode' },
        input_tokens: 0,
        cache_read_tokens: 100,
        cache_write_tokens: 0,
      }),
      gw({
        pool: 'me',
        detail: { caller: 'agw-opencode' },
        input_tokens: 90,
        cache_read_tokens: 10,
      }),
      gw({ detail: { caller: 'agw' }, input_tokens: 0, cache_read_tokens: 0 }),
      gw({ pool: 'iu', detail: { caller: '' }, input_tokens: 10 }),
      gw({ iu_key: 'athena-team', detail: { caller: 'athena' }, input_tokens: 10 }),
      gw({
        billing: 'openrouter',
        iu_key: null,
        detail: { caller: 'agw' },
        input_tokens: 10,
        cache_read_tokens: 10,
      }),
    ])
    const body = await get<Router>('/router?range=7d')
    expect(body.cache).toEqual([
      { caller: 'agw-opencode', target: 'iu', requests: 2, hitRate: 400 / 600 },
      { caller: '(unset)', target: 'iu', requests: 1, hitRate: 0 },
      { caller: 'agw', target: 'iu-api', requests: 1, hitRate: null },
      { caller: 'agw', target: 'unknown', requests: 1, hitRate: 0.5 },
      { caller: 'agw-opencode', target: 'me', requests: 1, hitRate: 0.1 },
    ])
  })
})

describe('GET /usage/router routeFallbackMeasured', () => {
  it('is false until a row carries the routeFallback key, then true', async () => {
    await seed([gw({ cost_usd: 1 })])
    expect((await get<Router>('/router?range=7d')).routeFallbackMeasured).toBe(false)
    await seed([gw({ cost_usd: 1, detail: { routeFallback: null } })])
    expect((await get<Router>('/router?range=7d')).routeFallbackMeasured).toBe(true)
  })

  it('looks at the whole store, not the range', async () => {
    await seed([gw({ ts: ago(60), detail: { routeFallback: 'req-1' } })])
    expect((await get<Router>('/router?range=7d')).routeFallbackMeasured).toBe(true)
  })
})

describe('GET /usage/router lastRequestAt', () => {
  it('is the newest gateway row as ISO, whatever the range', async () => {
    const newest = new Date(Date.now() - 45 * DAY)
    await seed([gw({ ts: ago(60) }), gw({ ts: newest.toISOString() })])
    for (const range of ['7d', '90d']) {
      expect((await get<Router>(`/router?range=${range}`)).lastRequestAt).toBe(newest.toISOString())
    }
  })

  it('ignores rows of other sources', async () => {
    await seedUsageRecords({ ...gw({ ts: ago(0.01) }), source: 'agent-workflows' })
    expect((await get<Router>('/router?range=7d')).lastRequestAt).toBeNull()
  })
})

describe('GET /usage/router empty and absent', () => {
  it('answers the empty shape with no gateway traffic', async () => {
    const body = await get<Router>('/router?range=7d')
    expect(body).toEqual({
      picks: [],
      iu: [],
      cache: [],
      picksAvailable: true,
      routeFallbackMeasured: false,
      lastRequestAt: null,
    })
  })

  it('degrades while usage.gateway_picks is missing', async () => {
    await seed([
      gw({ cost_usd: 2, pick: 'forced' }),
      gw({ cost_usd: 1, pool: 'iu', pick: 'bound' }),
    ])
    await db.execute(sql`ALTER TABLE usage.gateway_picks RENAME TO gateway_picks_away`)
    try {
      const body = await get<Router>('/router?range=7d')
      expect(body.picksAvailable).toBe(false)
      expect(body.picks).toEqual([])
      // Without picks a Claude row on IU is a credit fallback by elimination; the cache still reads.
      expect(body.iu).toEqual([{ day: day(ago(1)), cause: 'credit-fallback', usd: 2, requests: 1 }])
      expect(body.cache.reduce((a, c) => a + c.requests, 0)).toBe(2)
    } finally {
      await db.execute(sql`ALTER TABLE usage.gateway_picks_away RENAME TO gateway_picks`)
    }
  })
})
