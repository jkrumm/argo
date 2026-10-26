import { describe, expect, it } from 'bun:test'
import {
  keyTotals,
  peakProcessed,
  processedOf,
  seriesLabel,
  tokenPoints,
  tokenTotals,
} from './over-time-model'

const bucket = (day: string, value: number | null) => ({ bucket: day, groups: { value } })

describe('seriesLabel', () => {
  it('names the API fold Other and a payer in words', () => {
    expect(seriesLabel('sub_tool', 'other')).toBe('Other')
    expect(seriesLabel('payer', 'iu-api')).toBe('IU API')
    expect(seriesLabel('model_norm', 'deepseek-v4.1-flash')).toBe('deepseek-v4.1-flash')
  })
})

describe('keyTotals', () => {
  it('sums each key over the window, a missing value counting as 0', () => {
    const points = [
      { date: new Date(2026, 9, 1), groups: { a: 2, b: null } },
      { date: new Date(2026, 9, 2), groups: { a: 3, b: 4 } },
    ]
    expect(keyTotals(points, ['a', 'b'])).toEqual([
      { key: 'a', value: 5 },
      { key: 'b', value: 4 },
    ])
  })
})

describe('tokenPoints', () => {
  const parts = {
    input: [bucket('2026-10-01', 1), bucket('2026-10-02', 2)],
    output: [bucket('2026-10-01', 3), bucket('2026-10-02', 4)],
    cacheRead: [bucket('2026-10-01', 100), bucket('2026-10-02', 200)],
    cacheWrite: [bucket('2026-10-02', 5)],
  }

  it('merges the four classes per bucket; a class without the bucket reads 0', () => {
    const points = tokenPoints(parts)
    expect(points.map((p) => [p.input, p.output, p.cacheRead, p.cacheWrite])).toEqual([
      [1, 3, 100, 0],
      [2, 4, 200, 5],
    ])
  })

  it('keeps cache-read out of fresh and adds it only to processed', () => {
    const points = tokenPoints(parts)
    expect(tokenTotals(points)).toMatchObject({
      fresh: 1 + 3 + 2 + 4 + 5,
      cacheRead: 300,
      processed: 15 + 300,
    })
    expect(processedOf(points[1]!)).toBe(211)
    expect(peakProcessed(points)).toBe(211)
  })

  it('reads a null value as 0 and sorts buckets by day', () => {
    const points = tokenPoints({
      ...parts,
      input: [bucket('2026-10-02', null), bucket('2026-10-01', 7)],
    })
    expect(points.map((p) => p.input)).toEqual([7, 0])
  })
})
