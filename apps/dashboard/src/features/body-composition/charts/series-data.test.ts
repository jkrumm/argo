import { describe, expect, test } from 'bun:test'
import {
  axisDateFormat,
  compareByDate,
  localDay,
  markerRadiusFor,
  thirtyDayMean,
  toSkinfoldChartPoints,
  toWeightChartPoints,
  trailingMean,
} from './series-data'

describe('localDay', () => {
  test('parses as the local calendar day', () => {
    const d = localDay('2026-03-08')
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 2, 8, 0])
  })
})

describe('toWeightChartPoints', () => {
  test('sorts; the mean is null where the 7 days are under-covered', () => {
    const pts = toWeightChartPoints(
      [
        { date: '2026-01-05', weightKg: 80 },
        { date: '2026-01-01', weightKg: 82 },
        { date: '2026-01-20', weightKg: 79 },
      ],
      null,
    )
    expect(pts.map((p) => p.weightKg)).toEqual([82, 80, 79])
    // Each entry alone, or four days of cover, is under 70 % of 7 days (4.9 d).
    expect(pts.map((p) => p.ma)).toEqual([null, null, null])
  })
  test('a covered window gives the trailing mean, the same as trailingMean', () => {
    const log = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      weightKg: 80 + i,
    }))
    const pts = toWeightChartPoints(log, null)
    expect(pts.slice(0, 5).map((p) => p.ma)).toEqual([null, null, null, null, null])
    expect(pts[5]!.ma).toBe(trailingMean(log, '2026-01-06', 7, null)!)
    expect(pts[9]!.ma).toBe(84.5 + 1)
  })
  test('a window shorter than 7 days has no line', () => {
    const log = [{ date: '2026-01-10', weightKg: 80 }]
    expect(toWeightChartPoints(log, 3)[0]!.ma).toBeNull()
  })
})

describe('thirtyDayMean', () => {
  test('null when empty, windowed otherwise', () => {
    expect(thirtyDayMean([])).toBeNull()
    expect(
      thirtyDayMean([
        { date: '2026-01-01', weightKg: 100 },
        { date: '2026-02-20', weightKg: 80 },
        { date: '2026-03-01', weightKg: 82 },
      ]),
    ).toBe(81)
  })
})

describe('thirtyDayMean boundary', () => {
  test('day 30 is in the window, day 31 is out', () => {
    const latest = { date: '2026-03-31', weightKg: 80 }
    expect(thirtyDayMean([{ date: '2026-03-01', weightKg: 90 }, latest])).toBe(85)
    expect(thirtyDayMean([{ date: '2026-02-28', weightKg: 90 }, latest])).toBe(80)
  })
})

describe('helpers', () => {
  test('compareByDate orders ascending', () => {
    expect([{ date: '2026-02-01' }, { date: '2026-01-01' }].toSorted(compareByDate)[0]!.date).toBe(
      '2026-01-01',
    )
  })
  test('markerRadiusFor shrinks with density', () => {
    expect([10, 21, 61].map(markerRadiusFor)).toEqual([4.5, 3.5, 2.5])
  })
})

describe('toSkinfoldChartPoints', () => {
  test('keeps a missing site absent, not zero', () => {
    const [p] = toSkinfoldChartPoints([
      { date: '2026-01-01', average: 20, readings: [{ site: 'abdominal', valueMm: 20 }] },
    ])
    expect(p!.bySite).toEqual({ abdominal: 20 })
    expect(p!.bySite.suprailiac).toBeUndefined()
  })
})

describe('axisDateFormat', () => {
  const at = (key: string) => localDay(key)
  test('a plotted range inside a year reads day and month', () => {
    expect(axisDateFormat([at('2026-01-05'), at('2026-10-07')])(at('2026-10-07'))).toBe('7 Oct')
  })
  test('a range of a year or more names the year', () => {
    expect(axisDateFormat([at('2025-10-07'), at('2026-10-07')])(at('2026-10-07'))).toBe('Oct 2026')
  })
  test('no points fall back to day and month', () => {
    expect(axisDateFormat([])(at('2026-10-07'))).toBe('7 Oct')
  })
})
