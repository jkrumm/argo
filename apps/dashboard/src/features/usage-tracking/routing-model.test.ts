import { describe, expect, it } from 'bun:test'
import { VX } from 'basalt-ui/tokens'
import { ROUTING_REASON } from '../../lib/series'
import type { AccountPick } from '../../lib/queries/usage'
import {
  IDLE_STATE,
  NONE_STATE,
  binMsFor,
  cellState,
  fiveHourRows,
  laneRows,
  laneSpillRows,
  reasonColor,
  reasonKeys,
  reasonLabel,
  reasonRows,
  reasonSummary,
  resetTicks,
  routingAccounts,
  snapshotText,
  spillFacts,
  stripTickLabel,
  stripTicks,
  tuningRows,
  windowFacts,
  windowStart,
} from './routing-model'

const HOUR = 3_600_000
const t0 = Date.parse('2026-10-26T00:00:00Z')

const pick = (over: Partial<AccountPick> & { at: number }): AccountPick => {
  const { at, ...rest } = over
  return {
    ts: new Date(t0 + at * HOUR).toISOString(),
    lane: 'wave',
    picked: 'me',
    reason: 'home',
    stale: false,
    snapshot: {},
    ...rest,
  }
}

describe('windowStart', () => {
  it('is the range start, or the first pick when the data begins inside it', () => {
    const picks = [pick({ at: 5 }), pick({ at: 2 })]
    expect(windowStart(picks, t0 + 100 * HOUR, 24)).toBe(t0 + 76 * HOUR)
    expect(windowStart(picks, t0 + 10 * HOUR, 168)).toBe(t0 + 2 * HOUR)
  })

  it('is the range start without picks', () => {
    expect(windowStart([], t0 + 10 * HOUR, 24)).toBe(t0 - 14 * HOUR)
  })
})

describe('binMsFor', () => {
  it('keeps every range near 100–170 cells', () => {
    for (const hours of [24, 72, 168, 336, 504]) {
      const cells = (hours * HOUR) / binMsFor(hours)
      expect(cells).toBeGreaterThanOrEqual(96)
      expect(cells).toBeLessThanOrEqual(170)
    }
  })
})

describe('laneRows', () => {
  const picks = [
    pick({ at: 1, lane: 'wave' }),
    pick({ at: 1.2, lane: 'wave', picked: 'me2' }),
    pick({ at: 3, lane: 'wave' }),
    pick({ at: 2, lane: 'interactive', picked: 'iu' }),
    pick({ at: 40, lane: 'old' }),
  ]

  it('orders lanes by pick count and bins the picks oldest first', () => {
    const { lanes, hidden } = laneRows(picks, t0, t0 + 6 * HOUR, HOUR, 8)
    expect(hidden).toBe(0)
    expect(lanes.map((l) => [l.lane, l.total])).toEqual([
      ['wave', 3],
      ['interactive', 1],
    ])
    const wave = lanes[0]!
    expect(wave.cells).toHaveLength(6)
    expect(wave.cells[1]?.picks.map((p) => p.picked)).toEqual(['me', 'me2'])
    expect(wave.cells[3]?.picks).toHaveLength(1)
    expect(wave.cells[0]?.picks).toEqual([])
  })

  it('counts the lanes past the cap instead of drawing them', () => {
    const { lanes, hidden } = laneRows(picks, t0, t0 + 6 * HOUR, HOUR, 1)
    expect(lanes.map((l) => l.lane)).toEqual(['wave'])
    expect(hidden).toBe(1)
  })
})

describe('cellState', () => {
  it('is idle without picks and the last account otherwise', () => {
    expect(cellState([]).state).toBe(IDLE_STATE)
    expect(cellState([pick({ at: 0 }), pick({ at: 1, picked: 'me2' })])).toEqual({
      state: 'me2',
      overflow: false,
    })
  })

  it('marks overflow served by an account and lets an unserved pick win', () => {
    expect(cellState([pick({ at: 0, reason: 'spill' })])).toEqual({ state: 'me', overflow: true })
    expect(
      cellState([
        pick({ at: 0 }),
        pick({ at: 1, picked: 'spill', reason: 'no-eligible-account' }),
        pick({ at: 2 }),
      ]).state,
    ).toBe(NONE_STATE)
  })
})

describe('snapshotText', () => {
  it('prints 5 h/weekly per account in registry order, dashes for unknowns', () => {
    expect(
      snapshotText({
        me2: { s: 11, w: 1 },
        iu: { s: 0, w: 94 },
        me: { s: 35.4, w: null },
      }),
    ).toBe('iu 0/94 · me 35/– · me2 11/1')
    expect(snapshotText({})).toBe('–')
  })
})

describe('reasonSummary', () => {
  it('names one reason, counts repeats', () => {
    expect(reasonSummary([pick({ at: 0 })])).toBe('home')
    expect(reasonSummary([pick({ at: 0 }), pick({ at: 1 }), pick({ at: 2, reason: 'pace' })])).toBe(
      'home ×2 · pace',
    )
  })
})

describe('stripTicks', () => {
  const cells = Array.from({ length: 168 }, (_, i) => ({
    at: new Date(t0 + i * HOUR),
    picks: [],
  }))

  it('lands every tick on a cell start, one per day for a week', () => {
    const ticks = stripTicks(cells, 168)
    expect(ticks.length).toBeGreaterThanOrEqual(6)
    expect(ticks.length).toBeLessThanOrEqual(8)
    for (const t of ticks) expect(cells.some((c) => c.at.getTime() === t)).toBe(true)
  })

  it('is empty without cells', () => {
    expect(stripTicks([], 168)).toEqual([])
  })

  it('labels a local midnight with the day and other ticks with the clock', () => {
    const midnight = new Date(2026, 9, 27, 0, 0).getTime()
    expect(stripTickLabel(midnight, () => 'DAY')).toBe('DAY')
    expect(stripTickLabel(new Date(2026, 9, 27, 6, 0).getTime(), () => 'DAY')).toBe('06:00')
  })
})

describe('reason ordering and colour', () => {
  it('puts healthy reasons first, others sorted, status reasons last', () => {
    expect(
      reasonKeys(['spill', 'zeta', 'session', 'home', 'no-eligible-account', 'alpha', 'pace']),
    ).toEqual(['home', 'pace', 'session', 'alpha', 'zeta', 'spill', 'no-eligible-account'])
  })

  it('shades the healthy reasons, inks the failures, greys the rest', () => {
    expect(reasonColor('home')).toBe(ROUTING_REASON.home)
    expect(reasonColor('pace')).toBe(ROUTING_REASON.pace)
    expect(reasonColor('session')).toBe(ROUTING_REASON.session)
    expect(reasonColor('spill')).toBe(VX.status.warn)
    expect(reasonColor('no-eligible-account')).toBe(VX.status.bad)
    expect(reasonColor('interactive-fallback')).toBe(ROUTING_REASON.other)
    expect(reasonColor('brand-new')).toBe(ROUTING_REASON.other)
  })

  it('words known reasons and humanises unseen ones', () => {
    expect(reasonLabel('no-eligible-account')).toBe('No eligible account')
    expect(reasonLabel('brand-new-reason')).toBe('Brand new reason')
  })

  it('turns summary buckets into rows oldest first with totals', () => {
    const rows = reasonRows([
      { at: '2026-10-26T00:00:00.000Z', picks: { home: 2, spill: 1 } },
      { at: '2026-10-25T00:00:00.000Z', picks: { home: 4 } },
    ])
    expect(rows.map((r) => r.total)).toEqual([4, 3])
  })
})

describe('facts', () => {
  it('spill rate is spills over picks, null without picks', () => {
    const lanes = [
      { lane: 'a', total: 10, spills: 2, spillRate: 0.2 },
      { lane: 'b', total: 30, spills: 6, spillRate: 0.2 },
    ]
    expect(spillFacts(lanes, 40)).toEqual({ picks: 40, spills: 8, rate: 0.2 })
    expect(spillFacts([], 0).rate).toBeNull()
  })

  it('orders lanes worst spill rate first', () => {
    const rows = laneSpillRows([
      { lane: 'a', total: 50, spills: 0, spillRate: 0 },
      { lane: 'b', total: 4, spills: 3, spillRate: 0.75 },
      { lane: 'c', total: 30, spills: 3, spillRate: 0.1 },
    ])
    expect(rows.map((r) => r.lane)).toEqual(['b', 'c', 'a'])
  })

  const win = (over: Partial<Parameters<typeof windowFacts>[0][number]>) => ({
    account: 'me',
    window: 'five_hour' as const,
    resetAt: '2026-10-26T00:00:00.000Z',
    pctAtReset: 50,
    unusedPct: 50,
    lastSampleAt: null,
    firstPickAt: null,
    minutesToFirstPick: null,
    ...over,
  })

  it('pools the 5 h windows of every account and ignores 7 d ones', () => {
    const f = windowFacts([
      win({ unusedPct: 10, minutesToFirstPick: 30, firstPickAt: 'x' }),
      win({ account: 'iu', unusedPct: 90, minutesToFirstPick: 90, firstPickAt: 'x' }),
      win({ unusedPct: 50 }),
      win({ window: 'seven_day', unusedPct: 99 }),
    ])
    expect(f).toEqual({ resets: 3, medianUnused: 50, medianWait: 60, neverPicked: 1 })
  })

  it('has null medians without windows', () => {
    expect(windowFacts([])).toEqual({
      resets: 0,
      medianUnused: null,
      medianWait: null,
      neverPicked: 0,
    })
  })
})

describe('tuningRows', () => {
  const summary = [
    {
      account: 'me',
      window: 'five_hour' as const,
      resets: 4,
      medianUnusedPct: 40,
      meanUnusedPct: 41,
      medianMinutesToFirstPick: 55,
      neverPickedAfter: 1,
    },
    {
      account: 'me',
      window: 'seven_day' as const,
      resets: 1,
      medianUnusedPct: 7,
      meanUnusedPct: 7,
      medianMinutesToFirstPick: null,
      neverPickedAfter: 0,
    },
  ]
  const sevenDay = (resetAt: string, unusedPct: number) => ({
    account: 'me',
    window: 'seven_day' as const,
    resetAt,
    pctAtReset: 100 - unusedPct,
    unusedPct,
    lastSampleAt: null,
    firstPickAt: null,
    minutesToFirstPick: null,
  })

  it('reads the last 7 d reset, zero-fills accounts without windows', () => {
    const rows = tuningRows(['iu', 'me'], summary, [
      sevenDay('2026-10-20T00:00:00Z', 30),
      sevenDay('2026-10-27T00:00:00Z', 12),
    ])
    expect(rows[1]).toMatchObject({
      account: 'me',
      title: 'Me Max',
      fiveResets: 4,
      fiveUnused: 40,
      sevenResets: 1,
      sevenUnused: 12,
      wait: 55,
      never: 1,
    })
    expect(rows[0]).toMatchObject({ account: 'iu', fiveResets: 0, fiveUnused: null, wait: null })
  })

  it('names the accounts the data mentions, registry order first, never the spill pseudo-account', () => {
    expect(
      routingAccounts(
        [
          pick({ at: 0, picked: 'me2' }),
          pick({ at: 1, picked: 'spill', reason: 'no-eligible-account' }),
        ],
        [{ account: 'iu', points: [] }],
        summary,
      ),
    ).toEqual(['iu', 'me', 'me2'])
  })
})

describe('sawtooth rows and reset ticks', () => {
  const series = [
    {
      account: 'iu',
      points: [
        { at: '2026-10-26T10:00:00.000Z', fiveHourPct: 10, sevenDayPct: 1 },
        { at: '2026-10-26T11:00:00.000Z', fiveHourPct: null, sevenDayPct: 1 },
      ],
    },
    {
      account: 'me',
      points: [{ at: '2026-10-26T11:00:00.000Z', fiveHourPct: 95, sevenDayPct: 2 }],
    },
  ]

  it('reads the 5 h percent per instant, null as a gap, and cuts at the start', () => {
    const rows = fiveHourRows(series, Date.parse('2026-10-26T10:30:00Z'))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.pct).toEqual({ iu: null, me: 95 })
    expect(fiveHourRows(series, 0)).toHaveLength(2)
  })

  it('keeps the resets inside the drawn rows, oldest first', () => {
    const ticks = resetTicks(
      [
        { account: 'me', window: 'seven_day', at: '2026-10-26T12:00:00.000Z' },
        { account: 'iu', window: 'five_hour', at: '2026-10-26T09:00:00.000Z' },
        { account: 'iu', window: 'five_hour', at: '2026-10-26T10:00:00.000Z' },
      ],
      Date.parse('2026-10-26T10:00:00Z'),
      Date.parse('2026-10-26T13:00:00Z'),
    )
    expect(ticks.map((t) => [t.account, t.window])).toEqual([
      ['iu', 'five_hour'],
      ['me', 'seven_day'],
    ])
  })
})
