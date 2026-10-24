import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { inArray, like } from 'drizzle-orm'
import { usageRoutes } from './usage.js'
import { db, runMigrations } from '../db/index.js'
import { accountPick, quotaSample } from '../db/schema.js'

beforeAll(async () => {
  await runMigrations()
})

const app = new Elysia().use(usageRoutes)

// Everything here uses these accounts / this lane prefix, so cleanup and assertions never touch
// whatever the dev DB already holds.
const A = 'zz-quota-a'
const B = 'zz-quota-b'
const LANE = 'zz-lane'
const MACHINE = 'm1'

const BUCKET_MS = 15 * 60_000
// A 15-min-aligned instant two hours back: the sample times below sit at known offsets inside it.
const T0 = Math.floor((Date.now() - 2 * 3_600_000) / BUCKET_MS) * BUCKET_MS
const at = (offsetMin: number) => new Date(T0 + offsetMin * 60_000).toISOString()

function sample(over: Record<string, unknown> = {}) {
  return {
    account: A,
    sampledAt: at(1),
    machine: MACHINE,
    fiveHourPct: 10,
    sevenDayPct: 20,
    fiveHourResetsAt: null,
    sevenDayResetsAt: null,
    authOk: true,
    exhaustedUntil: null,
    source: 'statusline',
    ...over,
  }
}

function pick(over: Record<string, unknown> = {}) {
  return {
    ts: at(1),
    lane: LANE,
    picked: A,
    reason: 'home',
    stale: false,
    snapshot: { a: { s: 10, w: 20 } },
    machine: MACHINE,
    ...over,
  }
}

function post(path: string, body: unknown) {
  return app.handle(
    new Request(`http://localhost/usage/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

async function getJson<T>(path: string): Promise<T> {
  const res = await app.handle(new Request(`http://localhost${path}`))
  expect(res.status).toBe(200)
  return (await res.json()) as T
}

afterEach(async () => {
  await db.delete(quotaSample).where(inArray(quotaSample.account, [A, B]))
  await db.delete(accountPick).where(like(accountPick.lane, `${LANE}%`))
})

describe('POST /usage/quota-samples', () => {
  it('inserts samples and is idempotent on (account, sampledAt, machine)', async () => {
    const batch = { samples: [sample(), sample({ sampledAt: at(2) })] }
    const first = await post('quota-samples', batch)
    expect(await first.json()).toEqual({ received: 2, inserted: 2, rejected: 0 })

    const again = await post('quota-samples', {
      samples: [...batch.samples, sample({ machine: 'm2' })],
    })
    expect(await again.json()).toEqual({ received: 3, inserted: 1, rejected: 0 })

    const rows = await db
      .select()
      .from(quotaSample)
      .where(inArray(quotaSample.account, [A]))
    expect(rows).toHaveLength(3)
  })

  it('a repeat never overwrites the stored row', async () => {
    await post('quota-samples', { samples: [sample({ fiveHourPct: 10 })] })
    await post('quota-samples', { samples: [sample({ fiveHourPct: 99 })] })
    const rows = await db
      .select()
      .from(quotaSample)
      .where(inArray(quotaSample.account, [A]))
    expect(rows.map((r) => r.five_hour_pct)).toEqual([10])
  })

  it('drops bad rows only, never the batch', async () => {
    const res = await post('quota-samples', {
      samples: [
        sample({ account: ` ${B} `, sampledAt: at(3) }),
        sample({ account: 'IU Max!' }),
        sample({ sampledAt: 'not a date' }),
        sample({ machine: '  ' }),
        sample({ fiveHourPct: 'high' }),
        'garbage',
        null,
        sample({ sampledAt: at(4), source: '  ' }),
      ],
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: 8, inserted: 2, rejected: 6 })
    const rows = await db
      .select()
      .from(quotaSample)
      .where(inArray(quotaSample.account, [A, B]))
    expect(rows.map((r) => r.account).toSorted()).toEqual([A, B])
    expect(rows.find((r) => r.account === A)?.source).toBeNull()
  })

  it('accepts null percentages and resets', async () => {
    const res = await post('quota-samples', {
      samples: [sample({ fiveHourPct: null, sevenDayPct: null, authOk: false })],
    })
    expect(await res.json()).toEqual({ received: 1, inserted: 1, rejected: 0 })
  })

  it('rejects an empty or oversized batch', async () => {
    expect((await post('quota-samples', { samples: [] })).status).toBe(422)
    const big = Array.from({ length: 1001 }, () => sample())
    expect((await post('quota-samples', { samples: big })).status).toBe(422)
  })
})

describe('POST /usage/account-picks', () => {
  it('inserts picks and is idempotent on (ts, lane, machine)', async () => {
    const batch = { picks: [pick(), pick({ lane: `${LANE}-2` })] }
    expect(await (await post('account-picks', batch)).json()).toEqual({
      received: 2,
      inserted: 2,
      rejected: 0,
    })
    const again = await post('account-picks', { picks: [...batch.picks, pick({ machine: 'm2' })] })
    expect(await again.json()).toEqual({ received: 3, inserted: 1, rejected: 0 })
  })

  it('drops bad rows only and stores an opaque picked value', async () => {
    const res = await post('account-picks', {
      picks: [
        pick({ picked: ' spill ', reason: 'spill', ts: at(2) }),
        pick({ ts: 'nope' }),
        pick({ picked: '' }),
        pick({ stale: 'yes' }),
        pick({ snapshot: 'x' }),
      ],
    })
    expect(await res.json()).toEqual({ received: 5, inserted: 1, rejected: 4 })
    const rows = await db
      .select()
      .from(accountPick)
      .where(like(accountPick.lane, `${LANE}%`))
    expect(rows.map((r) => r.picked)).toEqual(['spill'])
  })
})

type QuotaResponse = {
  bucketMinutes: number
  series: Array<{
    account: string
    points: Array<{ at: string; fiveHourPct: number | null; sevenDayPct: number | null }>
  }>
  resets: Array<{ account: string; window: string; at: string }>
}

describe('GET /usage/quota', () => {
  it('buckets to 15 minutes keeping the last sample, per account, ordered by time', async () => {
    await post('quota-samples', {
      samples: [
        sample({ sampledAt: at(1), fiveHourPct: 10, sevenDayPct: 20 }),
        sample({ sampledAt: at(14), fiveHourPct: 12, sevenDayPct: 21 }),
        sample({ sampledAt: at(16), fiveHourPct: 30, sevenDayPct: 22 }),
        sample({ account: B, sampledAt: at(2), fiveHourPct: null, sevenDayPct: 5 }),
      ],
    })
    const res = await getJson<QuotaResponse>(`/usage/quota?hours=6&account=${A}&account=${B}`)
    expect(res.bucketMinutes).toBe(15)
    const byAccount = Object.fromEntries(res.series.map((s) => [s.account, s.points]))
    expect(byAccount[A]).toEqual([
      { at: at(0), fiveHourPct: 12, sevenDayPct: 21 },
      { at: at(15), fiveHourPct: 30, sevenDayPct: 22 },
    ])
    expect(byAccount[B]).toEqual([{ at: at(0), fiveHourPct: null, sevenDayPct: 5 }])
  })

  it('filters by account and honours the window', async () => {
    await post('quota-samples', {
      samples: [sample(), sample({ account: B }), sample({ sampledAt: at(-60 * 20) })],
    })
    const onlyA = await getJson<QuotaResponse>(`/usage/quota?hours=6&account=${A}`)
    expect(onlyA.series.map((s) => s.account)).toEqual([A])
    expect(onlyA.series[0]?.points).toHaveLength(1)

    const wide = await getJson<QuotaResponse>(`/usage/quota?hours=48&account=${A}`)
    expect(wide.series[0]?.points).toHaveLength(2)
  })

  it('lists resets that already happened, once per window and instant', async () => {
    const past = at(-30)
    const future = new Date(Date.now() + 3_600_000).toISOString()
    await post('quota-samples', {
      samples: [
        sample({ sampledAt: at(1), fiveHourResetsAt: past, sevenDayResetsAt: future }),
        sample({ sampledAt: at(2), fiveHourResetsAt: past, sevenDayResetsAt: future }),
      ],
    })
    const res = await getJson<QuotaResponse>(`/usage/quota?hours=6&account=${A}`)
    expect(res.resets).toEqual([{ account: A, window: 'five_hour', at: at(-30) }])
  })

  it('rejects a malformed account or hours', async () => {
    expect((await app.handle(new Request('http://localhost/usage/quota?account=IU!'))).status).toBe(
      422,
    )
    expect((await app.handle(new Request('http://localhost/usage/quota?hours=0'))).status).toBe(422)
  })
})

type SummaryResponse = {
  total: number
  bucketHours: number
  counts: Array<{
    lane: string
    picked: string
    reason: string
    count: number
    staleCount: number
  }>
  pickedKeys: string[]
  series: Array<{ at: string; picks: Record<string, number> }>
}

describe('GET /usage/account-picks/summary', () => {
  it('counts lane × picked × reason and series per picked value', async () => {
    await post('account-picks', {
      picks: [
        pick({ ts: at(1) }),
        pick({ ts: at(2), stale: true }),
        pick({ ts: at(3), picked: B, reason: 'expiring' }),
        pick({ ts: at(4), lane: `${LANE}-w`, picked: 'spill', reason: 'spill' }),
      ],
    })
    const res = await getJson<SummaryResponse>('/usage/account-picks/summary?hours=6')
    const mine = res.counts.filter((c) => c.lane.startsWith(LANE))
    expect(mine).toEqual([
      { lane: LANE, picked: A, reason: 'home', count: 2, staleCount: 1 },
      { lane: LANE, picked: B, reason: 'expiring', count: 1, staleCount: 0 },
      { lane: `${LANE}-w`, picked: 'spill', reason: 'spill', count: 1, staleCount: 0 },
    ])
    expect(res.bucketHours).toBe(1)
    expect(res.pickedKeys).toEqual(expect.arrayContaining([A, B, 'spill']))

    const sum = (key: string) => res.series.reduce((acc, b) => acc + (b.picks[key] ?? 0), 0)
    expect(sum(A)).toBe(2)
    expect(sum(B)).toBe(1)
    expect(sum('spill')).toBe(1)
    expect(res.total).toBeGreaterThanOrEqual(4)
  })

  it('buckets daily beyond 72 hours and respects the window', async () => {
    await post('account-picks', {
      picks: [pick({ ts: at(1) }), pick({ ts: at(-60 * 100), picked: B })],
    })
    const day = await getJson<SummaryResponse>('/usage/account-picks/summary?hours=240')
    expect(day.bucketHours).toBe(24)
    expect(day.counts.filter((c) => c.lane === LANE).map((c) => c.picked)).toEqual([A, B])

    const short = await getJson<SummaryResponse>('/usage/account-picks/summary?hours=6')
    expect(short.counts.filter((c) => c.lane === LANE).map((c) => c.picked)).toEqual([A])
  })
})
