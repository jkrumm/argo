/** The Agenda's summary sentence — pure, so its wording is tested on synthetic events. */
import { formatDurationMin } from '../../components/upstream/schedule-row-model'
import { addDays, keyToDate, type AgendaSummary, type FreeBlock } from './derive'

const weekdayShort = (key: string) =>
  keyToDate(key).toLocaleDateString('en-GB', { weekday: 'short' })

/** The one countdown wording, shared by the summary and the agenda pill: `in 20m`, `in 1h 30m`. */
export const untilLabel = (minutes: number): string => `in ${formatDurationMin(minutes)}`

/** `next in 20m` inside two hours, else when: `next at 15:00`, `next tomorrow 09:30`, `next Mon 10:45`. */
export function countdown(summary: AgendaSummary): string | null {
  const next = summary.next
  if (!next) return null
  if (next.inMin < 120) return `next ${untilLabel(next.inMin)}`
  const start = String(next.event.start)
  const startKey = start.slice(0, 10)
  const time = start.slice(11, 16)
  if (startKey === summary.todayKey) return `next at ${time}`
  if (startKey === addDays(summary.todayKey, 1)) return `next tomorrow ${time}`
  return `next ${weekdayShort(startKey)} ${time}`
}

/** One sentence, built from the same derivation as the lists and the strip beside it. */
export function summarySentence(summary: AgendaSummary, free: FreeBlock | null): string {
  // A calendar that has not answered makes every figure unknown: dashes, never "No events".
  if (
    summary.todayCount === null ||
    summary.todayBookedMin === null ||
    summary.weekBookedMin === null
  ) {
    return '— meetings today · next — · — this week'
  }
  const today =
    summary.todayCount > 0
      ? `${summary.todayCount} ${summary.todayCount === 1 ? 'meeting' : 'meetings'} today, ${formatDurationMin(summary.todayBookedMin)} booked`
      : `No events today${free ? ` · ${formatDurationMin(free.minutes)} free` : ''}`
  const week =
    summary.weekBookedMin === 0
      ? 'nothing booked this week'
      : `${formatDurationMin(summary.weekBookedMin)} this week`
  return [today, countdown(summary), week].filter(Boolean).join(' · ')
}
