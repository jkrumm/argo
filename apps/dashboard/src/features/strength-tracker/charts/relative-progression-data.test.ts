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
  test('floors at ±10', () => {
    expect(pctDomain([row({ a: 2 })], [series('a')])).toEqual([-10, 10])
  })
  test('is symmetric around the largest absolute value, padded 15%', () => {
    const [lo, hi] = pctDomain([row({ a: 5, b: -30 })], [series('a'), series('b')])
    expect(hi).toBeCloseTo(34.5, 9)
    expect(lo).toBe(-hi)
  })
  test('ignores hidden series', () => {
    expect(pctDomain([row({ a: 5, b: -30 })], [series('a')])).toEqual([-10, 10])
  })
})
