import type { Range, Grain, TimeseriesGroupBy } from '../../lib/queries/usage'

export type CostGroupBy = Extract<TimeseriesGroupBy, 'source' | 'machine' | 'billing'>
export type TokensGroupBy = Extract<
  TimeseriesGroupBy,
  'sub_tool' | 'model_norm' | 'project' | 'source'
>
export type BillingValue = 'max' | 'iu' | 'unknown'

export type UsageSearch = {
  range: Range
  grain: Grain
  sources?: string[]
  machines?: string[]
  billing?: BillingValue[]
  costGroupBy: CostGroupBy
  tokensGroupBy: TokensGroupBy
}
