import { queryOptions } from '@tanstack/react-query'
import { api } from '../eden'
import type { PayerValue } from '../../features/usage-tracking/accounts'
import { unwrap } from 'basalt-ui'

export type Range = '7d' | '30d' | '90d' | 'all'
export type Grain = 'day' | 'week'
export type Metric = 'cost' | 'tokens' | 'errors' | 'error_rate' | 'latency_p95' | 'cache_ratio'
export type TimeseriesGroupBy =
  | 'source'
  | 'machine'
  | 'model_norm'
  | 'sub_tool'
  | 'project'
  | 'workspace'
  | 'billing'
  | 'account'
  | 'payer'
  | 'outcome'
  | 'none'
export type BreakdownMetric = 'cost' | 'tokens' | 'errors'
export type BreakdownDimension =
  | 'project'
  | 'workspace'
  | 'model_norm'
  | 'billing'
  | 'account'
  | 'payer'
  | 'outcome'
  | 'source'
  | 'machine'
  | 'sub_tool'
type WorkspaceValue = 'work' | 'private'

export type PayerFilter = PayerValue

export type TimeseriesParams = {
  range: Range
  grain: Grain
  metric: Metric
  groupBy: TimeseriesGroupBy
  sources?: string[] | undefined
  machines?: string[] | undefined
  billing?: ('max' | 'iu' | 'openrouter' | 'unknown')[] | undefined
  workspace?: WorkspaceValue[] | undefined
  account?: string[] | undefined
  payer?: PayerFilter[] | undefined
}

export type BreakdownParams = {
  range: Range
  metric: BreakdownMetric
  dimension: BreakdownDimension
  limit?: number
  sources?: string[] | undefined
  machines?: string[] | undefined
  billing?: ('max' | 'iu' | 'openrouter' | 'unknown')[] | undefined
  workspace?: WorkspaceValue[] | undefined
  account?: string[] | undefined
  payer?: PayerFilter[] | undefined
}

export const usageQueries = {
  all: () => ['usage'] as const,
  headline: (payer?: PayerFilter[]) =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'headline', payer] as const,
      queryFn: async () => unwrap(await api.usage.headline.get({ query: { payer } })),
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
  quota: (hours: number, account?: string[]) =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'quota', hours, account] as const,
      queryFn: async () => unwrap(await api.usage.quota.get({ query: { hours, account } })),
    }),
  pickSummary: (hours: number) =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'pick-summary', hours] as const,
      queryFn: async () =>
        unwrap(await api.usage['account-picks'].summary.get({ query: { hours } })),
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
