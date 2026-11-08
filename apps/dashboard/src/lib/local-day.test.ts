import { describe, expect, it } from 'bun:test'
import { localDayKey } from './local-day'

describe('localDayKey', () => {
  it('uses the local calendar day, not the UTC one', () => {
    // Constructed from local parts, so the assertion holds in any runner timezone.
    expect(localDayKey(new Date(2026, 6, 11, 0, 30))).toBe('2026-07-11')
    expect(localDayKey(new Date(2026, 6, 10, 23, 59))).toBe('2026-07-10')
  })
  it('accepts epoch milliseconds', () => {
    expect(localDayKey(new Date(2026, 0, 5, 12).getTime())).toBe('2026-01-05')
  })
  it('pads month and day', () => {
    expect(localDayKey(new Date(2026, 2, 4, 9))).toBe('2026-03-04')
  })
  it('defaults to now', () => {
    expect(localDayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
