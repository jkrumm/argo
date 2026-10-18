import { describe, expect, test } from 'bun:test'
import { defineFormat, relativeTime } from 'basalt-ui/format'
import { APP_LOCALE, formatAgo, formatDuration, withUnit } from './format'

const FOUR_DAYS_AGO = Date.now() - 4 * 86_400_000

describe('relativeTime', () => {
  test('follows the configured app locale, not the runtime one', () => {
    defineFormat({ locale: 'de-DE' })
    const german = relativeTime(FOUR_DAYS_AGO)
    defineFormat({ locale: APP_LOCALE })
    expect(relativeTime(FOUR_DAYS_AGO)).not.toBe(german)
    expect(relativeTime(FOUR_DAYS_AGO)).toMatch(/days ago/)
  })
})

describe('withUnit', () => {
  test('joins value and unit with a no-break space', () => {
    expect(withUnit(28, 'd')).toBe('28 d')
    expect(withUnit('1.2', 'kg/wk')).toBe('1.2 kg/wk')
  })
})

const min = 60_000

describe('formatDuration', () => {
  test('one spelling: min for minutes, a zero tail dropped, units glued', () => {
    expect(formatDuration(42 * min)).toBe('42\u00a0min')
    expect(formatDuration(5 * 60 * min)).toBe('5\u00a0h')
    expect(formatDuration(5 * 60 * min + 12 * min)).toBe('5\u00a0h 12\u00a0min')
    expect(formatDuration(21 * 1440 * min)).toBe('21\u00a0d')
    expect(formatDuration((21 * 1440 + 4 * 60) * min)).toBe('21\u00a0d 4\u00a0h')
    expect(formatDuration(0)).toBe('0\u00a0min')
  })
  test('is a dash for a negative or non-finite value', () => {
    expect(formatDuration(-1)).toBe('—')
    expect(formatDuration(Number.NaN)).toBe('—')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('—')
  })
  test('formatAgo says just now under a minute', () => {
    expect(formatAgo(30_000)).toBe('just now')
    expect(formatAgo(3 * min)).toBe('3\u00a0min ago')
    expect(formatAgo(-1)).toBe('—')
  })
})
