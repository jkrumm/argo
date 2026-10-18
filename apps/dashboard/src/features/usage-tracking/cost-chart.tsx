import type { Grain, Range } from '../../lib/queries/usage'
import { colorForGroup } from './constants'
import { FoldedChart } from './folded-chart'
import { foldInfo, fmtUsdWhole } from './model'
import type { BillingValue, CostGroupBy, WorkspaceValue } from './types'

const GROUP_NOUN: Record<CostGroupBy, string> = {
  source: 'source',
  machine: 'machine',
  billing: 'billing lane',
}

export default function CostChart({
  groupBy,
  printTotal,
  leading,
  ...filters
}: {
  range: Range
  grain: Grain
  billing?: BillingValue[] | undefined
  workspace?: WorkspaceValue[] | undefined
  printTotal: boolean
  leading: boolean
  groupBy: CostGroupBy
}) {
  return (
    <FoldedChart
      {...filters}
      printTotal={printTotal}
      leading={leading}
      metric="cost"
      groupBy={groupBy}
      groupNoun={GROUP_NOUN[groupBy]}
      unitNoun="Cost"
      color={colorForGroup(groupBy)}
      formatFor={() => fmtUsdWhole}
      listTitle={`Spend by ${GROUP_NOUN[groupBy]}`}
      info={`Spend in US dollars, added up per day or week. ${foldInfo(GROUP_NOUN[groupBy])}`}
    />
  )
}
