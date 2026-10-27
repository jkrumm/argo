/**
 * Pure derivations for the two heatmaps: the Overview's "When" (rows = wallets, normalized to each
 * row's own peak, because the wallets differ ~25× in dollars) and the wallet tab's weekday × hour
 * rhythm. No React, no queries.
 */
import { format } from 'date-fns'
import type { RhythmResponse } from '../../lib/queries/usage'
import { dayToDate } from './constants'

export type WhenCell = {
  row: string
  col: string
  /** The real figure of the bucket, in the measure. */
  actual: number
  /** `actual` over the row's own peak: 0–1, 0 for an all-zero row. */
  scaled: number
}

type Buckets = ReadonlyArray<{ bucket: string; groups: Record<string, number | null> }>

/**
 * One cell per (row, bucket), each scaled to its row's own peak so a quiet wallet still reads when
 * it was used. A key missing from a bucket is 0.
 */
export function whenCells(buckets: Buckets, rows: readonly string[]): WhenCell[] {
  return rows.flatMap((row) => {
    const peak = buckets.reduce((max, b) => Math.max(max, b.groups[row] ?? 0), 0)
    return buckets.map((b) => {
      const actual = b.groups[row] ?? 0
      return { row, col: b.bucket, actual, scaled: peak > 0 ? actual / peak : 0 }
    })
  })
}

/** An hour bucket (`2026-10-21T14:00:00Z`, a UTC instant) as local `Wed 21 · 14:00`. */
export const hourColLabel = (bucket: string): string => format(new Date(bucket), 'EEE d · HH:mm')

/** A day bucket (`2026-10-21`) as `Wed 21 Oct`. */
export const dayColLabel = (bucket: string): string => format(dayToDate(bucket), 'EEE d MMM')

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
