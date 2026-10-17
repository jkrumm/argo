import { describe, expect, test } from 'bun:test'
import type { CalendarEventPayload } from '../../lib/queries/calendar'
import { agendaSummary, longestFreeBlock, type CalendarItem } from './derive'
import { countdown, summarySentence, untilLabel } from './summary'

const D = '2026-10-14'
const ev = (id: string, start: string, end: string): CalendarItem => ({
  id,
  title: `{title ${id}}`,
  start,
  end,
  payload: { source: 'm365', sourceClass: 'work' } satisfies CalendarEventPayload,
})
const now = new Date(2026, 9, 14, 11, 0, 0)
const events = [
  ev('a', `${D} 09:00:00`, `${D} 10:00:00`),
  ev('b', `${D} 11:20:00`, `${D} 12:00:00`),
  ev('c', `${D} 15:00:00`, `${D} 16:00:00`),
]

describe('summarySentence', () => {
  test('a busy day carries the count, booked time, the countdown and the week total', () => {
    const summary = agendaSummary(events, now)
    const sentence = summarySentence(summary, longestFreeBlock(events, D, now))
    expect(sentence).toBe(
      '3 meetings today, 2h\u00a040m booked · next in 20m · 2h\u00a040m booked this week',
    )
    // at least three live numbers plus the countdown
    expect(sentence.match(/\d+/g)?.length).toBeGreaterThanOrEqual(4)
  })
  test('an empty day states the free time instead', () => {
    const summary = agendaSummary([], now)
    expect(summarySentence(summary, longestFreeBlock([], D, now))).toBe(
      'No events today · 7h free · nothing booked this week',
    )
  })
  test('a lone meeting reads singular', () => {
    const summary = agendaSummary([events[1] as CalendarItem], now)
    expect(summarySentence(summary, null)).toStartWith('1 meeting today, 40m booked')
  })
})

describe('summarySentence — unknown sources', () => {
  test('dashes, never "No events", while a calendar has not answered', () => {
    const summary = agendaSummary([], now, new Set(['work']))
    expect(summarySentence(summary, null)).toBe('— meetings today · next — · — booked this week')
  })
})

describe('durations in the sentence', () => {
  test('never break between hours and minutes', () => {
    const long = [ev('l', `${D} 12:00:00`, `${D} 23:05:00`)]
    const sentence = summarySentence(agendaSummary(long, now), null)
    expect(sentence).toContain('11h\u00a05m')
    expect(sentence).not.toMatch(/\d+h \d+m/)
  })
})

describe('untilLabel', () => {
  test('one wording for the pill and the summary', () => {
    expect(untilLabel(20)).toBe('in 20m')
    expect(untilLabel(90)).toBe('in 1h 30m')
    const within = agendaSummary([ev('x', `${D} 12:30:00`, `${D} 13:00:00`)], now)
    expect(countdown(within)).toBe(`next ${untilLabel(90)}`)
  })
})

describe('countdown', () => {
  test('later today, tomorrow and later in the week', () => {
    const later = agendaSummary([events[2] as CalendarItem], now)
    expect(countdown(later)).toBe('next at 15:00')
    const tomorrow = agendaSummary([ev('t', '2026-10-15 09:30:00', '2026-10-15 10:00:00')], now)
    expect(countdown(tomorrow)).toBe('next tomorrow 09:30')
    const monday = agendaSummary([ev('m', '2026-10-19 10:45:00', '2026-10-19 11:00:00')], now)
    expect(countdown(monday)).toBe('next Mon 10:45')
  })
  test('nothing ahead is no clause', () => {
    expect(countdown(agendaSummary([], now))).toBeNull()
  })
})
