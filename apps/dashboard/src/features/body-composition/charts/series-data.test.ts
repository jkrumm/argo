import { describe, expect, test } from 'bun:test'
import {
  compareByDate,
  localDay,
  markerRadiusFor,
  thirtyDayMean,
  toSkinfoldChartPoints,
  toWeightChartPoints,
} from './series-data'

describe('localDay', () => {
  test('parses as the local calendar day', () => {
    const d = localDay('2026-03-08')
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 2, 8, 0])
  })
})

describe('toWeightChartPoints', () => {
  test('sorts and averages within ±3 days', () => {
    const pts = toWeightChartPoints([
      { date: '2026-01-05', weightKg: 80 },
      { date: '2026-01-01', weightKg: 82 },
      { date: '2026-01-20', weightKg: 79 },
    ])
    expect(pts.map((p) => p.weightKg)).toEqual([82, 80, 79])
    expect(pts[0]!.ma).toBe(82)
    expect(pts[2]!.ma).toBe(79)
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
