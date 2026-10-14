import { useSuspenseQuery } from '@tanstack/react-query'
import { ViewTabs } from 'basalt-ui/controls'
import { ChartCard, StackedArea } from 'basalt-ui/charts'
import { usageQueries, type Grain, type Range } from '../../../lib/queries/usage'
import { usageStore } from '../../../lib/window-stores'
import type { BillingValue, TokensGroupBy, WorkspaceValue } from '../types'
import { colorForGroup, fmtCount, groupBands, toTimePoints } from '../constants'

export default function TokensOverTime({
  range,
  grain,
  billing,
  workspace,
  groupBy,
}: {
  range: Range
  grain: Grain
  billing?: BillingValue[] | undefined
  workspace?: WorkspaceValue[] | undefined
  groupBy: TokensGroupBy
}) {
  const { data } = useSuspenseQuery(
    usageQueries.timeseries({ range, grain, metric: 'tokens', groupBy, billing, workspace }),
  )

  const points = toTimePoints(data.buckets)
  const series = groupBands(data.groupKeys, colorForGroup(groupBy))

  return (
    <ChartCard
      title="Tokens over time"
      subtitle="Sum of incremental token columns, bucketed"
      info="Total token volume (input + output + cache_write + reasoning) over time. cache_read is excluded — it's the full prior context re-read from cache on every turn, not a delta, so summing it across rows would inflate the total. Group by sub-tool to see which agent-gateway workflows burn tokens."
      actions={<ViewTabs field={usageStore.field.tokensGroupBy} label="Group by" />}
    >
      <StackedArea
        ariaLabel="Tokens over time, stacked by group"
        data={points}
        height={280}
        x={(d) => d.date}
        cursorResolution="leading"
        series={series}
        y={{ format: fmtCount }}
        state={{ empty: series.length === 0 }}
      />
    </ChartCard>
  )
}
