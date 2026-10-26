import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { inArray, like } from 'drizzle-orm'
import { usageRoutes } from './usage.js'
import { quotaBucketMinutes } from './usage-quota.js'
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

  it('stores fractional percentages exactly', async () => {
    await post('quota-samples', { samples: [sample({ fiveHourPct: 12.3, sevenDayPct: 45.67 })] })
    const rows = await db
      .select()
      .from(quotaSample)
      .where(inArray(quotaSample.account, [A]))
    expect(rows[0]?.five_hour_pct).toBe(12.3)
    expect(rows[0]?.seven_day_pct).toBe(45.67)
    const res = await getJson<QuotaResponse>(`/usage/quota?hours=6&account=${A}`)
    expect(res.series[0]?.points[0]).toMatchObject({ fiveHourPct: 12.3, sevenDayPct: 45.67 })
  })

  it('normalises timestamps so spellings of one instant dedupe', async () => {
    const utc = at(1)
    const offset = new Date(Date.parse(utc) + 2 * 3_600_000)
      .toISOString()
      .replace(/\.\d{3}Z$/, '+02:00')
    const noMs = utc.replace('.000Z', 'Z')
    const res = await post('quota-samples', {
      samples: [
        sample({ sampledAt: utc, fiveHourResetsAt: offset }),
        sample({ sampledAt: offset }),
        sample({ sampledAt: noMs }),
      ],
    })
    expect(await res.json()).toEqual({ received: 3, inserted: 1, rejected: 0 })
    const rows = await db
      .select()
      .from(quotaSample)
      .where(inArray(quotaSample.account, [A]))
    expect(rows).toHaveLength(1)
    expect(new Date(rows[0]?.sampled_at ?? '').toISOString()).toBe(utc)
    expect(new Date(rows[0]?.five_hour_resets_at ?? '').toISOString()).toBe(
      utc.replace(/:\d{2}\.\d{3}Z$/, ':00.000Z'),
    )
  })

  it('rejects timestamps without a zone or that do not round-trip', async () => {
    const res = await post('quota-samples', {
      samples: [
        sample({ sampledAt: '2026-10-01T10:00:00' }),
        sample({ sampledAt: '2026-10-01' }),
        sample({ sampledAt: '2026-13-45T10:00:00Z' }),
        sample({ sampledAt: at(5), sevenDayResetsAt: 'tomorrow' }),
      ],
    })
    expect(await res.json()).toEqual({ received: 4, inserted: 0, rejected: 4 })
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

  it('dedupes a pick re-sent in another timestamp spelling', async () => {
    const offset = new Date(Date.parse(at(1)) + 3_600_000).toISOString().replace(/Z$/, '+01:00')
    const res = await post('account-picks', { picks: [pick(), pick({ ts: offset })] })
    expect(await res.json()).toEqual({ received: 2, inserted: 1, rejected: 0 })
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

  it('ignores samples stamped in the future', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString()
    await post('quota-samples', { samples: [sample(), sample({ sampledAt: future })] })
    const res = await getJson<QuotaResponse>(`/usage/quota?hours=6&account=${A}`)
    expect(res.series[0]?.points.map((p) => p.at)).toEqual([at(0)])
  })

  it('widens buckets with the window and reports the width', async () => {
    expect([1, 72, 73, 720, 721, 8760].map(quotaBucketMinutes)).toEqual([
      15, 15, 60, 60, 1440, 1440,
    ])
    // Two samples 30 min apart: separate 15-min buckets, one hourly bucket.
    const hourStart = Math.floor(T0 / 3_600_000) * 3_600_000
    const inHour = (min: number) => new Date(hourStart + min * 60_000).toISOString()
    await post('quota-samples', {
      samples: [
        sample({ sampledAt: inHour(1), fiveHourPct: 10 }),
        sample({ sampledAt: inHour(31), fiveHourPct: 50 }),
      ],
    })
    const fine = await getJson<QuotaResponse>(`/usage/quota?hours=72&account=${A}`)
    expect(fine.bucketMinutes).toBe(15)
    expect(fine.series[0]?.points).toHaveLength(2)

    const coarse = await getJson<QuotaResponse>(`/usage/quota?hours=200&account=${A}`)
    expect(coarse.bucketMinutes).toBe(60)
    expect(coarse.series[0]?.points).toEqual([{ at: inHour(0), fiveHourPct: 50, sevenDayPct: 20 }])

    const daily = await getJson<QuotaResponse>(`/usage/quota?hours=2000&account=${A}`)
    expect(daily.bucketMinutes).toBe(1440)
    expect(daily.series[0]?.points).toHaveLength(1)
  })

  it('bins resets with the same width as the points', async () => {
    const hourStart = Math.floor(T0 / 3_600_000) * 3_600_000
    const reset = new Date(hourStart + 20 * 60_000).toISOString()
    await post('quota-samples', {
      samples: [sample({ sampledAt: at(1), fiveHourResetsAt: reset })],
    })
    const res = await getJson<QuotaResponse>(`/usage/quota?hours=200&account=${A}`)
    expect(res.resets).toEqual([
      { account: A, window: 'five_hour', at: new Date(hourStart).toISOString() },
    ])
  })

  it('rejects a malformed account or hours', async () => {
    expect((await app.handle(new Request('http://localhost/usage/quota?account=IU!'))).status).toBe(
      422,
    )
    expect((await app.handle(new Request('http://localhost/usage/quota?hours=0'))).status).toBe(422)
  })
})

type LatestResponse = {
  accounts: Array<{
    account: string
    sampledAt: string
    fiveHourPct: number | null
    sevenDayPct: number | null
    sevenDayResetsAt: string | null
    authOk: boolean
  }>
}

describe('GET /usage/quota-latest', () => {
  it('returns the newest sample per account, ordered by account', async () => {
    const reset = new Date(Date.now() + 3 * 86_400_000).toISOString()
    await post('quota-samples', {
      samples: [
        sample({ sampledAt: at(1), sevenDayPct: 20 }),
        sample({ sampledAt: at(30), sevenDayPct: 41.5, fiveHourPct: 7, sevenDayResetsAt: reset }),
        sample({ account: B, sampledAt: at(2), sevenDayPct: 5, authOk: false }),
      ],
    })
    const res = await getJson<LatestResponse>(`/usage/quota-latest?account=${B}&account=${A}`)
    expect(res.accounts).toEqual([
      {
        account: A,
        sampledAt: at(30),
        fiveHourPct: 7,
        sevenDayPct: 41.5,
        sevenDayResetsAt: reset,
        authOk: true,
      },
      {
        account: B,
        sampledAt: at(2),
        fiveHourPct: 10,
        sevenDayPct: 5,
        sevenDayResetsAt: null,
        authOk: false,
      },
    ])
  })

  it('collapses several machines sampling one account to the latest', async () => {
    await post('quota-samples', {
      samples: [
        sample({ sampledAt: at(5), sevenDayPct: 10, machine: 'm1' }),
        sample({ sampledAt: at(9), sevenDayPct: 12, machine: 'm2' }),
      ],
    })
    const res = await getJson<LatestResponse>(`/usage/quota-latest?account=${A}`)
    expect(res.accounts.map((a) => [a.sampledAt, a.sevenDayPct])).toEqual([[at(9), 12]])
  })

  it('keeps a null reading as null, never zero', async () => {
    await post('quota-samples', {
      samples: [sample({ fiveHourPct: null, sevenDayPct: null, authOk: false })],
    })
    const res = await getJson<LatestResponse>(`/usage/quota-latest?account=${A}`)
    expect(res.accounts[0]).toMatchObject({ fiveHourPct: null, sevenDayPct: null, authOk: false })
  })

  it('ignores samples stamped in the future', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString()
    await post('quota-samples', {
      samples: [sample({ sevenDayPct: 20 }), sample({ sampledAt: future, sevenDayPct: 99 })],
    })
    const res = await getJson<LatestResponse>(`/usage/quota-latest?account=${A}`)
    expect(res.accounts.map((a) => [a.sampledAt, a.sevenDayPct])).toEqual([[at(1), 20]])
  })

  it('filters by account and answers an unknown account with an empty list', async () => {
    await post('quota-samples', { samples: [sample(), sample({ account: B })] })
    const onlyB = await getJson<LatestResponse>(`/usage/quota-latest?account=${B}`)
    expect(onlyB.accounts.map((a) => a.account)).toEqual([B])

    const none = await getJson<LatestResponse>('/usage/quota-latest?account=zz-quota-none')
    expect(none).toEqual({ accounts: [] })
  })

  it('rejects a malformed account', async () => {
    const res = await app.handle(new Request('http://localhost/usage/quota-latest?account=IU!'))
    expect(res.status).toBe(422)
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

  it('ignores picks stamped in the future', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString()
    await post('account-picks', { picks: [pick(), pick({ ts: future, picked: B })] })
    const res = await getJson<SummaryResponse>('/usage/account-picks/summary?hours=6')
    expect(res.counts.filter((c) => c.lane === LANE).map((c) => c.picked)).toEqual([A])
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
