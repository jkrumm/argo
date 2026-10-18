import { describe, expect, test } from 'bun:test'
import type { CalendarEventPayload } from '../../lib/queries/calendar'
import { agendaSummary, type CalendarItem } from './derive'
import { countdown, summaryParts, todayCardState, untilLabel } from './summary'

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

describe('summaryParts', () => {
  test('a busy day: the headline carries the count and booked time, the facts the countdown and week', () => {
    const summary = agendaSummary(events, now)
    const { sentence, facts } = summaryParts(summary)
    expect(sentence).toBe('3 meetings today, 2h\u00a040m booked')
    expect(facts).toEqual(['next in 20m', '2h\u00a040m booked this week'])
  })
  test("an empty day says so; the free time is the free-block cell's, not repeated", () => {
    const summary = agendaSummary([], now)
    expect(summaryParts(summary)).toEqual({
      sentence: 'No events today',
      facts: ['nothing booked this week'],
    })
  })
  test('a lone meeting reads singular', () => {
    const summary = agendaSummary([events[1] as CalendarItem], now)
    expect(summaryParts(summary).sentence).toStartWith('1 meeting today, 40m booked')
  })
  test('dashes, never "No events", while a calendar has not answered', () => {
    const summary = agendaSummary([], now, new Set(['work']))
    expect(summaryParts(summary)).toEqual({
      sentence: '— meetings today',
      facts: ['next —', '— booked this week'],
    })
  })
  test('durations never break between hours and minutes', () => {
    const long = [ev('l', `${D} 12:00:00`, `${D} 23:05:00`)]
    const { sentence, facts } = summaryParts(agendaSummary(long, now))
    for (const text of [sentence, ...facts]) expect(text).not.toMatch(/\d+h \d+m/)
    expect(sentence).toContain('11h\u00a05m')
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
    expect(countdown(later)).toBe('next at 15:00 — {title c}')
    const tomorrow = agendaSummary([ev('t', '2026-10-15 09:30:00', '2026-10-15 10:00:00')], now)
    expect(countdown(tomorrow)).toBe('next tomorrow 09:30 — {title t}')
    const monday = agendaSummary([ev('m', '2026-10-19 10:45:00', '2026-10-19 11:00:00')], now)
    expect(countdown(monday)).toBe('next Mon 10:45 — {title m}')
  })
  test('nothing ahead is no clause', () => {
    expect(countdown(agendaSummary([], now))).toBeNull()
  })
})

describe('todayCardState', () => {
  test('rows show whatever the completeness', () => {
    expect(todayCardState(2, false)).toBe('rows')
    expect(todayCardState(1, true)).toBe('rows')
  })
  test('empty and complete hides the card', () => {
    expect(todayCardState(0, false)).toBe('hidden')
  })
  test('empty but incomplete keeps the card as unknown, never "no events"', () => {
    expect(todayCardState(0, true)).toBe('unknown')
  })
})
