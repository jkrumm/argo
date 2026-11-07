import { describe, expect, it } from 'bun:test'
import { formatDuration } from '../../lib/format'
import { USAGE_ACCOUNTS } from './accounts'
import { PACE } from './flow-fixtures'
import { combinedLeft, creditDrain, quotaDrain, type QuotaAccountInput } from './quotas-model'
import type { PacePool, PaceResponse } from '../../lib/queries/usage'

const DAY = 86_400_000
const HOUR = 3_600_000
const iso = (ms: number) => new Date(ms).toISOString()
const at = (ms: number, left: number) => ({ at: ms, left })

describe('combinedLeft', () => {
  it('weights the accounts by capacity units and carries each last reading forward', () => {
    const lines = [
      { units: 2, points: [at(0, 100), at(20, 50)] },
      { units: 1, points: [at(0, 60), at(10, 40)] },
      { units: 1, points: [at(5, 20)] },
    ]
    // t=5: (2*100 + 60 + 20) / 4; t=10: (200 + 40 + 20) / 4; t=20: (100 + 40 + 20) / 4
    expect(combinedLeft(lines, [5, 10, 20])).toEqual([at(5, 70), at(10, 65), at(20, 40)])
  })

  it('has no value where an account has no reading yet', () => {
    const lines = [
      { units: 1, points: [at(10, 80)] },
      { units: 1, points: [at(0, 40)] },
    ]
    expect(combinedLeft(lines, [0, 5, 10])).toEqual([at(10, 60)])
  })

  it('leaves out an account with no points at all instead of blanking the line', () => {
    const lines = [
      { units: 2, points: [at(0, 90)] },
      { units: 1, points: [] },
    ]
    expect(combinedLeft(lines, [0, 1])).toEqual([at(0, 90), at(1, 90)])
    expect(combinedLeft([{ units: 1, points: [] }], [0])).toEqual([])
  })
})

describe('quotaDrain', () => {
  const NOW = Date.parse('2026-11-07T12:00:00Z')
  const account = (over: Partial<QuotaAccountInput> & { id: string }): QuotaAccountInput => ({
    label: over.id,
    plan: 'Max 5x',
    payer: `${over.id}-sub`,
    units: 1,
    points: [],
    resets: [],
    nextResetAt: iso(NOW + 3 * DAY),
    sevenDayPct: 20,
    ...over,
  })
  const samples = (...pcts: number[]) =>
    pcts.map((sevenDayPct, i) => ({ at: iso(NOW - (pcts.length - i) * HOUR), sevenDayPct }))

  it('registers the capacity units iu 2, me 1, me2 1', () => {
    expect(USAGE_ACCOUNTS.map((a) => [a.id, a.weeklyUnits])).toEqual([
      ['iu', 2],
      ['me', 1],
      ['me2', 1],
    ])
  })

  it('combines the share left over a common grid, ending at the latest readings', () => {
    const m = quotaDrain(
      [
        account({ id: 'iu', units: 2, points: samples(10, 10), sevenDayPct: 10 }),
        account({ id: 'me', points: samples(50, 50), sevenDayPct: 50 }),
        account({ id: 'me2', points: samples(90, 90), sevenDayPct: 90 }),
      ],
      NOW,
    )
    // (2*90 + 50 + 10) / 4
    expect(m.combined.at(-1)).toEqual(at(NOW, 60))
    expect(m.headline).toBe('60 % left combined')
    expect(m.accounts.map((a) => a.leftPct)).toEqual([90, 50, 10])
  })

  it('covers the accounts that have data when one has none', () => {
    const m = quotaDrain(
      [
        account({ id: 'iu', units: 2, points: samples(10), sevenDayPct: 10 }),
        account({ id: 'me', sevenDayPct: null }),
      ],
      NOW,
    )
    expect(m.combined.at(-1)?.left).toBe(90)
    expect(m.subtitle).toContain('1 of 2 accounts')
    expect(m.accounts[1]?.status).toBe('none')
  })

  it('is empty without any sample', () => {
    const m = quotaDrain([account({ id: 'me', sevenDayPct: null })], NOW)
    expect(m.empty).toBe('No quota samples yet')
    expect(m.combined).toEqual([])
  })

  it('warns when an account runs out before its reset, not when it will last', () => {
    const fast = account({
      id: 'me2',
      nextResetAt: iso(NOW + 2 * DAY),
      sevenDayPct: 90,
      points: samples(88, 90),
    })
    const slow = account({
      id: 'me',
      nextResetAt: iso(NOW + 2 * DAY),
      sevenDayPct: 10,
      points: samples(9, 10),
    })
    const m = quotaDrain([slow, fast], NOW)
    expect(m.accounts.map((a) => a.status)).toEqual(['ok', 'runs-out'])
    expect(m.accounts[1]?.note).toContain('runs out')
    expect(m.verdict).toContain('me2 runs out')
    // The gap is reset minus run-out (10 % left at 18 %/d is 0.56 d from now, 2 d to the reset), not now to reset.
    const emptyFor = 2 * DAY - (10 / 90) * 5 * DAY
    expect(m.accounts[1]?.emptyForMs).toBeCloseTo(emptyFor, -2)
    expect(m.verdict).toContain(`${formatDuration(emptyFor)} before its reset`)
    expect(m.verdict).not.toContain(formatDuration(2 * DAY))
  })

  it('ticks each account’s resets in its payer colour: deduped, in the window, plus the next', () => {
    const next = NOW + 3 * DAY
    const m = quotaDrain(
      [
        account({
          id: 'me',
          points: samples(5),
          nextResetAt: iso(next),
          resets: [iso(NOW - 4 * DAY), iso(NOW - 4 * DAY + HOUR), iso(NOW - 30 * DAY)],
        }),
      ],
      NOW,
    )
    expect(m.ticks.map((t) => [t.at, t.payer])).toEqual([
      [NOW - 4 * DAY + HOUR, 'me-sub'],
      [next, 'me-sub'],
    ])
    expect(m.window.from).toBe(NOW - 14 * DAY)
    expect(m.window.to).toBeGreaterThan(next)
  })
})

describe('creditDrain', () => {
  const now = Date.parse(PACE.asOf)
  const pool = (account: string, over: Partial<PacePool> = {}): PacePool => {
    const base = PACE.pools[0] as PacePool
    return { ...base, account, ...over }
  }
  const pace = (pools: PacePool[]): PaceResponse => ({ ...PACE, pools })

  it('sums the enabled pools and skips the one that is not enabled', () => {
    const { model, rows } = creditDrain(PACE, now)
    expect(rows.map((r) => r.account)).toEqual(['iu', 'me'])
    expect(model.headline).toBe('$182 left of $300')
    expect(model.yMax).toBe(300)
    expect(model.actual.at(-1)).toEqual(at(now, 88.43 + (PACE.pools[1]?.leftUsd ?? 0)))
  })

  it('names every pool that runs dry with its own day, or one with its gap to the renewal', () => {
    const dry = (account: string, dryAt: string): PacePool =>
      pool(account, {
        cycle: {
          start: '2026-10-21T00:00:00.000Z',
          end: '2026-11-21T00:00:00.000Z',
          status: 'open',
        },
        projection: { drawsFrom: null, dryAt, unspentAtEndUsd: null },
      })
    const two = creditDrain(
      pace([dry('me', '2026-11-14T00:00:00.000Z'), dry('iu', '2026-11-09T00:00:00.000Z')]),
      now,
    )
    expect(two.model.verdict).toContain('Pools empty in turn: iu 9 Nov, me 14 Nov')
    const one = creditDrain(pace([dry('iu', '2026-11-11T00:00:00.000Z')]), now)
    expect(one.model.verdict.replaceAll('\u00A0', ' ')).toContain(
      'iu runs dry 11 Nov, 10 d before it renews',
    )
  })

  it('draws a renewal as a jump back up and ticks it per pool', () => {
    const { model } = creditDrain(PACE, now)
    const iuEnd = Date.parse(PACE.pools[0]?.cycle.end ?? '')
    const before = model.projection.find((p) => p.at === iuEnd - 60_000)
    const after = model.projection.find((p) => p.at === iuEnd)
    expect(after?.left).toBeGreaterThan((before?.left ?? Infinity) + 100)
    expect(model.ticks.map((t) => [t.at, t.payer])).toContainEqual([iuEnd, 'iu-credit'])
    expect(model.ticks).toHaveLength(2)
  })

  it('sums pools of different cycle lengths on one window', () => {
    const short = pool('me', {
      grantUsd: 100,
      leftUsd: 40,
      cycle: { start: '2026-10-30T00:00:00.000Z', end: '2026-11-14T00:00:00.000Z', status: 'open' },
      days: [],
      projection: { drawsFrom: null, dryAt: null, unspentAtEndUsd: 40 },
    })
    const long = pool('iu', {
      grantUsd: 200,
      leftUsd: 150,
      cycle: { start: '2026-10-21T00:00:00.000Z', end: '2026-11-21T00:00:00.000Z', status: 'open' },
      projection: { drawsFrom: null, dryAt: null, unspentAtEndUsd: 150 },
    })
    const { model } = creditDrain(pace([long, short]), now)
    // The total starts where every cycle has begun, not at the longest cycle's start.
    expect(model.window.from).toBe(Date.parse('2026-10-30T00:00:00Z'))
    expect(model.actual[0]?.at).toBe(model.window.from)
    // Past the short cycle's end that pool is full again: 100 + the long pool's unspent 150.
    const shortEnd = Date.parse('2026-11-14T00:00:00Z')
    expect(model.projection.find((p) => p.at === shortEnd - 60_000)?.left).toBe(190)
    expect(model.projection.find((p) => p.at === shortEnd)?.left).toBe(250)
    // The even pace is one straight line that stops at the first renewal.
    expect(model.even.map((p) => p.at)).toEqual([model.window.from, shortEnd - 60_000])
    expect(model.even.at(-1)?.left).toBeLessThan(model.even[0]?.left ?? 0)
  })

  it('is empty without an enabled pool', () => {
    const { model, rows } = creditDrain(pace([pool('iu', { enabled: false })]), now)
    expect(model.empty).toBe('No credit pool enabled')
    expect(rows).toEqual([])
  })
})
