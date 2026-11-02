import type { Grain, Range } from '../../lib/queries/usage'
import type { UsageGroupBy, UsageLens } from '../../lib/window-stores'
import type { PayerValue } from './accounts'
import type { WorkspaceValue } from './types'

// Seam stub for usage v7 (Wave 8): the Explore tab, built by its own change. The props are the contract.
export interface ExploreTabProps {
  range: Range
  grain: Grain
  lens: UsageLens
  groupBy: UsageGroupBy
  workspace: WorkspaceValue[] | undefined
  /** Selected payers; empty = every payer except Athena team. */
  payer: readonly PayerValue[]
}

export function ExploreTab(_props: ExploreTabProps) {
  return null
}
