import { queryOptions } from '@tanstack/react-query'
import { api } from '../eden'
import type { PayerValue } from '../../features/usage-tracking/accounts'
import { unwrap } from 'basalt-ui'

export type Range = '7d' | '30d' | '90d' | 'all'
export type Grain = 'hour' | 'day' | 'week'
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

export type SplitBy = 'project' | 'sub_tool' | 'model_norm'
export type SplitParams = {
  by: SplitBy
  range: Range
  lens: FlowLens
  payer?: PayerFilter[] | undefined
  workspace?: WorkspaceValue[] | undefined
  /** 2–50, the API default is 12: the rest folds into a trailing `other` row. */
  top?: number | undefined
}
export type RhythmParams = {
  range: Range
  metric: 'cost' | 'tokens' | 'tokens_cache_read'
  /** IANA zone the weekday × hour cells are read in: the browser's. */
  tz: string
  payer?: PayerFilter[] | undefined
  workspace?: WorkspaceValue[] | undefined
}

const fetchSplit = async (query: SplitParams & { top: number }) =>
  unwrap(await api.usage.split.get({ query }))
const fetchRhythm = async (query: RhythmParams) => unwrap(await api.usage.rhythm.get({ query }))
const fetchQuota = async (query: { hours: number; account: string[] | undefined }) =>
  unwrap(await api.usage.quota.get({ query }))
const fetchQuotaLatest = async (query: { account: string[] | undefined }) =>
  unwrap(await api.usage['quota-latest'].get({ query }))

export type IuBudget = Awaited<ReturnType<typeof fetchIuBudget>>
export type IuReconcile = Awaited<ReturnType<typeof fetchIuReconcile>>
export type FlowResponse = Awaited<ReturnType<typeof fetchFlow>>
export type FlowRow = FlowResponse['rows'][number]
export type SplitResponse = Awaited<ReturnType<typeof fetchSplit>>
export type SplitRow = SplitResponse['rows'][number]
export type SplitTotal = SplitResponse['totals'][number]
export type RhythmResponse = Awaited<ReturnType<typeof fetchRhythm>>
export type QuotaResponse = Awaited<ReturnType<typeof fetchQuota>>
export type QuotaLatestResponse = Awaited<ReturnType<typeof fetchQuotaLatest>>
export type QuotaLatest = QuotaLatestResponse['accounts'][number]

/** An empty selection is no constraint: send no filter rather than `[]`. */
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
  timeseries: (params: TimeseriesParams) =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'timeseries', params] as const,
      queryFn: async () => unwrap(await api.usage.timeseries.get({ query: params })),
    }),
  split: (params: SplitParams) =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'split', params] as const,
      queryFn: () =>
        fetchSplit({ ...params, top: params.top ?? 12, payer: payersOrUndefined(params.payer) }),
    }),
  rhythm: (params: RhythmParams) =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'rhythm', params] as const,
      queryFn: () => fetchRhythm({ ...params, payer: payersOrUndefined(params.payer) }),
    }),
  quota: (hours: number, account?: string[]) =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'quota', hours, account] as const,
      queryFn: () => fetchQuota({ hours, account }),
    }),
  quotaLatest: (account?: string[]) =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'quota-latest', account] as const,
      queryFn: () => fetchQuotaLatest({ account }),
    }),
}
