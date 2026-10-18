import { afterEach, describe, expect, it } from 'bun:test'
import { NBSP } from '../../lib/format'
import {
  noHealthReading,
  noUsageWindow,
  stripCoversRange,
  isFiltered,
  NO_USAGE_CELL,
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
  fmtSecondsBadge,
  fmtPointsBadge,
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
  tokensFormatterFor,
  peakBucketTotal,
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
    expect(fmtPct(0.872)).toBe('87.2\u00a0%')
    expect(fmtPct(null)).toBe('—')
  })
})

describe('fmtShare', () => {
  it('rounds to a whole percent and marks a non-zero sliver as <1%', () => {
    expect(fmtShare(0.968)).toBe('97\u00a0%')
    expect(fmtShare(0.003)).toBe('<1\u00a0%')
    expect(fmtShare(0)).toBe('0\u00a0%')
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

describe('foldTopN ties', () => {
  it('equal totals rank by key, whatever order the keys arrive in', () => {
    const points = [{ date: '2026-01-01', groups: { b: 5, a: 5, c: 5 } }]
    const forward = foldTopN(points, ['a', 'b', 'c'], 3)
    const reversed = foldTopN(points, ['c', 'b', 'a'], 3)
    expect(forward.keys).toEqual(['a', 'b', 'c'])
    expect(reversed.keys).toEqual(forward.keys)
  })
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
      note: 'was 1.2\u00a0%',
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
    expect(errorRateReading(0, 12)).toBe('0.0\u00a0%')
    expect(errorRateReading(0.005, 200)).toBe('0.5\u00a0%')
    expect(errorRateReading(0.005, undefined)).toBe('0.5\u00a0%')
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
    expect(fmtUsdWhole(12.4)).toBe('$12')
    expect(fmtTokensDay(3_200_000)).toBe('3.2\u00a0M tokens')
    expect(fmtTokensDay(950)).toBe('950 tokens')
    expect(fmtSeconds(1800)).toBe('1.8\u00a0s')
    expect(fmtSeconds(Number.NaN)).toBe('—')
  })

  it('badge magnitudes keep one decimal so a small change is not a red 0%', () => {
    expect(fmtPctBadge(-0.4)).toBe('0.4\u00a0%')
    expect(fmtPointsBadge(-1.26)).toBe('1.3\u00a0pp')
    expect(fmtSecondsBadge(0.44)).toBe('0.4\u00a0s')
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
      `2${NBSP}warn${NBSP}days${NBSP}(1\u00a0%–3\u00a0%), 1${NBSP}bad${NBSP}day${NBSP}(>${NBSP}3\u00a0%)`,
    )
    expect(errorDaysLine([0.02, null])).toBe(`1${NBSP}warn${NBSP}day${NBSP}(1\u00a0%–3\u00a0%)`)
    expect(errorDaysLine([0, 0.001])).toBe('no day above 1\u00a0%')
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
    expect(healthInfo('week')).toContain('a week under 1\u00a0%')
    expect(foldInfo('billing lane')).toBe(
      'The largest billing lanes in the window are named (at least 6, more while the rest would outweigh the smallest), the rest are grouped as Other.',
    )
  })
  it('states what the source percentage is of', () => {
    expect(topSourceNote('api', 30, 100)).toBe('30\u00a0% from api')
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
    expect(slowerDaysLine([1, 5, null, 9], 4)).toBe(
      '2 of 3 full days slower than the 30\u00a0d p95',
    )
    expect(slowerDaysLine([1, 5], null)).toBeNull()
    expect(slowerDaysLine([null], 4)).toBeNull()
  })
  it('counts days under the cache target, null without a day', () => {
    expect(cacheUnderLine([0.5, 0.7, 0.59, null])).toBe('2 of 3 full days under it')
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

describe('tokensFormatterFor', () => {
  const NB = '\u00a0'
  it('prints every value in the magnitude of the reference', () => {
    const f = tokensFormatterFor(5_600_000)
    expect(f(5_600_000)).toBe(`5.6${NB}M`)
    expect(f(360_000)).toBe(`0.36${NB}M`)
    expect(f(0)).toBe(`0${NB}M`)
    expect(f(20_000)).toBe(`0.02${NB}M`)
    expect(tokensFormatterFor(2_340_000_000)(120_000_000)).toBe(`0.12${NB}B`)
    expect(tokensFormatterFor(900)(12)).toBe('12')
  })
  it('prints every sub-unit value with two decimals, however the digits fall', () => {
    const f = tokensFormatterFor(2_340_000_000)
    expect(f(52_000_000)).toBe(`0.05${NB}B`)
    expect(f(500_000_000)).toBe(`0.50${NB}B`)
    expect(f(123_000_000)).toBe(`0.12${NB}B`)
    expect(f(1_800_000_000)).toBe(`1.8${NB}B`)
  })
  it('rolls a value that rounds to one unit up to one decimal, not two', () => {
    // 0.96 M prints `1.0 M` (rounded-value rule), never `0.96 M` beside `1.0 M`.
    expect(tokensFormatterFor(5_600_000)(960_000)).toBe(`1.0${NB}M`)
    expect(tokensFormatterFor(5_600_000)(950_000)).toBe(`1.0${NB}M`)
    expect(tokensFormatterFor(5_600_000)(940_000)).toBe(`0.94${NB}M`)
  })
  it('never prints a non-zero value as zero, and keeps the sign', () => {
    const f = tokensFormatterFor(5_600_000)
    expect(f(1_000)).toBe(`<0.01${NB}M`)
    expect(f(-1_000)).toBe(`>-0.01${NB}M`)
    expect(f(-20_000)).toBe(`-0.02${NB}M`)
    expect(f(999_996)).toBe(`1.0${NB}M`)
    expect(tokensFormatterFor(900)(0.4)).toBe('<1')
    expect(tokensFormatterFor(900)(-0.4)).toBe('>-1')
    expect(tokensFormatterFor(900)(0)).toBe('0')
  })
  it('picks the unit from the rounded value', () => {
    expect(tokensQuantity(999_960)).toEqual({ value: '1.0', unit: 'M' })
    expect(tokensQuantity(999_960_000)).toEqual({ value: '1.0', unit: 'B' })
    expect(tokensQuantity(999_940)).toEqual({ value: '999.9', unit: 'k' })
    expect(tokensQuantity(999.5)).toEqual({ value: '1.0', unit: 'k' })
    expect(tokensQuantity(999.96)).toEqual({ value: '1.0', unit: 'k' })
    expect(tokensQuantity(999.4)).toEqual({ value: '999', unit: '' })
    expect(tokensFormatterFor(900)(999.5)).toBe(`1.0${NB}k`)
    expect(tokensFormatterFor(5_000)(999_960)).toBe(`1.0${NB}M`)
    expect(tokensFormatterFor(5_000)(999_940)).toBe(`999.9${NB}k`)
    expect(tokensFormatterFor(999_960_000)(1_000_000)).toBe(`<0.01${NB}B`)
  })
})

describe('peakBucketTotal', () => {
  it('is the tallest stacked bucket, null groups counting as zero', () => {
    const d = new Date(2026, 0, 1)
    expect(
      peakBucketTotal([
        { date: d, groups: { a: 1, b: null } },
        { date: d, groups: { a: 2, b: 5 } },
      ]),
    ).toBe(7)
    expect(peakBucketTotal([])).toBe(0)
  })
})

describe('noHealthReading', () => {
  it('a latency line keeps the card even when no call carries an error rate', () => {
    expect(noHealthReading(false, 0)).toBe(true)
    expect(noHealthReading(false, 3)).toBe(false)
    expect(noHealthReading(true, 0)).toBe(false)
  })
})

describe('noUsageWindow', () => {
  const at = (
    range: '7d' | '30d' | '90d' | 'all',
    o: { filtered?: boolean; stripEmpty?: boolean; leading?: boolean },
  ) => noUsageWindow({ filtered: false, stripEmpty: false, leading: false, ...o, range })
  const full = (filtered: boolean) => at('90d', { filtered, leading: true })
  const short = (filtered: boolean) => at('90d', { filtered })

  it('the short form is the full sentence leading clause, verbatim', () => {
    for (const filtered of [false, true]) {
      expect(full(filtered).startsWith(`${short(filtered)} in this window — `)).toBe(true)
    }
  })

  it('a filter that matched nothing is a different gap from nothing ingested', () => {
    expect(full(true)).not.toBe(full(false))
    expect(short(true)).not.toBe(short(false))
  })

  it('an empty strip leaves every unfiltered chart surface the short form', () => {
    for (const leading of [false, true]) {
      expect(at('30d', { stripEmpty: true, leading })).toBe(NO_USAGE_CELL)
    }
  })

  it('a filtered window keeps the match pair even under an empty strip', () => {
    expect(at('7d', { filtered: true, stripEmpty: true, leading: true })).toBe(full(true))
    expect(at('7d', { filtered: true, stripEmpty: true })).toBe(short(true))
  })

  it('"widen the range" is named only where a wider range exists', () => {
    expect(at('90d', { leading: true })).toContain('widen the range')
    expect(at('all', { leading: true })).not.toContain('widen')
    expect(at('all', { filtered: true, leading: true })).not.toContain('widen')
  })
})

describe('stripCoversRange', () => {
  it('speaks for 7 d and 30 d charts, not for 90 d or all (they reach past its window)', () => {
    expect(stripCoversRange('7d')).toBe(true)
    expect(stripCoversRange('30d')).toBe(true)
    expect(stripCoversRange('90d')).toBe(false)
    expect(stripCoversRange('all')).toBe(false)
  })
})

describe('isFiltered', () => {
  it('an empty selection is no constraint', () => {
    expect(isFiltered(undefined, undefined)).toBe(false)
    expect(isFiltered([], [])).toBe(false)
    expect(isFiltered(['iu'], undefined)).toBe(true)
    expect(isFiltered(undefined, ['x'])).toBe(true)
  })
})
