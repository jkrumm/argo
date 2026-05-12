import { EXERCISES, type ExerciseKey, type MetricKey } from './constants'

/**
 * Window/range parameters every strength endpoint accepts.
 * Matches the API's `WindowQuerySchema`.
 */
export type SummaryParams =
  | { window: '7d' | '30d' | '90d' | 'all'; from?: undefined; to?: undefined }
  | { window?: undefined; from: string; to: string }

/**
 * Most strength endpoints also accept a comma-separated `exercises` filter.
 */
export type SummaryParamsWithExercises = SummaryParams & { exercises?: string }

export type ExerciseFilterState = ReadonlyArray<ExerciseKey>

export function exerciseLabel(id: string): string {
  return EXERCISES.find((e) => e.value === id)?.label ?? id
}

export function metricUnit(metric: string): string {
  return (
    (
      {
        estimated_1rm: 'kg',
        max_weight: 'kg',
        total_volume: 'kg',
        total_reps: 'reps',
        work_sets: 'sets',
        avg_intensity: '%',
      } as Record<string, string>
    )[metric] ?? ''
  )
}

export type { ExerciseKey, MetricKey }
