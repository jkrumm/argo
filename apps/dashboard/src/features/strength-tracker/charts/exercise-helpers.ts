import { SERIES } from '../../../lib/series'
import { DEFAULT_EXERCISES, EXERCISE_COLORS } from '../constants'

/** A lift's series colour; unknown ids fall back to the bench anchor. */
export function exerciseColor(exId: string): string {
  return EXERCISE_COLORS[exId as keyof typeof EXERCISE_COLORS] ?? SERIES.benchPress
}

/** The `exercises` query param (comma list) as ids; absent means every default lift. */
export function parseExercises(exercises: string | undefined): string[] {
  if (!exercises) return [...DEFAULT_EXERCISES]
  return exercises
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}
