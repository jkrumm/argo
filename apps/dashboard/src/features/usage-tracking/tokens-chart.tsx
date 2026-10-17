import type { Grain, Range } from '../../lib/queries/usage'
import { colorForGroup } from './constants'
import { FoldedChart } from './folded-chart'
import { fmtTokens } from './model'
import type { BillingValue, TokensGroupBy, WorkspaceValue } from './types'

const GROUP_NOUN: Record<TokensGroupBy, string> = {
  sub_tool: 'tool',
  model_norm: 'model',
  project: 'project',
  source: 'source',
}

export default function TokensChart({
  groupBy,
  headlineTotal,
  ...filters
}: {
  range: Range
  grain: Grain
  billing?: BillingValue[] | undefined
  workspace?: WorkspaceValue[] | undefined
  headlineTotal: number | null | undefined
  groupBy: TokensGroupBy
}) {
  return (
    <FoldedChart
      {...filters}
      headlineTotal={headlineTotal}
      metric="tokens"
      groupBy={groupBy}
      groupNoun={GROUP_NOUN[groupBy]}
      unitNoun="Tokens"
      color={colorForGroup(groupBy)}
      format={fmtTokens}
      listTitle={`Tokens by ${GROUP_NOUN[groupBy]}`}
      info="Input + output + cache-write + reasoning tokens per bucket. cache_read is excluded: it re-reads the whole prior context every turn, so summing it would inflate the total. The six largest series are shown by name; the rest are summed into Other."
    />
  )
}
