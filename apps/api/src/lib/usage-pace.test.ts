import { describe, it, expect } from 'bun:test'
import {
  buildPace,
  evalReserveUsd,
  poolAccounts,
  rateOf,
  selectCycles,
  spentOf,
  waterfall,
  type CycleInput,
  type PoolInput,
} from './usage-pace.js'

// Fixtures are the figures of the spec's §The headline: 2026-11-02 16:00 UTC, the gateway's first day.
const NOW = new Date('2026-11-02T16:00:00Z')
const CUTOVER = new Date('2026-11-02T00:26:44Z')
const near = (actual: number | null, expected: number, tolerance = 0.01) => {
  expect(actual).not.toBeNull()
  expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(tolerance)
}

const cycle = (over: Omit<Partial<CycleInput>, 'start'> & { start: string }): CycleInput => ({
  start: new Date(over.start),
  end: over.end === undefined ? null : over.end,
  grantUsd: over.grantUsd ?? 100,
  closedAt: over.closedAt ?? null,
  reconciledUsd: over.reconciledUsd ?? null,
  unspentUsd: over.unspentUsd ?? null,
})

const IU_CYCLE = cycle({
  start: '2026-10-21T00:00:00Z',
  end: new Date('2026-11-21T00:00:00Z'),
  grantUsd: 200,
})
const ME_CYCLE = cycle({
  start: '2026-10-27T00:00:00Z',
  end: new Date('2026-11-27T00:00:00Z'),
  grantUsd: 100,
})

/** iu: $56.11 outside the gateway on 31 Oct, $55.46 through it today while the report trails at $43.50. */
const iuPool = (over: Partial<PoolInput> = {}): PoolInput => ({
  account: 'iu',
  registryGrantUsd: 200,
  cyclesNewestFirst: [IU_CYCLE],
  metered: [{ day: '2026-11-02', usd: 55.46 }],
  reported: [
    { day: '2026-10-31', usd: 56.1054 },
    { day: '2026-11-01', usd: 0.0043 },
    { day: '2026-11-02', usd: 43.5 },
  ],
  reportedAt: new Date('2026-11-02T15:40:27Z'),
  ...over,
})
const mePool = (over: Partial<PoolInput> = {}): PoolInput => ({
  account: 'me',
  registryGrantUsd: 100,
  cyclesNewestFirst: [ME_CYCLE],
  metered: [{ day: '2026-11-02', usd: 6.91 }],
  reported: null,
  reportedAt: null,
  ...over,
})
const me2Pool = (): PoolInput => ({
  account: 'me2',
  registryGrantUsd: 100,
  cyclesNewestFirst: [],
  metered: [],
  reported: null,
  reportedAt: null,
})

const todayRate = () => rateOf({ now: NOW, cutover: CUTOVER, productionUsd: 55.45, evalUsd: 6.91 })

describe('spentOf', () => {
  it('takes the larger of meter and report per day, not over the whole cycle', () => {
    const spent = spentOf({
      days: ['2026-10-31', '2026-11-01', '2026-11-02'],
      grantUsd: 200,
      metered: [
        { day: '2026-11-01', usd: 10 },
        { day: '2026-11-02', usd: 55.46 },
      ],
      reported: [
        { day: '2026-10-31', usd: 56.11 },
        { day: '2026-11-01', usd: 12 },
        { day: '2026-11-02', usd: 43.5 },
      ],
    })
    // 56.11 (report only) + 12 (report ahead of the meter) + 55.46 (meter ahead of the lagging report)
    expect(spent.spentUsd).toBeCloseTo(123.57, 4)
    expect(spent.meteredUsd).toBeCloseTo(65.46, 4)
    expect(spent.reportedUsd).toBeCloseTo(111.61, 4)
    // The cycle-wide max would have said max(65.46, 111.61) = 111.61: $12 short.
    expect(spent.days.map((d) => d.leftUsd)).toEqual([143.89, 131.89, 76.43])
  })

  it('counts as outside only what the report holds on days the gateway carried nothing', () => {
    const spent = spentOf({
      days: ['2026-10-31', '2026-11-02'],
      grantUsd: 200,
      metered: [{ day: '2026-11-02', usd: 55.46 }],
      reported: [
        { day: '2026-10-31', usd: 56.11 },
        { day: '2026-11-02', usd: 43.5 },
      ],
    })
    expect(spent.outsideUsd).toBe(56.11)
  })

  it('has no reported figure for a pool without a report', () => {
    const spent = spentOf({
      days: ['2026-11-02'],
      grantUsd: 100,
      metered: [{ day: '2026-11-02', usd: 6.91 }],
      reported: null,
    })
    expect(spent.reportedUsd).toBeNull()
    expect(spent.outsideUsd).toBe(0)
    expect(spent.days[0]).toEqual({
      day: '2026-11-02',
      meteredUsd: 6.91,
      reportedUsd: null,
      leftUsd: 93.09,
    })
  })
})

describe('rateOf', () => {
  it("is today's $85/d over the 15.6 h since the cutover, and thin", () => {
    const rate = todayRate()
    near(rate.windowHours, 15.55, 0.01)
    near(rate.productionUsdPerDay, 85.58, 0.05)
    near(rate.evalUsdPerDay, 10.66, 0.05)
    expect(rate.thin).toBe(true)
  })

  it('clips a long history to the last 7 days and is not thin', () => {
    const rate = rateOf({
      now: NOW,
      cutover: new Date('2026-09-01T00:00:00Z'),
      productionUsd: 70,
      evalUsd: 0,
    })
    expect(rate.windowHours).toBe(168)
    expect(rate.productionUsdPerDay).toBe(10)
    expect(rate.thin).toBe(false)
  })

  it('reads zero, thin, before the gateway wrote a row', () => {
    const rate = rateOf({ now: NOW, cutover: null, productionUsd: 0, evalUsd: 0 })
    expect(rate).toEqual({ productionUsdPerDay: 0, evalUsdPerDay: 0, windowHours: 0, thin: true })
  })
})

describe('selectCycles', () => {
  it('takes the running cycle and the newest closed one as previous', () => {
    const closed = cycle({
      start: '2026-09-21T00:00:00Z',
      end: new Date('2026-10-21T00:00:00Z'),
      grantUsd: 200,
      closedAt: new Date('2026-11-02T09:15:33Z'),
      reconciledUsd: 180,
      unspentUsd: 20,
    })
    const sel = selectCycles([IU_CYCLE, closed], NOW)
    expect(sel.status).toBe('open')
    expect(sel.current).toBe(IU_CYCLE)
    expect(sel.previous).toBe(closed)
  })

  it('reads an unclosed cycle that already ended as awaiting-reconcile, no cycle row as none', () => {
    const ended = cycle({ start: '2026-09-21T00:00:00Z', end: new Date('2026-10-21T00:00:00Z') })
    expect(selectCycles([ended], NOW).status).toBe('awaiting-reconcile')
    expect(selectCycles([], NOW).status).toBe('none')
  })

  it('reads a cycle without an end as unknown-end', () => {
    expect(selectCycles([cycle({ start: '2026-10-01T00:00:00Z' })], NOW).status).toBe('unknown-end')
  })
})

const end = (iso: string) => new Date(iso)

describe('waterfall', () => {
  it('drains the soonest-ending pool first and starts the next when it dries', () => {
    const out = waterfall(
      [
        { account: 'me', leftUsd: 93.09, end: end('2026-11-27T00:00:00Z') },
        { account: 'iu', leftUsd: 88.43, end: end('2026-11-21T00:00:00Z') },
      ],
      85,
      NOW,
    )
    expect(out.map((p) => p.account)).toEqual(['iu', 'me'])
    // 88.43 / 85 = 1.0404 d after 16:00 on 2 Nov
    expect(out[0]?.dryAt?.toISOString().slice(0, 13)).toBe('2026-11-03T16')
    expect(out[1]?.drawsFrom).toEqual(out[0]?.dryAt as Date)
    expect(out[1]?.dryAt?.toISOString().slice(0, 13)).toBe('2026-11-04T19')
    expect(out.map((p) => p.unspentAtEndUsd)).toEqual([0, 0])
  })

  it('moves the demand to the next pool when one expires with credit left', () => {
    const [first, second] = waterfall(
      [
        { account: 'iu', leftUsd: 100, end: end('2026-11-12T16:00:00Z') },
        { account: 'me', leftUsd: 20, end: end('2026-11-27T00:00:00Z') },
      ],
      2,
      NOW,
    )
    // 10 days × $2 drawn, $80 expire; me draws from iu's end
    expect(first?.dryAt).toBeNull()
    expect(first?.unspentAtEndUsd).toBe(80)
    expect(second?.drawsFrom?.toISOString()).toBe('2026-11-12T16:00:00.000Z')
    expect(second?.dryAt?.toISOString().slice(0, 10)).toBe('2026-11-22')
  })

  it('never draws a pool that expires before the demand reaches it', () => {
    const out = waterfall(
      [
        { account: 'iu', leftUsd: 1000, end: end('2026-11-21T00:00:00Z') },
        { account: 'me', leftUsd: 40, end: end('2026-11-10T00:00:00Z') },
      ],
      1,
      NOW,
    )
    // me ends first, so it is first in line; it dries at day 40 > its end: expires with credit
    expect(out[0]?.account).toBe('me')
    expect(out[0]?.unspentAtEndUsd).toBeGreaterThan(30)
    expect(out[1]?.account).toBe('iu')
  })

  it('draws nothing at a zero rate', () => {
    const [only] = waterfall(
      [{ account: 'iu', leftUsd: 10, end: end('2026-11-21T00:00:00Z') }],
      0,
      NOW,
    )
    expect(only).toEqual({ account: 'iu', drawsFrom: null, dryAt: null, unspentAtEndUsd: 10 })
  })
})

describe('eval reserve', () => {
  it('is the grant pro rata to the days left', () => {
    expect(evalReserveUsd({ grantUsd: 200, daysLeft: 15.5, cycleDays: 31 })).toBe(100)
    expect(evalReserveUsd({ grantUsd: 200, daysLeft: 0, cycleDays: 31 })).toBe(0)
  })
})

describe('buildPace on the headline figures', () => {
  const pace = buildPace({
    now: NOW,
    pools: [iuPool(), mePool(), me2Pool()],
    rate: todayRate(),
  })
  const pool = (account: string) => pace.pools.find((p) => p.account === account)!

  it('is over, thin, and spills until iu renews on 21 Nov', () => {
    expect(pace.verdict).toBe('over')
    expect(pace.thin).toBe(true)
    expect(pace.spill?.until).toBe('2026-11-21T00:00:00.000Z')
    expect(pace.spill?.from.slice(0, 10)).toBe('2026-11-04')
    near(pace.spill?.days ?? 0, 16.2, 0.2)
    near(pace.spill?.claudeListUsd ?? 0, 1385, 25)
  })

  it('reproduces the spent, left and outside figures', () => {
    near(pool('iu').leftUsd, 88.43, 0.01)
    near(pool('iu').spentUsd, 111.57, 0.01)
    near(pool('iu').outsideUsd, 56.11, 0.01)
    expect(pool('iu').meteredUsd).toBe(55.46)
    near(pool('iu').reportedUsd, 99.6097, 0.001)
    expect(pool('iu').reportedAt).toBe('2026-11-02T15:40:27.000Z')
    near(pool('me').leftUsd, 93.09, 0.001)
    expect(pool('me').reportedUsd).toBeNull()
    expect(pool('me').outsideUsd).toBe(0)
  })

  it('reproduces days left and the required pace', () => {
    near(pool('iu').daysLeft, 18.333, 0.001)
    near(pool('iu').requiredUsdPerDay, 4.82, 0.01)
    near(pool('me').daysLeft, 24.333, 0.001)
    near(pool('me').requiredUsdPerDay, 3.83, 0.01)
  })

  it('has iu dry on 3 Nov and me on 4 Nov', () => {
    expect(pool('iu').projection.drawsFrom).toBe(NOW.toISOString())
    expect(pool('iu').projection.dryAt?.slice(0, 10)).toBe('2026-11-03')
    expect(pool('me').projection.dryAt?.slice(0, 10)).toBe('2026-11-04')
    expect(pool('iu').projection.unspentAtEndUsd).toBe(0)
  })

  it('lists me2 as not enabled with its grant, drawing nothing', () => {
    expect(pool('me2')).toMatchObject({
      enabled: false,
      note: 'not enabled',
      grantUsd: 100,
      cycle: { status: 'none', end: null },
      spentUsd: 0,
      leftUsd: null,
      daysLeft: null,
      requiredUsdPerDay: null,
      projection: { drawsFrom: null, dryAt: null, unspentAtEndUsd: null },
      days: [],
    })
    expect(pace.pools.map((p) => p.account)).toEqual(['iu', 'me', 'me2'])
  })

  it('has the burn-down and the eval reserve of iu', () => {
    const days = pool('iu').days
    expect(days[0]?.day).toBe('2026-10-21')
    expect(days.at(-1)).toEqual({
      day: '2026-11-02',
      meteredUsd: 55.46,
      reportedUsd: 43.5,
      leftUsd: pool('iu').leftUsd as number,
    })
    // 200 × 18.333 / 31
    near(pool('iu').evalReserveUsd, 118.28, 0.01)
    // left 88.43 − $2 headroom − 118.28 reserve: nothing for evals
    expect(pool('iu').evalAvailableUsd).toBe(0)
  })

  it('gives evals the surplus of a pool below its straight line', () => {
    const p = buildPace({
      now: NOW,
      pools: [mePool({ cyclesNewestFirst: [ME_CYCLE], metered: [{ day: '2026-10-30', usd: 70 }] })],
      rate: todayRate(),
    }).pools[0]!
    // left 30, reserve 100 × 24.333 / 31 = 78.49: still none; a young pool has surplus
    expect(p.evalAvailableUsd).toBe(0)
    const young = buildPace({
      now: new Date('2026-10-28T00:00:00Z'),
      pools: [mePool({ metered: [] })],
      rate: rateOf({ now: NOW, cutover: null, productionUsd: 0, evalUsd: 0 }),
    }).pools[0]!
    // left 100 − 2 − (100 × 30 / 31 = 96.77)
    near(young.evalAvailableUsd, 1.23, 0.01)
  })

  it('carries the previous cycle with its reconcile', () => {
    const closed = cycle({
      start: '2026-09-21T00:00:00Z',
      end: new Date('2026-10-21T00:00:00Z'),
      grantUsd: 200,
      closedAt: new Date('2026-11-02T09:15:33Z'),
      reconciledUsd: 178.5,
      unspentUsd: 21.5,
    })
    const p = buildPace({
      now: NOW,
      pools: [iuPool({ cyclesNewestFirst: [IU_CYCLE, closed] })],
      rate: todayRate(),
    }).pools[0]!
    expect(p.previous).toEqual({
      start: '2026-09-21T00:00:00.000Z',
      end: '2026-10-21T00:00:00.000Z',
      grantUsd: 200,
      reconciledUsd: 178.5,
      unspentUsd: 21.5,
    })
    expect(pool('iu').previous).toBeNull()
  })
})

const ratePerDay = (usd: number) =>
  rateOf({
    now: NOW,
    cutover: new Date('2026-10-01T00:00:00Z'),
    productionUsd: usd * 7,
    evalUsd: 0,
  })

describe('buildPace verdicts', () => {
  it('is under when a pool expires with more than max($5, 5 % of grant) unspent', () => {
    const pace = buildPace({
      now: NOW,
      pools: [iuPool(), mePool()],
      rate: ratePerDay(1),
    })
    expect(pace.verdict).toBe('under')
    expect(pace.thin).toBe(false)
    expect(pace.spill).toBeNull()
    expect(pace.pools[0]?.projection.dryAt).toBeNull()
    // 88.43 − 18.333 d × $1
    near(pace.pools[0]?.projection.unspentAtEndUsd ?? 0, 70.1, 0.05)
  })

  it('is on-pace when the pools run to expiry with only change left', () => {
    // total left 181.52 over iu's 18.33 d then me until 27 Nov (24.33 d): $7.4/d leaves ≈ $1.5
    const pace = buildPace({ now: NOW, pools: [iuPool(), mePool()], rate: ratePerDay(7.4) })
    expect(pace.verdict).toBe('on-pace')
    expect(pace.spill).toBeNull()
    expect(pace.pools[0]?.projection.dryAt).not.toBeNull()
    expect(pace.pools[1]?.projection.unspentAtEndUsd).toBeLessThan(5)
  })

  it('treats unspent under the 5 %-of-grant floor as on-pace', () => {
    // $7.2/d leaves ≈ 181.52 − 175.2 = 6.3 on me: 5 % of $100 = $5 → under; $7.3/d leaves ≈ 3.9
    expect(
      buildPace({ now: NOW, pools: [iuPool(), mePool()], rate: ratePerDay(7.2) }).verdict,
    ).toBe('under')
    expect(
      buildPace({ now: NOW, pools: [iuPool(), mePool()], rate: ratePerDay(7.3) }).verdict,
    ).toBe('on-pace')
  })

  it('is no-pool when no pool has a running cycle', () => {
    const pace = buildPace({
      now: NOW,
      pools: [
        { ...iuPool(), cyclesNewestFirst: [], metered: [], reported: null },
        { ...mePool(), cyclesNewestFirst: [], metered: [] },
        me2Pool(),
      ],
      rate: todayRate(),
    })
    expect(pace.verdict).toBe('no-pool')
    expect(pace.spill).toBeNull()
    expect(pace.pools.every((p) => !p.enabled && p.note === 'not enabled')).toBe(true)
  })

  it('is thin on a short window whatever the verdict', () => {
    const pace = buildPace({
      now: NOW,
      pools: [iuPool()],
      rate: rateOf({
        now: NOW,
        cutover: new Date('2026-11-02T14:00:00Z'),
        productionUsd: 1,
        evalUsd: 0,
      }),
    })
    expect(pace.thin).toBe(true)
    expect(pace.rate.windowHours).toBe(2)
  })

  it('judges one enabled pool against its own renewal', () => {
    const pace = buildPace({ now: NOW, pools: [iuPool(), me2Pool()], rate: todayRate() })
    expect(pace.verdict).toBe('over')
    expect(pace.spill?.from.slice(0, 10)).toBe('2026-11-03')
    expect(pace.spill?.until).toBe('2026-11-21T00:00:00.000Z')
  })
})

describe('buildPace with an unknown or stale cycle', () => {
  it('keeps a balance for an unknown cycle end but projects nothing', () => {
    const unknown = cycle({ start: '2026-10-01T00:00:00Z', grantUsd: 100 })
    const pace = buildPace({
      now: NOW,
      pools: [mePool({ cyclesNewestFirst: [unknown], metered: [{ day: '2026-10-05', usd: 20 }] })],
      rate: todayRate(),
    })
    const p = pace.pools[0]!
    expect(p).toMatchObject({
      enabled: true,
      note: 'cycle unknown',
      cycle: { status: 'unknown-end', end: null },
      leftUsd: 80,
      daysLeft: null,
      requiredUsdPerDay: null,
      evalReserveUsd: 100,
      evalAvailableUsd: 0,
      projection: { drawsFrom: null, dryAt: null, unspentAtEndUsd: null },
    })
    expect(pace.spill).toBeNull()
    expect(pace.verdict).toBe('on-pace')
  })

  it('has no balance while a cycle awaits its reconcile', () => {
    const ended = cycle({
      start: '2026-09-21T00:00:00Z',
      end: new Date('2026-10-21T00:00:00Z'),
      grantUsd: 200,
    })
    const p = buildPace({
      now: NOW,
      pools: [iuPool({ cyclesNewestFirst: [ended] })],
      rate: todayRate(),
    }).pools[0]!
    expect(p).toMatchObject({
      enabled: false,
      note: 'awaiting reconcile',
      grantUsd: 200,
      leftUsd: null,
      cycle: { status: 'awaiting-reconcile', end: '2026-10-21T00:00:00.000Z' },
    })
  })
})

describe('poolAccounts', () => {
  it('lists the registry first, then other cycle accounts alphabetically', () => {
    expect(poolAccounts(['zeta', 'me', 'alpha'])).toEqual(['iu', 'me', 'me2', 'alpha', 'zeta'])
  })
})
