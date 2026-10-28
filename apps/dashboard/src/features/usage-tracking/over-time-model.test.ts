import { describe, expect, it } from 'bun:test'
import { keyTotals, seriesLabel } from './over-time-model'

describe('seriesLabel', () => {
  it('names the API fold Other and an unset project in words', () => {
    expect(seriesLabel('sub_tool', 'other')).toBe('Other')
    expect(seriesLabel('project', '(unset)')).toBe('(no project)')
    expect(seriesLabel('model_norm', 'deepseek-v4.1-flash')).toBe('deepseek-v4.1-flash')
  })

  it('reads a model-less row as Unknown model, not the API’s parenthesised key', () => {
    expect(seriesLabel('model_norm', '(unset)')).toBe('Unknown model')
    expect(seriesLabel('model_norm', '(unknown model)')).toBe('Unknown model')
    expect(seriesLabel('project', '(unknown model)')).toBe('(unknown model)')
  })

  it('names a payer key by its wallet', () => {
    expect(seriesLabel('payer', 'me2-sub')).toBe('Me2 Max')
    expect(seriesLabel('payer', 'iu-sub')).toBe('IU Max')
    expect(seriesLabel('payer', 'other')).toBe('Other')
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
