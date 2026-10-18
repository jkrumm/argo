import { describe, expect, it } from 'bun:test'
import {
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
  fmtSecondsDay,
  errorDayState,
  fmtPct,
  fmtShare,
  fmtTokens,
  fmtUsdWhole,
  foldTopN,
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
    expect(fmtTokens(2_340_000_000)).toBe('2.3B')
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
    expect(summarySentence({ cost30d: 1234, cost7d: 300 })).toBe(
      '$1,234 spent in 30 days, $300 in the last 7 days',
    )
    expect(
      summaryFacts({
        tokens30d: 2_340_000_000,
        errorRate30d: 0.004,
        sources: 7,
        lastEvent: '3 minutes ago',
      }),
    ).toEqual(['2.3B tokens', '0.4% errors', '7 sources active', 'last event 3 minutes ago'])
    expect(
      summaryFacts({ tokens30d: null, errorRate30d: null, sources: null, lastEvent: null }),
    ).toEqual(['— tokens', '— errors', 'no events recorded'])
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
    expect(priorNote(120, null, pctDelta)).toBe('no comparable prior 30 d')
    expect(priorNote(120, 100, pctDelta)).toBeNull()
    expect(priorNote(120, 0, pctDelta)).toBe('prior 30 d had no base to compare')
    const calls = 100
    expect(errorComparison({ current: 0.02, prior: undefined, calls }).note).toBe(
      'prior unavailable',
    )
    expect(errorComparison({ current: 0.02, prior: null, calls }).note).toBe(
      'no comparable prior 30 d',
    )
    expect(errorComparison({ current: 0.02, prior: 0.012, calls })).toEqual({
      value: expect.closeTo(0.8),
      note: 'vs 1.2% prior 30 d',
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
    expect(fmtTokensDay(3_200_000)).toBe('3.2M tokens')
    expect(fmtTokensDay(950)).toBe('950 tokens')
    expect(fmtSecondsDay(1800)).toBe('1.8 s')
    expect(fmtSecondsDay(Number.NaN)).toBe('—')
  })

  it('badge magnitudes keep one decimal so a small change is not a red 0%', () => {
    expect(fmtPctBadge(-0.4)).toBe('0.4%')
  })
})

describe('error days, peak and source note', () => {
  it('words warn and bad days with counts', () => {
    expect(errorDaysLine([0, 0.02, 0.05, null, 0.011])).toBe(
      '2 warn days (1%–3%), 1 bad day (> 3%)',
    )
    expect(errorDaysLine([0.02, null])).toBe('1 warn day (1%–3%)')
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
      'The six largest billing lanes in the window are named, the rest are grouped as Other.',
    )
  })
  it('states what the source percentage is of', () => {
    expect(topSourceNote('api', 30, 100)).toBe('30% from api')
    expect(topSourceNote('api', 0, 0)).toBe('api')
  })
})
