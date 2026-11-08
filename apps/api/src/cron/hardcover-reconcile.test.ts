import { describe, expect, test } from 'bun:test'
import { shouldSetStartDate } from './hardcover-reconcile.js'

describe('shouldSetStartDate', () => {
  test('sets it when the book is not on the shelf or only wants-to-read', () => {
    expect(shouldSetStartDate(0)).toBe(true)
    expect(shouldSetStartDate(1)).toBe(true)
  })

  test('keeps the real start date once reading or read', () => {
    expect(shouldSetStartDate(2)).toBe(false)
    expect(shouldSetStartDate(3)).toBe(false)
  })
})
