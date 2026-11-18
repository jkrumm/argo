import type { ExerciseKey, MetricKey } from './constants'

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

export type { ExerciseKey, MetricKey }
