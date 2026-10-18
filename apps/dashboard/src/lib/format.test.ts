import { describe, expect, test } from 'bun:test'
import { defineFormat, relativeTime } from 'basalt-ui/format'
import { APP_LOCALE, withUnit } from './format'

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
