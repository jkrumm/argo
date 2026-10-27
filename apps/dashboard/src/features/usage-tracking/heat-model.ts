/**
 * Pure derivations for the rhythm charts (hour of day, weekday). No React, no queries.
 */
import type { RhythmResponse } from '../../lib/queries/usage'

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
export const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'))

export type RhythmCell = { day: string; hour: string; value: number }

/** The API's dense 168 cells (dow 0 = Monday) as heatmap rows and columns. */
export const rhythmCells = (cells: RhythmResponse['cells']): RhythmCell[] =>
  cells.map((c) => ({
    day: DAYS[c.dow] ?? String(c.dow),
    hour: HOURS[c.hour] ?? String(c.hour),
    value: c.value,
  }))

export type Slot = { label: string; value: number }

/** Usage per hour of day (00 … 23), every weekday summed. */
export const hourTotals = (cells: readonly RhythmCell[]): Slot[] =>
  HOURS.map((label) => ({
    label,
    value: cells.reduce((sum, c) => (c.hour === label ? sum + c.value : sum), 0),
  }))

/** Usage per weekday (Mon … Sun), every hour summed. */
export const weekdayTotals = (cells: readonly RhythmCell[]): Slot[] =>
  DAYS.map((label) => ({
    label,
    value: cells.reduce((sum, c) => (c.day === label ? sum + c.value : sum), 0),
  }))

/** The busiest slot, or `null` when nothing ran. */
export function busiestSlot(slots: readonly Slot[]): Slot | null {
  const top = slots.reduce<Slot | null>(
    (best, s) => (best === null || s.value > best.value ? s : best),
    null,
  )
  return top === null || top.value <= 0 ? null : top
}
