import { describe, expect, test } from 'bun:test'
import { APP_LOCALE, pinLocale } from './format'

function spy() {
  const calls: unknown[] = []
  const pinned = pinLocale((_value, options) => {
    calls.push(options)
    return ''
  })
  return { calls, pinned }
}

describe('pinLocale', () => {
  test('passes the app locale, which basalt does not take from the provider', () => {
    const { calls, pinned } = spy()
    pinned(0, { now: 1 })
    pinned(0)
    expect(calls).toEqual([{ now: 1, locale: APP_LOCALE }, { locale: APP_LOCALE }])
  })

  test('an explicit locale wins, an undefined one does not unpin', () => {
    const { calls, pinned } = spy()
    pinned(0, { locale: 'de' })
    pinned(0, { locale: undefined })
    expect(calls).toEqual([{ locale: 'de' }, { locale: APP_LOCALE }])
  })
})
