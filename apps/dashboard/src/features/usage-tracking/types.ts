import type { TimeseriesGroupBy } from '../../lib/queries/usage'

export type CostGroupBy = Extract<TimeseriesGroupBy, 'source' | 'machine' | 'billing'>
export type TokensGroupBy = Extract<
  TimeseriesGroupBy,
  'sub_tool' | 'model_norm' | 'project' | 'source'
>
export type BillingValue = 'max' | 'iu' | 'unknown'
export type WorkspaceValue = 'work' | 'private'
