import { describe, expect, test } from 'bun:test'
import { relativeTime } from './format'

describe('relativeTime', () => {
  test('reads English whatever the system locale', () => {
    const now = Date.UTC(2026, 9, 17)
    expect(relativeTime(now - 4 * 86_400_000, { now })).toBe('4 days ago')
  })
})
