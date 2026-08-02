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

export type StrengthCompositeParams = StrengthWindowParams & { exerciseId: string }

export type StrengthAlignmentParams = { exercises?: string }
export type StrengthDeloadParams = { exercises?: string }

// The strength page is the one surface genuinely used from two devices in the
// same session, so it opts out of the app-wide `refetchOnWindowFocus: false` /
// 60s staleTime — those are right for a single-device dashboard and wrong here:
// a session logged on the phone would sit invisible on the laptop until a manual
// reload. The draft sync pulls a workout in the moment its shared draft
// disappears; this covers the rest — an edit, a delete, or a session logged
// while this tab was closed. Focus, not a poll: the trigger for "is this still
// current" is picking the device back up.
const CROSS_DEVICE = { staleTime: 30_000, refetchOnWindowFocus: true } as const

export const strengthQueries = {
  all: () => ['strength'] as const,

  heroes: (params: StrengthQueryParams) =>
    queryOptions({
      ...CROSS_DEVICE,
      queryKey: [...strengthQueries.all(), 'heroes', params] as const,
      queryFn: async () => unwrap(await api.workouts.summary.heroes.get({ query: params })),
    }),

  seriesDetailed: (params: StrengthQueryParams) =>
    queryOptions({
      ...CROSS_DEVICE,
      queryKey: [...strengthQueries.all(), 'series-detailed', params] as const,
      queryFn: async () =>
        unwrap(await api.workouts.summary['series-detailed'].get({ query: params })),
    }),

  weeklyVolume: (params: StrengthQueryParams) =>
    queryOptions({
      ...CROSS_DEVICE,
      queryKey: [...strengthQueries.all(), 'weekly-volume', params] as const,
      queryFn: async () =>
        unwrap(await api.workouts.summary['weekly-volume'].get({ query: params })),
    }),

  trainingLoad: (params: StrengthQueryParams) =>
    queryOptions({
      ...CROSS_DEVICE,
      queryKey: [...strengthQueries.all(), 'training-load', params] as const,
      queryFn: async () =>
        unwrap(await api.workouts.summary['training-load'].get({ query: params })),
    }),

  records: (params: StrengthRecordsParams) =>
    queryOptions({
      ...CROSS_DEVICE,
      queryKey: [...strengthQueries.all(), 'records', params] as const,
      queryFn: async () => unwrap(await api.workouts.summary.records.get({ query: params })),
    }),

  composite: (params: StrengthCompositeParams) =>
    queryOptions({
      ...CROSS_DEVICE,
      queryKey: [...strengthQueries.all(), 'composite', params] as const,
      queryFn: async () => {
        const { exerciseId, ...query } = params
        return unwrap(await api.workouts.summary.composite({ exerciseId }).get({ query }))
      },
    }),

  relativeProgression: (params: StrengthQueryParams) =>
    queryOptions({
      ...CROSS_DEVICE,
      queryKey: [...strengthQueries.all(), 'relative-progression', params] as const,
      queryFn: async () =>
        unwrap(await api.workouts.summary['relative-progression'].get({ query: params })),
    }),

  sparklines: (params: StrengthQueryParams) =>
    queryOptions({
      ...CROSS_DEVICE,
      queryKey: [...strengthQueries.all(), 'sparklines', params] as const,
      queryFn: async () => unwrap(await api.workouts.summary.sparklines.get({ query: params })),
    }),

  readiness: (params: StrengthWindowParams) =>
    queryOptions({
      ...CROSS_DEVICE,
      queryKey: [...strengthQueries.all(), 'readiness', params] as const,
      queryFn: async () => unwrap(await api.workouts.summary.readiness.get({ query: params })),
    }),

  alignment: (params: StrengthAlignmentParams) =>
    queryOptions({
      ...CROSS_DEVICE,
      queryKey: [...strengthQueries.all(), 'alignment', params] as const,
      queryFn: async () => unwrap(await api.workouts.summary.alignment.get({ query: params })),
    }),

  deloadSignal: (params: StrengthDeloadParams) =>
    queryOptions({
      ...CROSS_DEVICE,
      queryKey: [...strengthQueries.all(), 'deload-signal', params] as const,
      queryFn: async () =>
        unwrap(await api.workouts.summary['deload-signal'].get({ query: params })),
    }),
}
