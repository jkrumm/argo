import type { Grain, Range } from '../../lib/queries/usage'
import { colorForGroup } from './constants'
import { FoldedChart } from './folded-chart'
import { USAGE_TIME_GROUP } from './quota-model'
import { foldInfo, fmtUsdWhole } from './model'
import type { PayerValue, CostGroupBy, WorkspaceValue } from './types'

const GROUP_NOUN: Record<CostGroupBy, string> = {
  source: 'source',
  machine: 'machine',
  payer: 'payer',
}

export default function CostChart({
  groupBy,
  printTotal,
  stripEmpty,
  leading,
  ...filters
}: {
  range: Range
  grain: Grain
  payer?: PayerValue[] | undefined
  workspace?: WorkspaceValue[] | undefined
  printTotal: boolean
  stripEmpty: boolean
  leading: boolean
  groupBy: CostGroupBy
}) {
  return (
    <FoldedChart
      {...filters}
      printTotal={printTotal}
      stripEmpty={stripEmpty}
      leading={leading}
      metric="cost"
      cursorGroup={USAGE_TIME_GROUP}
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
