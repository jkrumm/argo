import { afterEach, describe, expect, it } from 'bun:test'
import { NBSP } from '../../lib/format'
import {
  noDataInWindow,
  shortDay,
  fmtShare,
  fmtTokens,
  fmtUsdWhole,
  dropPartialBucket,
  periodNoun,
  tokensQuantity,
  tokensFormatterFor,
} from './model'

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

describe('token units', () => {
  it('scales tokens to B / M / k and keeps the unit apart', () => {
    expect(tokensQuantity(2_340_000_000)).toEqual({ value: '2.3', unit: 'B' })
    expect(tokensQuantity(5_600_000)).toEqual({ value: '5.6', unit: 'M' })
    expect(fmtTokens(2_340_000_000)).toBe('2.3\u00a0B')
    expect(fmtTokens(null)).toBe('—')
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

describe('shortDay', () => {
  it('keeps the date whole across a line break', () => {
    expect(shortDay(new Date(2026, 9, 3))).toBe(`3${NBSP}Oct`)
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

describe('periodNoun', () => {
  it('names every range explicitly, units glued', () => {
    expect(periodNoun('7d')).toBe('7\u00a0d')
    expect(periodNoun('90d')).toBe('90\u00a0d')
    expect(periodNoun('all')).toBe('all time')
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

describe('noDataInWindow', () => {
  it('names the gap and the way out, and widens only where a wider range exists', () => {
    expect(noDataInWindow('usage', '30d')).toBe(
      'No usage in this window — clear a filter or widen the range',
    )
    expect(noDataInWindow('usage', 'all')).toBe('No usage in this window — clear a filter')
  })
})
