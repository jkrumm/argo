import { useSuspenseQuery } from '@tanstack/react-query'
import { ViewTabs } from 'basalt-ui/controls'
import { ChartCard, StackedArea, type StackedAreaBand } from 'basalt-ui/charts'
import { usageQueries, type Grain, type Range } from '../../../lib/queries/usage'
import { usageStore } from '../../../lib/window-stores'
import type { BillingValue, TimeBucket, TokensGroupBy, WorkspaceValue } from '../types'
import { colorForKey, colorForSource, fmtCount } from '../constants'

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

  const buckets = data.buckets as TimeBucket[]
  const colorFn = groupBy === 'source' ? colorForSource : colorForKey
  const series: StackedAreaBand<TimeBucket>[] = data.groupKeys.map((k) => ({
    key: k,
    label: k,
    color: colorFn(k),
    getValue: (d) => d.groups[k] ?? 0,
  }))

  return (
    <ChartCard
      title="Tokens over time"
      subtitle="Sum of incremental token columns, bucketed"
      info="Total token volume (input + output + cache_write + reasoning) over time. cache_read is excluded — it's the full prior context re-read from cache on every turn, not a delta, so summing it across rows would inflate the total. Group by sub-tool to see which agent-gateway workflows burn tokens."
      actions={<ViewTabs field={usageStore.field.tokensGroupBy} label="Group by" />}
    >
      <StackedArea
        ariaLabel="Tokens over time, stacked by group"
        data={buckets}
        height={280}
        x={(d) => new Date(d.bucket)}
        cursorResolution="leading"
        series={series}
        y={{ format: fmtCount }}
        state={{ empty: buckets.length === 0 || series.length === 0 }}
      />
    </ChartCard>
  )
}
