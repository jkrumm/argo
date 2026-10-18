import { describe, expect, test } from 'bun:test'
import { defineFormat, relativeTime } from 'basalt-ui/format'
import {
  APP_LOCALE,
  formatAgo,
  formatAgoWhole,
  formatDuration,
  formatMinutes,
  formatRelative,
  glue,
  glueIdentifiers,
  withUnit,
} from './format'

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
    expect(formatDuration(5 * 60 * min + 12 * min)).toBe('5\u00a0h\u00a012\u00a0min')
    expect(formatDuration(21 * 1440 * min)).toBe('21\u00a0d')
    expect(formatDuration((21 * 1440 + 4 * 60) * min)).toBe('21\u00a0d\u00a04\u00a0h')
    expect(formatDuration(0)).toBe('0\u00a0min')
    expect(formatDuration(30_000)).toBe('<\u00a01\u00a0min')
    expect(formatDuration(59_999)).toBe('<\u00a01\u00a0min')
    expect(formatMinutes(90)).toBe('1\u00a0h\u00a030\u00a0min')
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

describe('formatAgoWhole', () => {
  test('glues ago to the duration; the rest reads as formatAgo', () => {
    expect(formatAgoWhole(5 * 60 * min + 12 * min)).toBe('5\u00a0h\u00a012\u00a0min\u00a0ago')
    expect(formatAgoWhole(3 * min)).toBe('3\u00a0min\u00a0ago')
    expect(formatAgoWhole(30_000)).toBe('just now')
    expect(formatAgoWhole(-1)).toBe('—')
    expect(formatAgoWhole(Number.NaN)).toBe('—')
  })
})

describe('formatRelative', () => {
  test('a no-break gap glues ago to the duration', () => {
    expect(
      formatRelative('2026-01-01T11:00:00Z', Date.parse('2026-01-01T12:00:00Z'), '\u00a0'),
    ).toBe('1\u00a0h\u00a0ago')
  })
  const now = Date.parse('2026-01-01T12:00:00Z')
  test('past, future and unreadable', () => {
    expect(formatRelative('2026-01-01T11:00:00Z', now)).toBe('1\u00a0h ago')
    expect(formatRelative('2026-01-01T14:00:00Z', now)).toBe('in 2\u00a0h')
    expect(formatRelative('nope', now)).toBe('—')
  })
})

describe('glue', () => {
  test('binds every space in the phrase', () => {
    expect(glue('town glow +1 mag')).toBe('town\u00a0glow\u00a0+1\u00a0mag')
    expect(glue('one')).toBe('one')
  })
})

describe('glueIdentifiers', () => {
  test('forbids a break inside an identifier but keeps spaces breakable', () => {
    expect(glueIdentifiers('Merge repo/feat-x now')).toBe('Merge repo/\u2060feat-\u2060x now')
  })
  test('leaves plain words and edge punctuation alone', () => {
    expect(glueIdentifiers('Retry item? - ok')).toBe('Retry item? - ok')
    expect(glueIdentifiers('path/')).toBe('path/')
  })
})
