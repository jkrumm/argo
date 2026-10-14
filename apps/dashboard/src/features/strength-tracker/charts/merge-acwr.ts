import { localDay } from '../../garmin-health/charts/local-day'
import type { AcwrZone } from '../formulas'

export type ExercisePoint = {
  acute: number
  chronic: number
  acwr: number | null
  zone: AcwrZone | null
}

export type ExerciseSeries = {
  exercise_id: string
  exercise_name: string
  points: ({ date: string } & ExercisePoint)[]
}

export type MergedPoint = {
  day: Date
  per: Record<string, ExercisePoint>
}

/** Joins every exercise's weekly ACWR points on their date, ascending. */
export function mergePoints(series: readonly ExerciseSeries[]): MergedPoint[] {
  const byDate = new Map<string, MergedPoint>()
  for (const s of series) {
    for (const { date, ...point } of s.points) {
      let row = byDate.get(date)
      if (!row) {
        row = { day: localDay(date), per: {} }
        byDate.set(date, row)
      }
      row.per[s.exercise_id] = point
    }
  }
  return [...byDate.entries()]
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, row]) => row)
}
