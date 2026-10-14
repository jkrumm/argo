import { describe, expect, test } from 'bun:test'
import { trailingMA } from './trailing-ma'

describe('trailingMA', () => {
  test('is null until min values are present', () => {
    expect(trailingMA([1, 2, 3, 4], 3)).toEqual([null, null, 2, 3])
  })
  test('skips nulls and NaN inside the window', () => {
    expect(trailingMA([1, null, 3, Number.NaN, 5], 5)).toEqual([null, null, null, null, 3])
  })
  test('window slides', () => {
    expect(trailingMA([3, 3, 3, 9], 3)).toEqual([null, null, 3, 5])
  })
})
