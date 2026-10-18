import { afterEach, describe, expect, it } from 'bun:test'
import { NBSP } from '../../lib/format'
import {
  shortDay,
  badDayCount,
  errorDaysLine,
  foldInfo,
  healthInfo,
  peakOf,
  topSourceNote,
  billingParts,
  errorRateReading,
  meanOf,
  errorComparison,
  priorNote,
  fmtPctBadge,
  fmtUsdDay,
  fmtTokensDay,
  fmtSeconds,
  errorDayState,
  fmtPct,
  fmtShare,
  fmtTokens,
  fmtUsdWhole,
  foldTopN,
  countAgainst,
  barStateOf,
  dropPartialBucket,
  periodNoun,
  printTotal,
  prepareFolded,
  FOLD_MAX_N,
  slowerDaysLine,
  cacheUnderLine,
  OTHER_KEY,
  pctChange,
  pctDelta,
  pointsDelta,
  secondsDelta,
  secondsQuantity,
  summaryFacts,
  summarySentence,
  freshness,
  recentMean,
  tokensQuantity,
} from './model'
import { RANK_PALETTE } from './constants'
import type { TimePoint } from './types'

describe('fmtUsdWhole', () => {
  it('prints whole dollars with a thousands separator, never compacted', () => {
    expect(fmtUsdWhole(1234.56)).toBe('$1,235')
    expect(fmtUsdWhole(12_000)).toBe('$12,000')
    expect(fmtUsdWhole(7)).toBe('$7')
  })
  it('reads sub-dollar totals as <$1 and unknown as a dash', () => {
    expect(fmtUsdWhole(0.4)).toBe('<$1')
    expect(fmtUsdWhole(0)).toBe('$0')
    expect(fmtUsdWhole(null)).toBe('—')
  })
})

describe('tokens and latency units', () => {
  it('scales tokens to B / M / k and keeps the unit apart', () => {
    expect(tokensQuantity(2_340_000_000)).toEqual({ value: '2.3', unit: 'B' })
    expect(tokensQuantity(5_600_000)).toEqual({ value: '5.6', unit: 'M' })
    expect(fmtTokens(2_340_000_000)).toBe('2.3\u00a0B')
    expect(fmtTokens(null)).toBe('—')
  })
  it('converts milliseconds to seconds, null stays a dash', () => {
    expect(secondsQuantity(4250)).toEqual({ value: '4.3', unit: 's' })
    expect(secondsQuantity(null)).toEqual({ value: '—', unit: '' })
  })
  it('formats ratios', () => {
    expect(fmtPct(0.872)).toBe('87.2%')
    expect(fmtPct(null)).toBe('—')
  })
})

describe('fmtShare', () => {
  it('rounds to a whole percent and marks a non-zero sliver as <1%', () => {
    expect(fmtShare(0.968)).toBe('97%')
    expect(fmtShare(0.003)).toBe('<1%')
    expect(fmtShare(0)).toBe('0%')
    expect(fmtShare(null)).toBe('—')
  })
})

describe('deltas', () => {
  it('computes signed relative change and names no value without a prior', () => {
    expect(pctChange(120, 100)).toBeCloseTo(0.2)
    expect(pctChange(100, 0)).toBeNull()
    expect(pctChange(100, null)).toBeNull()
  })
})

describe('billingParts', () => {
  it('folds openrouter and untagged cost into Other so the parts sum to the total', () => {
    const parts = billingParts({ max: 60, iu: 30, openrouter: 5, total: 100 })
    expect(parts.map((p) => p.key)).toEqual(['max', 'iu', 'other'])
    expect(parts[2]?.value).toBe(10)
    expect(parts.reduce((a, p) => a + p.value, 0)).toBe(100)
    expect(parts[0]?.share).toBeCloseTo(0.6)
  })
  it('has zero shares for a zero total', () => {
    expect(
      billingParts({ max: 0, iu: 0, openrouter: 0, total: 0 }).every((p) => p.share === 0),
    ).toBe(true)
  })
})

const day = (d: number, groups: Record<string, number>): TimePoint => ({
  date: new Date(2026, 0, d),
  groups,
})

describe('foldTopN', () => {
  const points = [day(1, { a: 10, b: 5, c: 3, d: 1 }), day(2, { a: 10, b: 0, c: 3, d: 9 })]

  it('keeps the top n by window total and sums the rest into Other in every bucket', () => {
    const f = foldTopN(points, ['a', 'b', 'c', 'd'], 2)
    expect(f.keys).toEqual(['a', 'd', OTHER_KEY])
    expect(f.points[0]?.groups).toEqual({ a: 10, d: 1, [OTHER_KEY]: 8 })
    expect(f.points[1]?.groups).toEqual({ a: 10, d: 9, [OTHER_KEY]: 3 })
    expect(f.folded).toBe(2)
  })
  it('totals match the points and the list', () => {
    const f = foldTopN(points, ['a', 'b', 'c', 'd'], 2)
    expect(f.totals).toEqual([
      { key: 'a', value: 20 },
      { key: 'd', value: 10 },
      { key: OTHER_KEY, value: 11 },
    ])
    expect(f.total).toBe(41)
  })
  it('adds no Other when nothing folds', () => {
    const f = foldTopN(points, ['a', 'b'], 6)
    expect(f.keys).toEqual(['a', 'b'])
    expect(f.folded).toBe(0)
  })
})

describe('error days', () => {
  it('bands a daily rate at 1 % and 3 %', () => {
    expect(errorDayState(0.005)).toBe('ok')
    expect(errorDayState(0.01)).toBe('warn')
    expect(errorDayState(0.03)).toBe('warn')
    expect(errorDayState(0.031)).toBe('bad')
    expect(errorDayState(null)).toBe('none')
  })
  it('counts bad days and ignores days without calls', () => {
    expect(badDayCount([0, 0.05, null, 0.2, 0.02])).toBe(2)
  })
})

describe('freshness and copy', () => {
  const now = Date.parse('2026-10-17T12:00:00Z')
  it('the headline sentence carries the spend, the facts carry the rest', () => {
    expect(summarySentence({ calls30d: 12345 })).toBe('12,345 calls in the last 30\u00a0d')
    expect(summaryFacts({ sources: 7, lastEvent: '3 minutes ago' })).toEqual([
      '7 sources active',
      'last event 3 minutes ago',
    ])
    expect(summaryFacts({ sources: null, lastEvent: null })).toEqual(['no events recorded'])
  })
  it('names the freshness in words and tones it', () => {
    expect(freshness('2026-10-17T11:45:00Z', now)).toEqual({ word: 'fresh', tone: 'ok' })
    expect(freshness('2026-10-17T11:20:00Z', now)).toEqual({ word: 'stale 40 min', tone: 'warn' })
    expect(freshness('2026-10-17T10:00:30Z', now)).toEqual({ word: 'stale 2 h', tone: 'bad' })
    expect(freshness('2026-10-17T10:00:10Z', now)).toEqual({ word: 'stale 2 h', tone: 'bad' })
    expect(freshness('2026-10-17T10:00:20Z', now).tone).toBe('bad')
    expect(freshness(null, now)).toEqual({ word: 'no events', tone: 'none' })
  })
})

describe('recentMean', () => {
  it('averages the last readings, skipping gaps', () => {
    const values = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9]
    expect(recentMean(values)).toBeCloseTo(0.9)
    expect(recentMean([null, 0.6, null])).toBeCloseTo(0.6)
    expect(recentMean([null, null])).toBeNull()
  })
  it('counts trailing gaps as part of the calendar window', () => {
    // 12 slots, the last 5 empty: the window is slots 6–12, so the older 0.2 days never reach in.
    const values = [0.2, 0.2, 0.2, 0.2, 0.2, 0.6, 0.6, null, null, null, null, null]
    expect(recentMean(values)).toBeCloseTo(0.6)
    expect(
      recentMean([
        0.2,
        0.2,
        0.2,
        0.2,
        0.2,
        0.2,
        0.2,
        0.2,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ]),
    ).toBeNull()
  })
})

describe('prior comparisons', () => {
  it('separates an absent field from an absent window and shows no note when the badge reads', () => {
    expect(priorNote(120, undefined, pctDelta)).toBe('prior unavailable')
    expect(priorNote(120, null, pctDelta)).toBe('no comparable prior 30\u00a0d')
    expect(priorNote(120, 100, pctDelta)).toBeNull()
    expect(priorNote(120, 0, pctDelta)).toBe('prior 30\u00a0d had no base to compare')
    const calls = 100
    expect(errorComparison({ current: 0.02, prior: undefined, calls }).note).toBe(
      'prior unavailable',
    )
    expect(errorComparison({ current: 0.02, prior: null, calls }).note).toBe(
      'no comparable prior 30\u00a0d',
    )
    expect(errorComparison({ current: 0.02, prior: 0.012, calls })).toEqual({
      value: expect.closeTo(0.8),
      note: 'vs 1.2% prior 30\u00a0d',
    })
    expect(errorComparison({ current: 0, prior: 0.012, calls: 0 })).toEqual({
      value: null,
      note: 'no calls to rate',
    })
  })
})

describe('error rate reading', () => {
  it('is a dash for a window with no calls, never 0.0%', () => {
    expect(errorRateReading(0, 0)).toBe('—')
    expect(errorRateReading(0, 12)).toBe('0.0%')
    expect(errorRateReading(0.005, 200)).toBe('0.5%')
    expect(errorRateReading(0.005, undefined)).toBe('0.5%')
    expect(errorRateReading(null, 5)).toBe('—')
  })
})

describe('meanOf', () => {
  it('averages present values and ignores gaps', () => {
    expect(meanOf([2, null, 4])).toBe(3)
    expect(meanOf([null])).toBeNull()
  })
})

describe('badge deltas', () => {
  it('pctDelta is the signed percent change, null without a base', () => {
    expect(pctDelta(150, 100)).toBe(50)
    expect(pctDelta(50, 100)).toBe(-50)
    expect(pctDelta(5, 0)).toBeNull()
    expect(pctDelta(null, 10)).toBeNull()
  })

  it('secondsDelta converts a millisecond difference to seconds', () => {
    expect(secondsDelta(1500, 1000)).toBe(0.5)
    expect(secondsDelta(1000, null)).toBeNull()
  })

  it('pointsDelta is the ratio difference in percentage points', () => {
    expect(pointsDelta(0.03, 0.01)).toBeCloseTo(2)
    expect(pointsDelta(null, 0.01)).toBeNull()
  })

  it('refuses a non-finite reading instead of printing NaN', () => {
    expect(secondsDelta(Number.NaN, 1000)).toBeNull()
    expect(pointsDelta(0.1, Number.POSITIVE_INFINITY)).toBeNull()
    expect(pctDelta(Number.NaN, 10)).toBeNull()
  })
})

describe('readout formatters', () => {
  it('every readout carries its unit', () => {
    expect(fmtUsdDay(12.4)).toBe('$12.40')
    expect(fmtTokensDay(3_200_000)).toBe('3.2\u00a0M tokens')
    expect(fmtTokensDay(950)).toBe('950 tokens')
    expect(fmtSeconds(1800)).toBe('1.8\u00a0s')
    expect(fmtSeconds(Number.NaN)).toBe('—')
  })

  it('badge magnitudes keep one decimal so a small change is not a red 0%', () => {
    expect(fmtPctBadge(-0.4)).toBe('0.4%')
  })
})

describe('shortDay', () => {
  it('keeps the date whole across a line break', () => {
    expect(shortDay(new Date(2026, 9, 3))).toBe(`3${NBSP}Oct`)
  })
})

describe('error days, peak and source note', () => {
  it('words warn and bad days with counts', () => {
    expect(errorDaysLine([0, 0.02, 0.05, null, 0.011])).toBe(
      `2${NBSP}warn${NBSP}days${NBSP}(1%–3%), 1${NBSP}bad${NBSP}day${NBSP}(>${NBSP}3%)`,
    )
    expect(errorDaysLine([0.02, null])).toBe(`1${NBSP}warn${NBSP}day${NBSP}(1%–3%)`)
    expect(errorDaysLine([0, 0.001])).toBe('no day above 1%')
    expect(errorDaysLine([null, null])).toBe('no daily reading yet')
  })
  it('finds the peak day', () => {
    const days = [
      { date: 'a', value: 1 },
      { date: 'b', value: 4 },
      { date: 'c', value: null },
    ]
    expect(peakOf(days)?.date).toBe('b')
    expect(peakOf([{ date: 'x', value: null }])).toBeNull()
  })
  it('words the health and fold info from the constants', () => {
    expect(healthInfo('week')).toContain('a week under 1%')
    expect(foldInfo('billing lane')).toBe(
      'The largest billing lanes in the window are named (at least 6, more while the rest would outweigh the smallest), the rest are grouped as Other.',
    )
  })
  it('states what the source percentage is of', () => {
    expect(topSourceNote('api', 30, 100)).toBe('30% from api')
    expect(topSourceNote('api', 0, 0)).toBe('api')
  })
})

describe('foldTopN widening', () => {
  const points = [day(1, { a: 10, b: 9, c: 8, d: 7, e: 6 })]
  const keys = ['a', 'b', 'c', 'd', 'e']

  it('widens until Other no longer outweighs the smallest named series', () => {
    const f = foldTopN(points, keys, 2, 5)
    expect(f.keys).toEqual(['a', 'b', 'c', 'd', OTHER_KEY])
    const other = f.totals.find((t) => t.key === OTHER_KEY)?.value ?? 0
    expect(other).toBeLessThanOrEqual(7)
  })
  it('stops at max even when Other is still the largest', () => {
    const f = foldTopN(points, keys, 1, 2)
    expect(f.keys).toEqual(['a', 'b', OTHER_KEY])
  })
  it('keeps n when max is not given', () => {
    expect(foldTopN(points, keys, 2).keys).toEqual(['a', 'b', OTHER_KEY])
  })
})

describe('dropPartialBucket', () => {
  const original = process.env['TZ']
  // January offsets (minutes west of UTC), so each case proves its zone took effect.
  const ZONES = [
    ['UTC', 0],
    ['America/Los_Angeles', 480],
    ['Pacific/Kiritimati', -840],
    ['America/Santiago', 180],
  ] as const
  const values = (rows: ReadonlyArray<{ value: number }>) => rows.map((d) => d.value)
  const at = (y: number, m: number, d: number) => ({ date: new Date(y, m, d), value: d })

  afterEach(() => {
    if (original === undefined) delete process.env['TZ']
    else process.env['TZ'] = original
  })

  for (const [tz, offset] of ZONES) {
    it(`measures against the UTC clock in ${tz}`, () => {
      process.env['TZ'] = tz
      expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(offset)
      const days = [1, 2, 3, 4].map((d) => at(2026, 0, d))
      expect(values(dropPartialBucket(days, Date.UTC(2026, 0, 3, 0, 30), 'day'))).toEqual([1, 2])
      expect(values(dropPartialBucket(days, Date.UTC(2026, 0, 3, 23, 59, 59, 999), 'day'))).toEqual(
        [1, 2],
      )
      expect(values(dropPartialBucket(days, Date.UTC(2026, 0, 4, 0, 0), 'day'))).toEqual([1, 2, 3])
      expect(dropPartialBucket(days, Date.UTC(2026, 0, 5, 0, 0), 'day')).toHaveLength(4)
      const weeks = [4, 11, 18].map((d) => at(2026, 0, d))
      const end = Date.UTC(2026, 0, 25)
      expect(values(dropPartialBucket(weeks, end - 1, 'week'))).toEqual([4, 11])
      expect(values(dropPartialBucket(weeks, end, 'week'))).toEqual([4, 11, 18])
    })
  }

  it('keeps the days around a midnight daylight-saving jump (Santiago, 2026-09-06)', () => {
    process.env['TZ'] = 'America/Santiago'
    const days = [5, 6, 7].map((d) => at(2026, 8, d))
    expect(values(dropPartialBucket(days, Date.UTC(2026, 8, 7, 12), 'day'))).toEqual([5, 6])
    expect(values(dropPartialBucket(days, Date.UTC(2026, 8, 8, 0), 'day'))).toEqual([5, 6, 7])
  })

  it('keeps the running bucket when fewer than two complete ones remain', () => {
    const week = [at(2026, 0, 18)]
    expect(dropPartialBucket(week, Date.UTC(2026, 0, 20), 'week')).toEqual(week)
    const two = [at(2026, 0, 17), at(2026, 0, 18)]
    expect(dropPartialBucket(two, Date.UTC(2026, 0, 18, 12), 'day')).toEqual(two)
    expect(
      values(dropPartialBucket([...two, at(2026, 0, 19)], Date.UTC(2026, 0, 19, 12), 'day')),
    ).toEqual([17, 18])
  })
})

describe('printTotal', () => {
  it('prints a total only where the strip does not', () => {
    const base = { filtered: false } as const
    expect(printTotal({ ...base, range: '30d' })).toBe(false)
    expect(printTotal({ ...base, range: '7d' })).toBe(true)
    expect(printTotal({ ...base, range: '90d' })).toBe(true)
    expect(printTotal({ ...base, range: 'all' })).toBe(true)
    expect(printTotal({ ...base, range: '30d', filtered: true })).toBe(true)
    expect(printTotal({ ...base, range: '7d', filtered: true })).toBe(true)
  })
})

describe('barStateOf', () => {
  it('is the verdict, and nothing for a day with no calls and no events', () => {
    expect(barStateOf({ state: 'warn', count: 3 })).toBe('warn')
    expect(barStateOf({ state: 'none', count: 0 })).toBeNull()
    expect(barStateOf({ state: 'none', count: 2 })).toBe('ok')
  })
})

describe('periodNoun', () => {
  it('names every range explicitly, units glued', () => {
    expect(periodNoun('7d')).toBe('7\u00a0d')
    expect(periodNoun('90d')).toBe('90\u00a0d')
    expect(periodNoun('all')).toBe('all time')
  })
})

describe('fold palette', () => {
  it('the rank palette has a hue for every series the fold can name', () => {
    expect(RANK_PALETTE.length).toBeGreaterThanOrEqual(FOLD_MAX_N)
  })
})

describe('day-count sentences', () => {
  it('counts days slower than the window p95, null without a window or a day', () => {
    expect(slowerDaysLine([1, 5, null, 9], 4)).toBe('2 of 3 days slower than the 30\u00a0d p95')
    expect(slowerDaysLine([1, 5], null)).toBeNull()
    expect(slowerDaysLine([null], 4)).toBeNull()
  })
  it('counts days under the cache target, null without a day', () => {
    expect(cacheUnderLine([0.5, 0.7, 0.59, null])).toBe('2 of 3 days under it')
    expect(cacheUnderLine([])).toBeNull()
  })
})

describe('countAgainst', () => {
  it('counts days strictly above or below a line and ignores gaps', () => {
    const values = [1, 2, null, 3, 2]
    expect(countAgainst(values, 2, 'above')).toEqual({ count: 1, of: 4 })
    expect(countAgainst(values, 2, 'below')).toEqual({ count: 1, of: 4 })
  })
})

describe('prepareFolded', () => {
  const points = [day(1, { mcp__s__a: 5, mcp__s__b: 4, Bash: 3, Read: 1 })]
  const groupKeys = ['mcp__s__a', 'mcp__s__b', 'Bash', 'Read']

  it('counts tools per MCP server and labels them in words', () => {
    const { folded, labelOf } = prepareFolded({ points, groupKeys, groupBy: 'sub_tool' })
    expect(folded.keys).toEqual(['mcp__s', 'Bash', 'Read'])
    expect(folded.points[0]?.groups).toEqual({ mcp__s: 9, Bash: 3, Read: 1 })
    expect(labelOf('mcp__s')).toBe('S (MCP)')
    expect(labelOf('mcp__chrome-devtools__take_screenshot')).toBe(
      'Chrome devtools · Take screenshot',
    )
    expect(labelOf('web_search')).toBe('Web search')
    expect(labelOf('file.read')).toBe('File read')
    expect(labelOf('Task:sub/agent')).toBe('Task sub agent')
    expect(labelOf('Skill:review/deep')).toBe('Skill review deep')
    expect(labelOf(OTHER_KEY)).toBe(OTHER_KEY)
  })
  it('leaves every other dimension as sent', () => {
    const { folded, labelOf } = prepareFolded({ points, groupKeys, groupBy: 'project' })
    expect(folded.keys).toEqual(['mcp__s__a', 'mcp__s__b', 'Bash', 'Read'])
    expect(labelOf('Bash')).toBe('Bash')
  })
})
