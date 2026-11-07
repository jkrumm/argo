import { queryOptions } from '@tanstack/react-query'
import { api } from '../eden'
import type { IuKeyId, PayerValue } from '../../features/usage-tracking/accounts'
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
  /** Normalized project names (the keys of `/usage/split?by=project`). */
  project?: string[] | undefined
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

const fetchIuBudget = async (iuKey: IuKeyId) =>
  unwrap(await api.usage['iu-budget'].get({ query: { iuKey } }))
const fetchIuReconcile = async (days: number, iuKey: IuKeyId) =>
  unwrap(await api.usage['iu-reconcile'].get({ query: { days, iuKey } }))
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
  /** Normalized project names: a model split of one project row. */
  project?: string[] | undefined
  /** Exact tool names (the keys of `by=sub_tool`): a model split of one tool row. */
  subTool?: string[] | undefined
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

const fetchAccountPicks = async (query: { hours: number }) =>
  unwrap(await api.usage['account-picks'].get({ query }))
const fetchPicksSummary = async (query: { hours: number; groupBy: 'picked' | 'reason' }) =>
  unwrap(await api.usage['account-picks'].summary.get({ query }))
const fetchRoutingWindows = async (query: { hours: number }) =>
  unwrap(await api.usage.routing.windows.get({ query }))

export type DemandBy = 'workflow' | 'step' | 'model' | 'origin' | 'caller' | 'repo'
export type DemandParams = {
  range: Range
  by: DemandBy
  /** Keep only rows of this agw workflow (for `by=step` / `by=model` under one workflow). */
  workflow?: string | undefined
  payer?: PayerFilter[] | undefined
  /** 2–200; the API default is 25 and folds the rest into a trailing `(other)` row. */
  top?: number | undefined
}
export type LaneSplitParams = {
  range: Range
  lens: FlowLens
  payer?: PayerFilter[] | undefined
  top?: number | undefined
}

export type InsightsPeriod = '7d' | '30d' | '90d'
const fetchInsights = async (query: { period: InsightsPeriod }) =>
  unwrap(await api.usage.insights.get({ query }))

const fetchPace = async () => unwrap(await api.usage.pace.get())
const fetchRouter = async (query: { range: Range }) => unwrap(await api.usage.router.get({ query }))
const fetchDemand = async (query: DemandParams & { top: number }) =>
  unwrap(await api.usage.demand.get({ query }))
// The lane split lives beside `SplitBy` rather than in it: v6's ranked lists key a record on every `SplitBy`.
const fetchLaneSplit = async (query: LaneSplitParams & { top: number }) =>
  unwrap(await api.usage.split.get({ query: { ...query, by: 'lane' } }))

export type InsightsResponse = Awaited<ReturnType<typeof fetchInsights>>
export type Insight = InsightsResponse['items'][number]
export type PaceResponse = Awaited<ReturnType<typeof fetchPace>>
export type PacePool = PaceResponse['pools'][number]
export type RouterResponse = Awaited<ReturnType<typeof fetchRouter>>
export type DemandResponse = Awaited<ReturnType<typeof fetchDemand>>
export type DemandRow = DemandResponse['rows'][number]
export type LaneSplitResponse = Awaited<ReturnType<typeof fetchLaneSplit>>

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
export type AccountPicksResponse = Awaited<ReturnType<typeof fetchAccountPicks>>
export type AccountPick = AccountPicksResponse['picks'][number]
export type PicksSummaryResponse = Awaited<ReturnType<typeof fetchPicksSummary>>
export type RoutingWindowsResponse = Awaited<ReturnType<typeof fetchRoutingWindows>>
export type RoutingWindow = RoutingWindowsResponse['windows'][number]
export type RoutingWindowSummary = RoutingWindowsResponse['summary'][number]

/** An empty selection is no constraint: send no filter rather than `[]`. */
const payersOrUndefined = (payer: PayerFilter[] | undefined) =>
  payer && payer.length > 0 ? payer : undefined

export const usageQueries = {
  all: () => ['usage'] as const,
  /** One IU API key's cap (each key has its own). */
  iuBudget: (iuKey: IuKeyId) =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'iu-budget', iuKey] as const,
      queryFn: () => fetchIuBudget(iuKey),
    }),
  iuReconcile: (days: number, iuKey: IuKeyId) =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'iu-reconcile', days, iuKey] as const,
      queryFn: () => fetchIuReconcile(days, iuKey),
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
  accountPicks: (hours: number) =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'account-picks', hours] as const,
      queryFn: () => fetchAccountPicks({ hours }),
    }),
  picksSummary: (hours: number, groupBy: 'picked' | 'reason') =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'picks-summary', hours, groupBy] as const,
      queryFn: () => fetchPicksSummary({ hours, groupBy }),
    }),
  routingWindows: (hours: number) =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'routing-windows', hours] as const,
      queryFn: () => fetchRoutingWindows({ hours }),
    }),
  /** The verdict band and the pool nodes: state now, no range. */
  pace: () =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'pace'] as const,
      queryFn: fetchPace,
    }),
  /** The strip under the verdict: ranked observations by rules over a rolling period. */
  insights: (period: InsightsPeriod) =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'insights', period] as const,
      queryFn: () => fetchInsights({ period }),
      refetchInterval: 5 * 60_000,
    }),
  router: (range: Range) =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'router', range] as const,
      queryFn: () => fetchRouter({ range }),
    }),
  demand: (params: DemandParams) =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'demand', params] as const,
      queryFn: () =>
        fetchDemand({
          ...params,
          top: params.top ?? 25,
          payer: payersOrUndefined(params.payer),
        }),
    }),
  laneSplit: (params: LaneSplitParams) =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'split-lane', params] as const,
      queryFn: () =>
        fetchLaneSplit({
          ...params,
          top: params.top ?? 12,
          payer: payersOrUndefined(params.payer),
        }),
    }),
  quotaLatest: (account?: string[]) =>
    queryOptions({
      queryKey: [...usageQueries.all(), 'quota-latest', account] as const,
      queryFn: () => fetchQuotaLatest({ account }),
    }),
}
