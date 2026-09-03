import { queryOptions } from '@tanstack/react-query'
import { api } from '../eden'
import { unwrap } from 'basalt-ui'

export type Range = '7d' | '30d' | '90d' | 'all'
export type Grain = 'day' | 'week'
export type Metric = 'cost' | 'tokens' | 'errors' | 'latency_p95' | 'cache_ratio'
export type TimeseriesGroupBy =
  | 'source'
  | 'machine'
  | 'model_norm'
  | 'sub_tool'
  | 'project'
  | 'workspace'
  | 'billing'
  | 'outcome'
  | 'none'
export type BreakdownMetric = 'cost' | 'tokens' | 'errors'
export type BreakdownDimension =
  | 'project'
  | 'workspace'
  | 'model_norm'
  | 'billing'
  | 'outcome'
  | 'source'
  | 'machine'
  | 'sub_tool'
export type WorkspaceValue = 'work' | 'private'

export type TimeseriesParams = {
  range: Range
  grain: Grain
  metric: Metric
  groupBy: TimeseriesGroupBy
  sources?: string[] | undefined
  machines?: string[] | undefined
  billing?: ('max' | 'iu' | 'unknown')[] | undefined
  workspace?: WorkspaceValue[] | undefined
}

export type BreakdownParams = {
  range: Range
  metric: BreakdownMetric
  dimension: BreakdownDimension
  limit?: number
  sources?: string[] | undefined
  machines?: string[] | undefined
  billing?: ('max' | 'iu' | 'unknown')[] | undefined
  workspace?: WorkspaceValue[] | undefined
}

export const usageQueries = {
  all: () => ['usage'] as const,
  headline: () =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'headline'] as const,
      queryFn: async () => unwrap(await api.usage.headline.get()),
    }),
  summary: () =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'summary'] as const,
      queryFn: async () => unwrap(await api.usage.summary.get()),
    }),
  timeseries: (params: TimeseriesParams) =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'timeseries', params] as const,
      queryFn: async () => unwrap(await api.usage.timeseries.get({ query: params })),
    }),
  breakdown: (params: BreakdownParams) =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'breakdown', params] as const,
      queryFn: async () =>
        unwrap(
          await api.usage.breakdown.get({
            query: { ...params, limit: params.limit ?? 10 },
          }),
        ),
    }),
}
