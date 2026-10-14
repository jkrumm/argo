import { describe, expect, test } from 'bun:test'
import { localDay, thirtyDayMean, toSkinfoldChartPoints, toWeightChartPoints } from './series-data'

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

describe('toSkinfoldChartPoints', () => {
  test('keeps a missing site absent, not zero', () => {
    const [p] = toSkinfoldChartPoints([
      { date: '2026-01-01', average: 20, readings: [{ site: 'abdominal', valueMm: 20 }] },
    ])
    expect(p!.bySite).toEqual({ abdominal: 20 })
    expect(p!.bySite.suprailiac).toBeUndefined()
  })
})
