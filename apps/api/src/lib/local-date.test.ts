import { describe, expect, it } from 'bun:test'
import { addDays, daysAgo, isCalendarDate, localDate } from './local-date.js'

describe('localDate', () => {
  it('is already the next day at 23:30 UTC in winter (CET)', () => {
    expect(localDate(new Date('2026-01-10T23:30:00Z'))).toBe('2026-01-11')
  })
  it('rolls over at 22:00 UTC in summer (CEST)', () => {
    expect(localDate(new Date('2026-07-10T21:59:59Z'))).toBe('2026-07-10')
    expect(localDate(new Date('2026-07-10T22:00:00Z'))).toBe('2026-07-11')
  })
  it('rolls over at 23:00 UTC in winter (CET)', () => {
    expect(localDate(new Date('2026-01-10T22:59:59Z'))).toBe('2026-01-10')
    expect(localDate(new Date('2026-01-10T23:00:00Z'))).toBe('2026-01-11')
  })
  it('keeps the UTC date just after midnight UTC only when Berlin agrees', () => {
    expect(localDate(new Date('2026-07-10T00:30:00Z'))).toBe('2026-07-10')
  })
  it('handles the spring-forward day (2026-03-29)', () => {
    expect(localDate(new Date('2026-03-28T23:30:00Z'))).toBe('2026-03-29')
    expect(localDate(new Date('2026-03-29T21:59:00Z'))).toBe('2026-03-29')
    expect(localDate(new Date('2026-03-29T22:00:00Z'))).toBe('2026-03-30')
  })
  it('handles the fall-back day (2026-10-25)', () => {
    expect(localDate(new Date('2026-10-24T22:00:00Z'))).toBe('2026-10-25')
    expect(localDate(new Date('2026-10-25T22:59:00Z'))).toBe('2026-10-25')
    expect(localDate(new Date('2026-10-25T23:00:00Z'))).toBe('2026-10-26')
  })
  it('honours another zone', () => {
    expect(localDate(new Date('2026-07-10T22:00:00Z'), 'UTC')).toBe('2026-07-10')
  })
})

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })
  it('is DST-safe across the switch days', () => {
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30')
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26')
    expect(addDays('2026-10-26', -2)).toBe('2026-10-24')
  })
})

describe('daysAgo', () => {
  it('counts back from the local date', () => {
    expect(daysAgo(6, new Date('2026-07-10T22:30:00Z'))).toBe('2026-07-05')
    expect(daysAgo(0, new Date('2026-07-10T22:30:00Z'))).toBe('2026-07-11')
  })
})

describe('isCalendarDate', () => {
  it('accepts real dates and rejects garbage', () => {
    expect(isCalendarDate('2026-02-28')).toBe(true)
    expect(isCalendarDate('2026-02-31')).toBe(false)
    expect(isCalendarDate('2026-2-3')).toBe(false)
    expect(isCalendarDate('abc')).toBe(false)
  })
})
