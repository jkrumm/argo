import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { usageRoutes } from './usage.js'
import { quotaBucketMinutes } from './usage-quota.js'
import { runMigrations } from '../db/index.js'
import {
  deleteAccountPicksByLane,
  deleteQuotaSamples,
  seedAccountPicks,
  seedQuotaSamples,
} from '../test/usage-seed.js'

beforeAll(async () => {
  await runMigrations()
})

const app = new Elysia().use(usageRoutes)

// Everything here uses these accounts / this lane prefix, so cleanup and assertions stay scoped to them.
const A = 'zz-quota-a'
const B = 'zz-quota-b'
const LANE = 'zz-lane'
const MACHINE = 'm1'

const BUCKET_MS = 15 * 60_000
// A 15-min-aligned instant two hours back: the sample times below sit at known offsets inside it.
const T0 = Math.floor((Date.now() - 2 * 3_600_000) / BUCKET_MS) * BUCKET_MS
const at = (offsetMin: number) => new Date(T0 + offsetMin * 60_000).toISOString()

interface Sample {
  account: string
  sampledAt: string
  machine: string
  fiveHourPct: number | null
  sevenDayPct: number | null
  fiveHourResetsAt: string | null
  sevenDayResetsAt: string | null
  authOk: boolean
  exhaustedUntil: string | null
  source: string | null
}

function sample(over: Partial<Sample> = {}): Sample {
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

interface Pick {
  ts: string
  lane: string
  picked: string
  reason: string
  stale: boolean
  snapshot: unknown
  machine: string
}

function pick(over: Partial<Pick> = {}): Pick {
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

const seedSamples = (samples: Sample[]) =>
  seedQuotaSamples(
    samples.map((x) => ({
      account: x.account,
      sampled_at: x.sampledAt,
      machine: x.machine,
      five_hour_pct: x.fiveHourPct,
      seven_day_pct: x.sevenDayPct,
      five_hour_resets_at: x.fiveHourResetsAt,
      seven_day_resets_at: x.sevenDayResetsAt,
      auth_ok: x.authOk,
      exhausted_until: x.exhaustedUntil,
      source: x.source,
    })),
  )

const seedPicks = (picks: Pick[]) => seedAccountPicks(picks)

async function getJson<T>(path: string): Promise<T> {
  const res = await app.handle(new Request(`http://localhost${path}`))
  expect(res.status).toBe(200)
  return (await res.json()) as T
}

afterEach(async () => {
  await deleteQuotaSamples([A, B])
  await deleteAccountPicksByLane(LANE)
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
    await seedSamples([
      sample({ sampledAt: at(1), fiveHourPct: 10, sevenDayPct: 20 }),
      sample({ sampledAt: at(14), fiveHourPct: 12, sevenDayPct: 21 }),
      sample({ sampledAt: at(16), fiveHourPct: 30, sevenDayPct: 22 }),
      sample({ account: B, sampledAt: at(2), fiveHourPct: null, sevenDayPct: 5 }),
    ])
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
    await seedSamples([sample(), sample({ account: B }), sample({ sampledAt: at(-60 * 20) })])
    const onlyA = await getJson<QuotaResponse>(`/usage/quota?hours=6&account=${A}`)
    expect(onlyA.series.map((s) => s.account)).toEqual([A])
    expect(onlyA.series[0]?.points).toHaveLength(1)

    const wide = await getJson<QuotaResponse>(`/usage/quota?hours=48&account=${A}`)
    expect(wide.series[0]?.points).toHaveLength(2)
  })

  it('lists resets that already happened, once per window and instant', async () => {
    const past = at(-30)
    const future = new Date(Date.now() + 3_600_000).toISOString()
    await seedSamples([
      sample({ sampledAt: at(1), fiveHourResetsAt: past, sevenDayResetsAt: future }),
      sample({ sampledAt: at(2), fiveHourResetsAt: past, sevenDayResetsAt: future }),
    ])
    const res = await getJson<QuotaResponse>(`/usage/quota?hours=6&account=${A}`)
    expect(res.resets).toEqual([{ account: A, window: 'five_hour', at: at(-30) }])
  })

  it('ignores samples stamped in the future', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString()
    await seedSamples([sample(), sample({ sampledAt: future })])
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
    await seedSamples([
      sample({ sampledAt: inHour(1), fiveHourPct: 10 }),
      sample({ sampledAt: inHour(31), fiveHourPct: 50 }),
    ])
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
    await seedSamples([sample({ sampledAt: at(1), fiveHourResetsAt: reset })])
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
    await seedSamples([
      sample({ sampledAt: at(1), sevenDayPct: 20 }),
      sample({ sampledAt: at(30), sevenDayPct: 41, fiveHourPct: 7, sevenDayResetsAt: reset }),
      sample({ account: B, sampledAt: at(2), sevenDayPct: 5, authOk: false }),
    ])
    const res = await getJson<LatestResponse>(`/usage/quota-latest?account=${B}&account=${A}`)
    expect(res.accounts).toEqual([
      {
        account: A,
        sampledAt: at(30),
        fiveHourPct: 7,
        sevenDayPct: 41,
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
    await seedSamples([
      sample({ sampledAt: at(5), sevenDayPct: 10, machine: 'm1' }),
      sample({ sampledAt: at(9), sevenDayPct: 12, machine: 'm2' }),
    ])
    const res = await getJson<LatestResponse>(`/usage/quota-latest?account=${A}`)
    expect(res.accounts.map((a) => [a.sampledAt, a.sevenDayPct])).toEqual([[at(9), 12]])
  })

  it('keeps a null reading as null, never zero', async () => {
    await seedSamples([sample({ fiveHourPct: null, sevenDayPct: null, authOk: false })])
    const res = await getJson<LatestResponse>(`/usage/quota-latest?account=${A}`)
    expect(res.accounts[0]).toMatchObject({ fiveHourPct: null, sevenDayPct: null, authOk: false })
  })

  it('ignores samples stamped in the future', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString()
    await seedSamples([sample({ sevenDayPct: 20 }), sample({ sampledAt: future, sevenDayPct: 99 })])
    const res = await getJson<LatestResponse>(`/usage/quota-latest?account=${A}`)
    expect(res.accounts.map((a) => [a.sampledAt, a.sevenDayPct])).toEqual([[at(1), 20]])
  })

  it('filters by account and answers an unknown account with an empty list', async () => {
    await seedSamples([sample(), sample({ account: B })])
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
    await seedPicks([
      pick({ ts: at(1) }),
      pick({ ts: at(2), stale: true }),
      pick({ ts: at(3), picked: B, reason: 'expiring' }),
      pick({ ts: at(4), lane: `${LANE}-w`, picked: 'spill', reason: 'spill' }),
    ])
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
    await seedPicks([pick(), pick({ ts: future, picked: B })])
    const res = await getJson<SummaryResponse>('/usage/account-picks/summary?hours=6')
    expect(res.counts.filter((c) => c.lane === LANE).map((c) => c.picked)).toEqual([A])
  })

  it('buckets daily beyond 72 hours and respects the window', async () => {
    await seedPicks([pick({ ts: at(1) }), pick({ ts: at(-60 * 100), picked: B })])
    const day = await getJson<SummaryResponse>('/usage/account-picks/summary?hours=240')
    expect(day.bucketHours).toBe(24)
    expect(day.counts.filter((c) => c.lane === LANE).map((c) => c.picked)).toEqual([A, B])

    const short = await getJson<SummaryResponse>('/usage/account-picks/summary?hours=6')
    expect(short.counts.filter((c) => c.lane === LANE).map((c) => c.picked)).toEqual([A])
  })
})

describe('routing views', () => {
  it('lists picks with their snapshot and groups the summary by reason with spill rates', async () => {
    await seedPicks([
      pick({ ts: at(1), reason: 'home' }),
      pick({ ts: at(2), reason: 'spill', picked: B }),
      pick({ ts: at(3), lane: `${LANE}-2`, picked: 'spill', reason: 'no-eligible-account' }),
    ])
    const list = await getJson<{
      picks: Array<{
        lane: string
        reason: string
        snapshot: Record<string, { s: number | null; w: number | null }>
      }>
    }>('/usage/account-picks?hours=24')
    const mine = list.picks.filter((p) => p.lane.startsWith(LANE))
    expect(mine.map((p) => p.reason)).toEqual(['home', 'spill', 'no-eligible-account'])
    expect(mine[0]!.snapshot).toEqual({ a: { s: 10, w: 20 } })

    const summary = await getJson<{
      lanes: Array<{ lane: string; total: number; spills: number; spillRate: number }>
      pickedKeys: string[]
    }>('/usage/account-picks/summary?hours=24&groupBy=reason')
    expect(summary.pickedKeys).toEqual(
      expect.arrayContaining(['home', 'spill', 'no-eligible-account']),
    )
    expect(summary.lanes.find((l) => l.lane === LANE)).toEqual({
      lane: LANE,
      total: 2,
      spills: 1,
      spillRate: 0.5,
    })
    expect(summary.lanes.find((l) => l.lane === `${LANE}-2`)?.spillRate).toBe(1)
  })

  it('reports the capacity left at each reset and the wait until the account is picked again', async () => {
    const reset = at(60)
    await seedSamples([
      sample({ sampledAt: at(10), fiveHourPct: 40, fiveHourResetsAt: reset }),
      sample({ sampledAt: at(50), fiveHourPct: 70, fiveHourResetsAt: reset }),
      sample({ sampledAt: at(70), fiveHourPct: 5, fiveHourResetsAt: at(360) }),
    ])
    await seedPicks([pick({ ts: at(30) }), pick({ ts: at(75) })])
    const body = await getJson<{
      windows: Array<{
        account: string
        window: string
        pctAtReset: number | null
        unusedPct: number | null
        minutesToFirstPick: number | null
      }>
      summary: Array<{
        account: string
        window: string
        resets: number
        medianUnusedPct: number | null
      }>
    }>('/usage/routing/windows?hours=24')
    const mine = body.windows.filter((w) => w.account === A && w.window === 'five_hour')
    expect(mine).toEqual([
      expect.objectContaining({ pctAtReset: 70, unusedPct: 30, minutesToFirstPick: 15 }),
    ])
    expect(body.summary.find((s) => s.account === A)).toMatchObject({
      resets: 1,
      medianUnusedPct: 30,
    })
  })

  it('bounds the pick-back wait by the next 5 h reset of the account', async () => {
    await seedSamples([
      sample({ sampledAt: at(10), fiveHourPct: 50, fiveHourResetsAt: at(30) }),
      sample({ sampledAt: at(40), fiveHourPct: 20, fiveHourResetsAt: at(60) }),
      sample({ sampledAt: at(70), fiveHourPct: 0, fiveHourResetsAt: at(400) }),
    ])
    // The only pick after the first reset comes after the second one too: it belongs to the second.
    await seedPicks([pick({ ts: at(65) })])
    const body = await getJson<{
      windows: Array<{ account: string; window: string; minutesToFirstPick: number | null }>
    }>('/usage/routing/windows?hours=24')
    const mine = body.windows.filter((w) => w.account === A && w.window === 'five_hour')
    expect(mine.map((w) => w.minutesToFirstPick)).toEqual([null, 5])
  })
})
