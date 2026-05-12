import { queryOptions } from '@tanstack/react-query'
import { api, unwrap } from '../eden'

export type WindowParams = {
  window?: '7d' | '30d' | '90d' | 'all'
  from?: string
  to?: string
}

export const dailyMetricsQueries = {
  all: () => ['daily-metrics'] as const,
  summary: (params: WindowParams) =>
    queryOptions({
      queryKey: [...dailyMetricsQueries.all(), 'summary', params] as const,
      queryFn: async () => unwrap(await api['daily-metrics'].summary.get({ query: params })),
    }),
  series: (params: WindowParams) =>
    queryOptions({
      queryKey: [...dailyMetricsQueries.all(), 'series', params] as const,
      queryFn: async () => unwrap(await api['daily-metrics'].series.get({ query: params })),
    }),
  recovery: (params: WindowParams) =>
    queryOptions({
      queryKey: [...dailyMetricsQueries.all(), 'recovery', params] as const,
      queryFn: async () => unwrap(await api['daily-metrics'].recovery.get({ query: params })),
    }),
  recoverySeries: (params: WindowParams) =>
    queryOptions({
      queryKey: [...dailyMetricsQueries.all(), 'recovery', 'series', params] as const,
      queryFn: async () =>
        unwrap(await api['daily-metrics'].recovery.series.get({ query: params })),
    }),
  fitnessDirection: (params: WindowParams) =>
    queryOptions({
      queryKey: [...dailyMetricsQueries.all(), 'fitness-direction', params] as const,
      queryFn: async () =>
        unwrap(await api['daily-metrics']['fitness-direction'].get({ query: params })),
    }),
  trainingLoad: (params: WindowParams) =>
    queryOptions({
      queryKey: [...dailyMetricsQueries.all(), 'training-load', params] as const,
      queryFn: async () =>
        unwrap(await api['daily-metrics']['training-load'].get({ query: params })),
    }),
  syncStatus: () =>
    queryOptions({
      queryKey: [...dailyMetricsQueries.all(), 'sync-status'] as const,
      queryFn: async () => unwrap(await api['daily-metrics']['sync-status'].get()),
    }),
}

export const activitiesQueries = {
  all: () => ['activities'] as const,
  list: (params: { date_from?: string; date_to?: string; limit?: number; page?: number }) =>
    queryOptions({
      queryKey: [...activitiesQueries.all(), 'list', params] as const,
      queryFn: async () => unwrap(await api.activities.get({ query: params })),
    }),
}

export async function triggerSyncRefresh() {
  return unwrap(await api['daily-metrics'].refresh.post())
}
