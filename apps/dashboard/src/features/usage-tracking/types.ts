import type { PayerValue } from './accounts'
import type { TimeseriesGroupBy } from '../../lib/queries/usage'

export type CostGroupBy = Extract<TimeseriesGroupBy, 'payer' | 'source' | 'machine'>
export type TokensGroupBy = Extract<
  TimeseriesGroupBy,
  'sub_tool' | 'model_norm' | 'project' | 'source'
>
export type { PayerValue }
export type WorkspaceValue = 'work' | 'private'

export type TimePoint = { date: Date; groups: Record<string, number | null> }
