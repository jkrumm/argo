import { queryOptions } from '@tanstack/react-query'
import { api, unwrap } from '../eden'

/**
 * Window/range params accepted by every strength summary endpoint.
 * Matches the API's `WindowQuerySchema`.
 */
export type StrengthWindowParams = {
  window?: '7d' | '30d' | '90d' | 'all'
  from?: string
  to?: string
}

export type StrengthQueryParams = StrengthWindowParams & {
  /** Comma-separated exercise IDs (default: bench_press,deadlift,squat,pull_ups). */
  exercises?: string
}

export type StrengthRecordsParams = StrengthQueryParams & {
  metric?: 'all' | 'max_weight' | 'estimated_1rm' | 'total_volume' | 'total_reps' | 'work_sets'
}

export type StrengthCompositeParams = StrengthWindowParams & { exercise_id: string }

export type StrengthAlignmentParams = { exercises?: string }
export type StrengthDeloadParams = { exercises?: string }

export const strengthQueries = {
  all: () => ['strength'] as const,

  heroes: (params: StrengthQueryParams) =>
    queryOptions({
      queryKey: [...strengthQueries.all(), 'heroes', params] as const,
      queryFn: async () => unwrap(await api.workouts.summary.heroes.get({ query: params })),
    }),

  seriesDetailed: (params: StrengthQueryParams) =>
    queryOptions({
      queryKey: [...strengthQueries.all(), 'series-detailed', params] as const,
      queryFn: async () =>
        unwrap(await api.workouts.summary['series-detailed'].get({ query: params })),
    }),

  weeklyVolume: (params: StrengthQueryParams) =>
    queryOptions({
      queryKey: [...strengthQueries.all(), 'weekly-volume', params] as const,
      queryFn: async () =>
        unwrap(await api.workouts.summary['weekly-volume'].get({ query: params })),
    }),

  trainingLoad: (params: StrengthQueryParams) =>
    queryOptions({
      queryKey: [...strengthQueries.all(), 'training-load', params] as const,
      queryFn: async () =>
        unwrap(await api.workouts.summary['training-load'].get({ query: params })),
    }),

  records: (params: StrengthRecordsParams) =>
    queryOptions({
      queryKey: [...strengthQueries.all(), 'records', params] as const,
      queryFn: async () => unwrap(await api.workouts.summary.records.get({ query: params })),
    }),

  composite: (params: StrengthCompositeParams) =>
    queryOptions({
      queryKey: [...strengthQueries.all(), 'composite', params] as const,
      queryFn: async () => {
        const { exercise_id, ...query } = params
        return unwrap(await api.workouts.summary.composite({ exercise_id }).get({ query }))
      },
    }),

  relativeProgression: (params: StrengthQueryParams) =>
    queryOptions({
      queryKey: [...strengthQueries.all(), 'relative-progression', params] as const,
      queryFn: async () =>
        unwrap(await api.workouts.summary['relative-progression'].get({ query: params })),
    }),

  sparklines: (params: StrengthQueryParams) =>
    queryOptions({
      queryKey: [...strengthQueries.all(), 'sparklines', params] as const,
      queryFn: async () => unwrap(await api.workouts.summary.sparklines.get({ query: params })),
    }),

  readiness: (params: StrengthWindowParams) =>
    queryOptions({
      queryKey: [...strengthQueries.all(), 'readiness', params] as const,
      queryFn: async () => unwrap(await api.workouts.summary.readiness.get({ query: params })),
    }),

  alignment: (params: StrengthAlignmentParams) =>
    queryOptions({
      queryKey: [...strengthQueries.all(), 'alignment', params] as const,
      queryFn: async () => unwrap(await api.workouts.summary.alignment.get({ query: params })),
    }),

  deloadSignal: (params: StrengthDeloadParams) =>
    queryOptions({
      queryKey: [...strengthQueries.all(), 'deload-signal', params] as const,
      queryFn: async () =>
        unwrap(await api.workouts.summary['deload-signal'].get({ query: params })),
    }),
}
