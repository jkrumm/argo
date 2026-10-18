import type { Grain, Range } from '../../lib/queries/usage'
import { colorForGroup } from './constants'
import { FoldedChart } from './folded-chart'
import { foldInfo, tokensFormatterFor } from './model'
import type { BillingValue, TokensGroupBy, WorkspaceValue } from './types'

const GROUP_NOUN: Record<TokensGroupBy, string> = {
  sub_tool: 'tool',
  model_norm: 'model',
  project: 'project',
  source: 'source',
}

export default function TokensChart({
  groupBy,
  printTotal,
  stripEmpty,
  ...filters
}: {
  range: Range
  grain: Grain
  billing?: BillingValue[] | undefined
  workspace?: WorkspaceValue[] | undefined
  printTotal: boolean
  stripEmpty: boolean
  groupBy: TokensGroupBy
}) {
  return (
    <FoldedChart
      {...filters}
      printTotal={printTotal}
      stripEmpty={stripEmpty}
      leading={false}
      metric="tokens"
      groupBy={groupBy}
      groupNoun={GROUP_NOUN[groupBy]}
      unitNoun="Tokens"
      color={colorForGroup(groupBy)}
      formatFor={tokensFormatterFor}
      listTitle={`Tokens by ${GROUP_NOUN[groupBy]}`}
      info={`Tokens the models read and wrote: prompt, response, reasoning and text saved to the cache. Tokens re-read from the cache are not counted, because every turn re-reads the whole conversation and would inflate the total. ${foldInfo(GROUP_NOUN[groupBy])}`}
    />
  )
}
