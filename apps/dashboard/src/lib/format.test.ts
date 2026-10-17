import { describe, expect, mock, test } from 'bun:test'

const calls: unknown[] = []
mock.module('basalt-ui/format', () => ({
  relativeTime: (_value: unknown, options: unknown) => {
    calls.push(options)
    return ''
  },
}))

const { APP_LOCALE, relativeTime } = await import('./format')

describe('relativeTime', () => {
  test('passes the app locale, which basalt does not take from the provider', () => {
    relativeTime(0, { now: 1 })
    expect(calls.at(-1)).toEqual({ now: 1, locale: APP_LOCALE })
  })

  test('an explicit locale wins, an undefined one does not unpin', () => {
    relativeTime(0, { locale: 'de' })
    expect(calls.at(-1)).toEqual({ locale: 'de' })
    relativeTime(0, { locale: undefined })
    expect(calls.at(-1)).toEqual({ locale: APP_LOCALE })
  })
})
