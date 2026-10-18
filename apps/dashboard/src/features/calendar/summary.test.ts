import { describe, expect, test } from 'bun:test'
import type { CalendarEventPayload } from '../../lib/queries/calendar'
import { agendaDay, agendaSummary, type CalendarItem } from './derive'
import { feedGap } from './query-state'
import { EMPTY_WINDOW, countdown, summaryParts, todayCardState, untilLabel } from './summary'
import { FEED_LABEL } from './labels'

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

describe('summaryParts empty window', () => {
  test('the headline carries the full sentence once; its leading clause is the short form', () => {
    const { sentence, facts } = summaryParts(agendaSummary([], now), null, EMPTY_WINDOW)
    expect(sentence).toBe(EMPTY_WINDOW.sentence)
    expect(sentence.startsWith(EMPTY_WINDOW.short)).toBe(true)
    expect(
      sentence.match(new RegExp(`${FEED_LABEL.personal} or ${FEED_LABEL.work}`, 'g')),
    ).toHaveLength(1)
    expect(facts).toEqual([])
  })
  test('a meeting beyond the window keeps its countdown fact', () => {
    const far = [ev('far', '2026-10-23 10:00:00', '2026-10-23 11:00:00')]
    const summary = agendaSummary(far, now)
    expect(summary.next).not.toBeNull()
    expect(summaryParts(summary, null, EMPTY_WINDOW).facts).toEqual([countdown(summary)])
  })
  test('an unanswered calendar is still the gap, never the empty window', () => {
    const loading = { state: 'loading' as const, text: 'Loading calendar', card: 'Loading' }
    expect(
      summaryParts(agendaSummary([], now, new Set(['work'])), loading, EMPTY_WINDOW).sentence,
    ).toBe('Loading calendar')
  })
})

describe('summaryParts', () => {
  test('a busy day: the headline carries the count and booked time, the facts the countdown and week', () => {
    const summary = agendaSummary(events, now)
    const { sentence, facts } = summaryParts(summary)
    expect(sentence).toBe('3 events today, 2\u00a0h\u00a040\u00a0min booked')
    expect(facts).toEqual(['next in 20\u00a0min', '2\u00a0h\u00a040\u00a0min booked this week'])
  })
  test("an empty day says so; the free time is the free-block cell's, not repeated", () => {
    const summary = agendaSummary([], now)
    expect(summaryParts(summary)).toEqual({
      sentence: 'No events today',
      facts: ['nothing booked this week'],
    })
  })
  test('an all-day-only today states its count and no booked time', () => {
    const allDay: CalendarItem = { ...ev('d', D, D), payload: { source: 'm365', isAllDay: true } }
    expect(summaryParts(agendaSummary([allDay], now)).sentence).toBe('1 event today')
  })
  test('a lone meeting reads singular', () => {
    const summary = agendaSummary([events[1] as CalendarItem], now)
    expect(summaryParts(summary).sentence).toStartWith('1 event today, 40\u00a0min booked')
  })
  test('says why, never "No events", while a calendar has not answered', () => {
    const summary = agendaSummary([], now, new Set(['work']))
    const loading = feedGap(new Set(['work']), new Set())
    expect(summaryParts(summary, loading)).toEqual({ sentence: 'Loading calendar', facts: [] })
    const failed = feedGap(new Set(['work']), new Set(['work']))
    expect(summaryParts(summary, failed)).toEqual({
      sentence: `${FEED_LABEL.work} failed to load`,
      facts: [],
    })
  })
  test('a value never parts from its unit', () => {
    const long = [ev('l', `${D} 12:00:00`, `${D} 23:05:00`)]
    const { sentence, facts } = summaryParts(agendaSummary(long, now))
    for (const text of [sentence, ...facts]) expect(text).not.toMatch(/\d+ (?:h|min)\b/)
    expect(sentence).toContain('11\u00a0h\u00a05\u00a0min')
  })
})

describe('untilLabel', () => {
  test('one wording for the pill and the summary', () => {
    expect(untilLabel(20)).toBe('in 20\u00a0min')
    expect(untilLabel(90)).toBe('in 1\u00a0h\u00a030\u00a0min')
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
  test('an all-day-only day (count > 0, no timed rows) still shows the card', () => {
    const day = agendaDay([{ ...ev('d', D, D), payload: { source: 'm365', isAllDay: true } }], D)
    expect(day.rows).toHaveLength(0)
    expect(todayCardState(day.count, false)).toBe('rows')
  })
  test('empty and complete hides the card', () => {
    expect(todayCardState(0, false)).toBe('hidden')
  })
  test('empty but incomplete keeps the card as unknown, never "no events"', () => {
    expect(todayCardState(0, true)).toBe('unknown')
  })
})
