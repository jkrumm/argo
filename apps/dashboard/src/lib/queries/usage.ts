import { queryOptions } from '@tanstack/react-query'
import { api } from '../eden'
import type { PayerValue } from '../../features/usage-tracking/accounts'
import { unwrap } from 'basalt-ui'

export type Range = '7d' | '30d' | '90d' | 'all'
export type Grain = 'day' | 'week'
export type Metric =
  | 'cost'
  | 'tokens'
  | 'tokens_input'
  | 'tokens_output'
  | 'tokens_cache_read'
  | 'tokens_cache_write'
  | 'errors'
  | 'error_rate'
  | 'latency_p95'
  | 'cache_ratio'
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
  /** Additive metrics only: keep the N largest keys, fold the rest into a trailing `other` key. */
  top?: number | undefined
}

/** The API ranks flow by dollars (`cost`) or by every token class (`tokens`). */
export type FlowLens = 'cost' | 'tokens'
export type FlowParams = {
  range: Range
  lens: FlowLens
  payer?: PayerFilter[] | undefined
  workspace?: WorkspaceValue[] | undefined
  /** Default 200 (the API maximum): the client slices the ranked list and derives section C from all rows. */
  top?: number | undefined
}
export type MoversWindow = '7d' | '14d' | '30d'
export type MoversParams = {
  window: MoversWindow
  limit: number
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

const fetchIuBudget = async () => unwrap(await api.usage['iu-budget'].get())
const fetchIuReconcile = async (days: number) =>
  unwrap(await api.usage['iu-reconcile'].get({ query: { days } }))
const fetchFlow = async (query: {
  range: Range
  lens: FlowLens
  top: number
  payer: PayerFilter[] | undefined
  workspace: WorkspaceValue[] | undefined
}) => unwrap(await api.usage.flow.get({ query }))
const fetchQuotaLatest = async (query: { account: string[] | undefined }) =>
  unwrap(await api.usage['quota-latest'].get({ query }))
const fetchMovers = async (query: {
  days: number
  limit: number
  payer: PayerFilter[] | undefined
}) => unwrap(await api.usage.movers.get({ query }))

export type IuBudget = Awaited<ReturnType<typeof fetchIuBudget>>
export type IuReconcile = Awaited<ReturnType<typeof fetchIuReconcile>>
export type IuReconcileDay = IuReconcile['days'][number]
export type FlowResponse = Awaited<ReturnType<typeof fetchFlow>>
export type FlowRow = FlowResponse['rows'][number]
export type QuotaLatestResponse = Awaited<ReturnType<typeof fetchQuotaLatest>>
export type QuotaLatest = QuotaLatestResponse['accounts'][number]
export type MoversResponse = Awaited<ReturnType<typeof fetchMovers>>
export type MoverRow = MoversResponse['rows'][number]

/** An empty selection is no constraint, and `movers` would read `[]` as "no payer" instead of its default. */
const payersOrUndefined = (payer: PayerFilter[] | undefined) =>
  payer && payer.length > 0 ? payer : undefined

export const usageQueries = {
  all: () => ['usage'] as const,
  iuBudget: () =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'iu-budget'] as const,
      queryFn: fetchIuBudget,
    }),
  iuReconcile: (days: number) =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'iu-reconcile', days] as const,
      queryFn: () => fetchIuReconcile(days),
    }),
  flow: (params: FlowParams) =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'flow', params] as const,
      queryFn: () =>
        fetchFlow({
          range: params.range,
          lens: params.lens,
          top: params.top ?? 200,
          payer: payersOrUndefined(params.payer),
          workspace: params.workspace,
        }),
    }),
  movers: (params: MoversParams) =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'movers', params] as const,
      queryFn: () =>
        fetchMovers({
          days: Number.parseInt(params.window, 10),
          limit: params.limit,
          payer: payersOrUndefined(params.payer),
        }),
    }),
  timeseries: (params: TimeseriesParams) =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'timeseries', params] as const,
      queryFn: async () => unwrap(await api.usage.timeseries.get({ query: params })),
    }),
  quotaLatest: (account?: string[]) =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'quota-latest', account] as const,
      queryFn: () => fetchQuotaLatest({ account }),
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
