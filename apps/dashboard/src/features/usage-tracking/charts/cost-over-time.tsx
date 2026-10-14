import { useSuspenseQuery } from '@tanstack/react-query'
import { ViewTabs } from 'basalt-ui/controls'
import { ChartCard, StackedArea } from 'basalt-ui/charts'
import { usageQueries, type Grain, type Range } from '../../../lib/queries/usage'
import { usageStore } from '../../../lib/window-stores'
import type { BillingValue, CostGroupBy, WorkspaceValue } from '../types'
import { colorForGroup, fmtUsd, groupBands, toTimePoints } from '../constants'

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

  const points = toTimePoints(data.buckets)
  const series = groupBands(data.groupKeys, colorForGroup(groupBy))

  return (
    <ChartCard
      title="Cost over time"
      subtitle="Sum of cost_usd, bucketed by day/week"
      info="Stacked total cost across all calls, grouped by source / machine / billing. Hover a bucket to see per-group dollar values."
      actions={<ViewTabs field={usageStore.field.costGroupBy} label="Group by" />}
    >
      <StackedArea
        ariaLabel="Cost over time, stacked by group"
        data={points}
        height={280}
        x={(d) => d.date}
        cursorResolution="leading"
        series={series}
        y={{ format: fmtUsd }}
        state={{ empty: series.length === 0 }}
      />
    </ChartCard>
  )
}
