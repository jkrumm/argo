/**
 * Pure derivations for the weekday × hour rhythm heatmap. No React, no queries.
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

/** The busiest weekday-hour, or `null` when nothing ran. */
export function busiestCell(cells: readonly RhythmCell[]): RhythmCell | null {
  const top = cells.reduce<RhythmCell | null>(
    (best, c) => (best === null || c.value > best.value ? c : best),
    null,
  )
  return top === null || top.value <= 0 ? null : top
}
