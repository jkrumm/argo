import { queryOptions } from '@tanstack/react-query'
import { api, unwrap } from '../eden'

export type WalkingPadWindowParams = {
  window?: '7d' | '30d' | '90d' | 'all'
  from?: string
  to?: string
}

export type WalkingPadSeriesParams = WalkingPadWindowParams & {
  bucket?: 'day' | 'week'
}

export type WalkingPadListParams = {
  page?: number
  limit?: number
  order?: 'asc' | 'desc'
}

export type WalkingPadAchievementParams = {
  since?: string
  limit?: number
}

export const walkingPadQueries = {
  all: () => ['walking-pad'] as const,

  summary: (params: WalkingPadWindowParams) =>
    queryOptions({
      queryKey: [...walkingPadQueries.all(), 'summary', params] as const,
      queryFn: async () => unwrap(await api['walking-pad'].sessions.summary.get({ query: params })),
    }),

  series: (params: WalkingPadSeriesParams) =>
    queryOptions({
      queryKey: [...walkingPadQueries.all(), 'series', params] as const,
      queryFn: async () => unwrap(await api['walking-pad'].sessions.series.get({ query: params })),
    }),

  hourOfDay: (params: WalkingPadWindowParams) =>
    queryOptions({
      queryKey: [...walkingPadQueries.all(), 'hour-of-day', params] as const,
      queryFn: async () =>
        unwrap(await api['walking-pad'].sessions['hour-of-day'].get({ query: params })),
    }),

  lengthHistogram: (
    params: WalkingPadWindowParams & { metric?: 'duration' | 'distance' | 'steps' },
  ) =>
    queryOptions({
      queryKey: [...walkingPadQueries.all(), 'length-histogram', params] as const,
      queryFn: async () =>
        unwrap(await api['walking-pad'].sessions['length-histogram'].get({ query: params })),
    }),

  heroes: (params: WalkingPadWindowParams) =>
    queryOptions({
      queryKey: [...walkingPadQueries.all(), 'heroes', params] as const,
      queryFn: async () => unwrap(await api['walking-pad'].sessions.heroes.get({ query: params })),
    }),

  list: (params: WalkingPadListParams) =>
    queryOptions({
      queryKey: [...walkingPadQueries.all(), 'list', params] as const,
      queryFn: async () => unwrap(await api['walking-pad'].sessions.get({ query: params })),
    }),

  // Live snapshot — polled aggressively while the page is visible. Refetch
  // cadence is controlled at the call site (refetchInterval), not here.
  // The API wraps in an envelope ({ snapshot: ... | null }) so the wire is
  // always a non-empty JSON object; we unwrap here so callers get the bare
  // snapshot or null.
  live: () =>
    queryOptions({
      queryKey: [...walkingPadQueries.all(), 'live'] as const,
      queryFn: async () => {
        const envelope = unwrap(await api['walking-pad'].live.get())
        return envelope.snapshot
      },
    }),

  achievements: (params: WalkingPadAchievementParams = {}) =>
    queryOptions({
      queryKey: [...walkingPadQueries.all(), 'achievements', params] as const,
      queryFn: async () => unwrap(await api['walking-pad'].achievements.get({ query: params })),
    }),
}
