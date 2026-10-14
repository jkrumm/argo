import { useSuspenseQuery } from '@tanstack/react-query'
import { ViewTabs } from 'basalt-ui/controls'
import { ChartCard, StackedArea, type StackedAreaBand } from 'basalt-ui/charts'
import { usageQueries, type Grain, type Range } from '../../../lib/queries/usage'
import { usageStore } from '../../../lib/window-stores'
import type { BillingValue, CostGroupBy, TimeBucket, WorkspaceValue } from '../types'
import { colorForBilling, colorForKey, colorForSource, fmtUsd } from '../constants'

function colorForGroup(groupBy: CostGroupBy): (key: string) => string {
  if (groupBy === 'source') return colorForSource
  if (groupBy === 'billing') return colorForBilling
  return colorForKey
}

export default function CostOverTime({
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
  groupBy: CostGroupBy
}) {
  const { data } = useSuspenseQuery(
    usageQueries.timeseries({ range, grain, metric: 'cost', groupBy, billing, workspace }),
  )

  const buckets = data.buckets as TimeBucket[]
  const colorFn = colorForGroup(groupBy)
  const series: StackedAreaBand<TimeBucket>[] = data.groupKeys.map((k) => ({
    key: k,
    label: k,
    color: colorFn(k),
    getValue: (d) => d.groups[k] ?? 0,
  }))

  return (
    <ChartCard
      title="Cost over time"
      subtitle="Sum of cost_usd, bucketed by day/week"
      info="Stacked total cost across all calls, grouped by source / machine / billing. Hover a bucket to see per-group dollar values."
      actions={<ViewTabs field={usageStore.field.costGroupBy} label="Group by" />}
    >
      <StackedArea
        ariaLabel="Cost over time, stacked by group"
        data={buckets}
        height={280}
        x={(d) => new Date(d.bucket)}
        cursorResolution="leading"
        series={series}
        y={{ format: fmtUsd }}
        state={{ empty: buckets.length === 0 || series.length === 0 }}
      />
    </ChartCard>
  )
}
