import { queryOptions } from '@tanstack/react-query'
import { api } from '../eden'
import { unwrap } from 'basalt-ui'

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
  syncStatus: () =>
    queryOptions({
      queryKey: [...dailyMetricsQueries.all(), 'sync-status'] as const,
      queryFn: async () => unwrap(await api['daily-metrics']['sync-status'].get()),
    }),
}

export const recoveryQueries = {
  all: () => ['recovery'] as const,
  summary: (params: WindowParams) =>
    queryOptions({
      queryKey: [...recoveryQueries.all(), 'summary', params] as const,
      queryFn: async () => unwrap(await api.recovery.get({ query: params })),
    }),
  series: (params: WindowParams) =>
    queryOptions({
      queryKey: [...recoveryQueries.all(), 'series', params] as const,
      queryFn: async () => unwrap(await api.recovery.series.get({ query: params })),
    }),
}

export const fitnessDirectionQueries = {
  all: () => ['fitness-direction'] as const,
  summary: (params: WindowParams) =>
    queryOptions({
      queryKey: [...fitnessDirectionQueries.all(), params] as const,
      queryFn: async () => unwrap(await api['fitness-direction'].get({ query: params })),
    }),
}

export const trainingLoadQueries = {
  all: () => ['training-load'] as const,
  summary: (params: WindowParams) =>
    queryOptions({
      queryKey: [...trainingLoadQueries.all(), params] as const,
      queryFn: async () => unwrap(await api['training-load'].get({ query: params })),
    }),
}

export const activitiesQueries = {
  all: () => ['activities'] as const,
  list: (params: {
    dateFrom?: string | undefined
    dateTo?: string | undefined
    limit?: number
    page?: number
  }) =>
    queryOptions({
      queryKey: [...activitiesQueries.all(), 'list', params] as const,
      queryFn: async () => unwrap(await api.activities.get({ query: params })),
    }),
}

export async function triggerSyncRefresh() {
  return unwrap(await api['daily-metrics'].refresh.post())
}
