import { afterEach, describe, expect, it } from 'bun:test'
import { NBSP } from '../../lib/format'
import {
  noDataInWindow,
  noUsageWindow,
  rangeWindowDays,
  isFiltered,
  shortDay,
  errorBandInfo,
  reliabilitySources,
  SESSIONS_SOURCE,
  fmtSeconds,
  errorDayState,
  fmtPct,
  fmtShare,
  fmtTokens,
  fmtUsdWhole,
  dropPartialBucket,
  periodNoun,
  secondsQuantity,
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

describe('error days', () => {
  it('bands a daily rate at 1 % and 3 %', () => {
    expect(errorDayState(0.005)).toBe('ok')
    expect(errorDayState(0.01)).toBe('warn')
    expect(errorDayState(0.03)).toBe('warn')
    expect(errorDayState(0.031)).toBe('bad')
    expect(errorDayState(null)).toBe('none')
  })
})

describe('readout formatters', () => {
  it('every readout carries its unit', () => {
    expect(fmtUsdWhole(12.4)).toBe('$12')
    expect(fmtSeconds(1800)).toBe('1.8\u00a0s')
    expect(fmtSeconds(Number.NaN)).toBe('—')
  })
})

describe('shortDay', () => {
  it('keeps the date whole across a line break', () => {
    expect(shortDay(new Date(2026, 9, 3))).toBe(`3${NBSP}Oct`)
  })
})

describe('reliability scope', () => {
  it('words the info from the band thresholds', () => {
    expect(errorBandInfo()).toContain('under 1\u00a0% is fine')
  })

  const windowSources = ['claude-code', SESSIONS_SOURCE, 'opencode']

  it('calls leaves the sessions feed out, by naming the rest', () => {
    expect(reliabilitySources('calls', windowSources)).toEqual(['claude-code', 'opencode'])
  })
  it('sessions names the feed alone, and nothing when the window has none', () => {
    expect(reliabilitySources('sessions', windowSources)).toEqual([SESSIONS_SOURCE])
    expect(reliabilitySources('sessions', ['claude-code'])).toEqual([])
  })
  it('all sends no constraint', () => {
    expect(reliabilitySources('all', windowSources)).toBeUndefined()
  })
  it('calls with only the feed in the window has nothing to show', () => {
    expect(reliabilitySources('calls', [SESSIONS_SOURCE])).toEqual([])
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
      expect(at('30d', { stripEmpty: true, leading })).toBe('No usage ingested')
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

describe('noDataInWindow', () => {
  it('names the gap and the way out, and widens only where a wider range exists', () => {
    expect(noDataInWindow('usage', '30d')).toBe(
      'No usage in this window — clear a filter or widen the range',
    )
    expect(noDataInWindow('usage', 'all')).toBe('No usage in this window — clear a filter')
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

describe('rangeWindowDays', () => {
  // Buckets are the UTC midnight of a date's local fields, so `now` is read from local fields too.
  const noon = new Date(2026, 0, 10, 12)
  const NOW = Date.UTC(noon.getFullYear(), noon.getMonth(), noon.getDate(), 12)
  const days = [
    { date: new Date(2025, 10, 20), value: 1 },
    { date: new Date(2025, 11, 20), value: 2 },
    { date: new Date(2026, 0, 8), value: 3 },
  ]
  const cut = (range: '7d' | '30d' | '90d' | 'all', grain: 'day' | 'week') =>
    rangeWindowDays(days, { range, grain, now: NOW }).map((d) => d.value)

  it('cuts day grain to the range span and passes week grain and all through', () => {
    expect(cut('7d', 'day')).toEqual([3])
    expect(cut('30d', 'day')).toEqual([2, 3])
    expect(cut('90d', 'day')).toEqual([1, 2, 3])
    expect(cut('7d', 'week')).toEqual([1, 2, 3])
    expect(cut('all', 'day')).toEqual([1, 2, 3])
  })
  it('leaves nothing when the only days fall before the window', () => {
    const lone = [{ date: new Date(2025, 11, 5), value: 1 }]
    expect(rangeWindowDays(lone, { range: '30d', grain: 'day', now: NOW })).toEqual([])
  })
})
