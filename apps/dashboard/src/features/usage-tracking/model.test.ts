import { describe, expect, it } from 'bun:test'
import {
  badDayCount,
  billingParts,
  deltaPctText,
  deltaPointsText,
  deltaSecondsText,
  errorDayState,
  fmtPct,
  fmtShare,
  fmtTokens,
  fmtUsdWhole,
  foldTopN,
  footerLine,
  isStale,
  OTHER_KEY,
  pctChange,
  secondsQuantity,
  summarySentence,
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
    expect(deltaPctText(120, 100)).toBe('+20%')
    expect(deltaPctText(80, 100)).toBe('−20%')
    expect(deltaPctText(100, 0)).toBeNull()
    expect(deltaPctText(100, null)).toBeNull()
  })
  it('signs second and point deltas', () => {
    expect(deltaSecondsText(4300, 4000)).toBe('+0.3 s')
    expect(deltaSecondsText(null, 4000)).toBeNull()
    expect(deltaPointsText(0.012, 0.01)).toBe('+0.2 pp')
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
  it('is stale past 30 minutes only', () => {
    expect(isStale('2026-10-17T11:20:00Z', now)).toBe(true)
    expect(isStale('2026-10-17T11:45:00Z', now)).toBe(false)
    expect(isStale(null, now)).toBe(false)
  })
  it('summary and footer repeat the same figures the cells print', () => {
    expect(
      summarySentence({
        cost30d: 1234,
        cost7d: 300,
        tokens30d: 2_340_000_000,
        errorRate30d: 0.004,
        lastEvent: '3 minutes ago',
      }),
    ).toBe(
      '$1,234 over 30 days, $300 in the last 7 days · 2.3B tokens · 0.4% errors in 30 d · last event 3 minutes ago',
    )
    expect(footerLine({ records: 12345, sources: 7, lastEvent: null })).toBe(
      '12,345 records in total · 7 sources active in 30 d · no events recorded',
    )
  })
})
