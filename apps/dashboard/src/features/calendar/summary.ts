/** The Agenda's summary sentence — pure, so its wording is tested on synthetic events. */
import { formatDurationMin } from '../../components/upstream/schedule-row-model'
import { addDays, displayTitle, keyToDate, type AgendaSummary, type FreeBlock } from './derive'

const weekdayShort = (key: string) =>
  keyToDate(key).toLocaleDateString('en-GB', { weekday: 'short' })

/** The one countdown wording, shared by the summary and the agenda pill: `in 20m`, `in 1h 30m`. */
export const untilLabel = (minutes: number): string => `in ${formatDurationMin(minutes)}`

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

/** `11h 5m` must not break between its parts at a narrow width. */
const keepTogether = (text: string) => text.replace(/(\d+h) (\d+m)/g, '$1\u00a0$2')

/**
 * The page opening, built from the same derivation as the lists and the strip beside it: the
 * headline answers "what is today", the facts carry the countdown and the week.
 */
export function summaryParts(
  summary: AgendaSummary,
  free: FreeBlock | null,
): { sentence: string; facts: string[] } {
  // A calendar that has not answered makes every figure unknown: dashes, never "No events".
  if (
    summary.todayCount === null ||
    summary.todayBookedMin === null ||
    summary.weekBookedMin === null
  ) {
    return { sentence: '— meetings today', facts: ['next —', '— booked this week'] }
  }
  const sentence =
    summary.todayCount > 0
      ? `${summary.todayCount} ${summary.todayCount === 1 ? 'meeting' : 'meetings'} today, ${formatDurationMin(summary.todayBookedMin)} booked`
      : `No events today${free ? ` · ${formatDurationMin(free.minutes)} free` : ''}`
  const week =
    summary.weekBookedMin === 0
      ? 'nothing booked this week'
      : `${formatDurationMin(summary.weekBookedMin)} booked this week`
  return {
    sentence: keepTogether(sentence),
    facts: [countdown(summary), week].filter((f): f is string => f !== null).map(keepTogether),
  }
}
