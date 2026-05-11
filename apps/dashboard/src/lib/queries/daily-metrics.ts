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
      queryFn: async () => {
        const result = await api['daily-metrics'].summary.get({ query: params })
        return unwrap(result)
      },
    }),
  series: (params: WindowParams) =>
    queryOptions({
      queryKey: [...dailyMetricsQueries.all(), 'series', params] as const,
      queryFn: async () => {
        const result = await api['daily-metrics'].series.get({ query: params })
        return unwrap(result)
      },
    }),
}
