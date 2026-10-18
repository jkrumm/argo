import { formatMinutes } from '../../lib/format'
/** The Agenda's summary sentence — pure, so its wording is tested on synthetic events. */
import { SOURCES_LABEL, type FeedGap } from './query-state'
import { addDays, displayTitle, keyToDate, type AgendaSummary } from './derive'

const weekdayShort = (key: string) =>
  keyToDate(key).toLocaleDateString('en-GB', { weekday: 'short' })

/** The one countdown wording, shared by the summary and the agenda pill: `in 20 min`, `in 1 h 30 min`. */
export const untilLabel = (minutes: number): string => `in ${formatMinutes(minutes)}`

/** `next in 20m` inside two hours, else when and what: `next at 15:00 — {title}`, `next tomorrow 09:30 — {title}`. */
export function countdown(summary: AgendaSummary): string | null {
  const next = summary.next
  if (!next) return null
  if (next.inMin < 120) return `next ${untilLabel(next.inMin)}`
  const start = String(next.event.start)
  const startKey = start.slice(0, 10)
  const time = start.slice(11, 16)
  const title = displayTitle(next.event)
  if (startKey === summary.todayKey) return `next at ${time} — ${title}`
  if (startKey === addDays(summary.todayKey, 1)) return `next tomorrow ${time} — ${title}`
  return `next ${weekdayShort(startKey)} ${time} — ${title}`
}

/** The short form of the empty-window gap: the full sentence's leading clause, verbatim. */
export const EMPTY_WINDOW_SHORT = 'No events'
/** The full sentence, on the leading surface only: what is missing, and why. */
export const EMPTY_WINDOW_SENTENCE = `${EMPTY_WINDOW_SHORT} — nothing is booked in ${SOURCES_LABEL} this week or the next 7 days`

/**
 * The page opening, built from the same derivation as the lists and the strip beside it: the
 * headline answers "what is today", the facts carry the countdown and the week. The free time
 * left is the free-block cell's, not repeated here.
 */
export function summaryParts(
  summary: AgendaSummary,
  gap: FeedGap | null = null,
  emptyWindow = false,
): { sentence: string; facts: string[] } {
  // A calendar that has not answered makes every figure unknown: it says why, never "No events".
  if (
    summary.todayCount === null ||
    summary.todayBookedMin === null ||
    summary.weekBookedMin === null
  ) {
    return { sentence: gap?.text ?? 'Loading calendar', facts: [] }
  }
  // Nothing in the past week or the next 7 days is one gap: the headline carries its full sentence
  // (what is missing, why), every other surface the short form `No events` (`EMPTY_WINDOW_SHORT`).
  if (emptyWindow) return { sentence: EMPTY_WINDOW_SENTENCE, facts: [] }
  const sentence =
    summary.todayCount > 0
      ? `${summary.todayCount} ${summary.todayCount === 1 ? 'meeting' : 'meetings'} today, ${formatMinutes(summary.todayBookedMin)} booked`
      : 'No events today'
  const week =
    summary.weekBookedMin === 0
      ? 'nothing booked this week'
      : `${formatMinutes(summary.weekBookedMin)} booked this week`
  return {
    sentence: sentence,
    facts: [countdown(summary), week].filter((f): f is string => f !== null),
  }
}

/**
 * What the Today card shows. Confirmed-empty hides it (the headline says so); an unanswered
 * calendar keeps it as unknown, because absence of rows is then not absence of events.
 */
export function todayCardState(
  rowCount: number,
  incomplete: boolean,
): 'rows' | 'unknown' | 'hidden' {
  if (rowCount > 0) return 'rows'
  return incomplete ? 'unknown' : 'hidden'
}
