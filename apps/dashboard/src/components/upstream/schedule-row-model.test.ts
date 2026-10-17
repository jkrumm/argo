import { describe, expect, test } from 'bun:test'
import { formatDurationMin } from './schedule-row-model'

describe('formatDurationMin', () => {
  test('minutes only', () => expect(formatDurationMin(45)).toBe('45m'))
  test('hours and minutes', () => expect(formatDurationMin(90)).toBe('1h 30m'))
  test('whole hours drop the minutes', () => expect(formatDurationMin(120)).toBe('2h'))
  test('zero', () => expect(formatDurationMin(0)).toBe('0m'))
  test('rounds fractional minutes', () => expect(formatDurationMin(29.6)).toBe('30m'))
  test('invalid input is unknown, not zero', () => {
    expect(formatDurationMin(Number.NaN)).toBe('—')
    expect(formatDurationMin(-5)).toBe('—')
  })
})
