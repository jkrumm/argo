import type { TimeseriesGroupBy } from '../../lib/queries/usage'

export type CostGroupBy = Extract<TimeseriesGroupBy, 'source' | 'machine' | 'billing' | 'account'>
export type TokensGroupBy = Extract<
  TimeseriesGroupBy,
  'sub_tool' | 'model_norm' | 'project' | 'source'
>
export type BillingValue = 'max' | 'iu' | 'openrouter' | 'unknown'
export type WorkspaceValue = 'work' | 'private'
export type AccountValue = 'iu' | 'me'

export type TimePoint = { date: Date; groups: Record<string, number | null> }
