import { describe, expect, test } from 'bun:test'
import type { ChartSeries } from 'basalt-ui/charts'
import { pctDomain, type RelPoint } from './relative-progression-data'

const series = (key: string): ChartSeries<RelPoint> => ({
  key,
  label: key,
  color: 'x',
  getValue: (d) => d.pct[key] ?? null,
})
const row = (pct: Record<string, number | null>): RelPoint => ({ day: new Date(2026, 0, 1), pct })

describe('pctDomain', () => {
  test('empty falls back to ±20', () => {
    expect(pctDomain([], [series('a')])).toEqual([-20, 20])
  })
  test('a flat window keeps a 10-point span with 0 inside', () => {
    expect(pctDomain([row({ a: 2 })], [series('a')])).toEqual([0, 10])
  })
  test('fits the data: asymmetric when the data is, padded 15%', () => {
    const [lo, hi] = pctDomain([row({ a: 30, b: -2 })], [series('a'), series('b')])
    expect(hi).toBeCloseTo(34.5, 9)
    expect(lo).toBeCloseTo(-2.3, 9)
  })
  test('is symmetric when the data is', () => {
    const [lo, hi] = pctDomain([row({ a: 20, b: -20 })], [series('a'), series('b')])
    expect(lo).toBe(-hi)
  })
  test('ignores hidden series', () => {
    expect(pctDomain([row({ a: 5, b: -30 })], [series('a')])).toEqual([0, 10])
  })
})
