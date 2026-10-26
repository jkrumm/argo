import { describe, expect, it } from 'bun:test'
import { keyTotals, seriesLabel } from './over-time-model'

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
