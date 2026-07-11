import { useMemo } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { SegmentedControl } from '@mantine/core'
import { ChartCard, StackedArea, type ChartSeries } from 'basalt-ui/charts'
import { usageQueries, type Grain, type Range } from '../../../lib/queries/usage'
import type { BillingValue, CostGroupBy, WorkspaceValue } from '../types'
import { colorForBilling, colorForKey, colorForSource, fmtUsd } from '../constants'

const GROUPBY_OPTIONS = [
  { label: 'Source', value: 'source' },
  { label: 'Machine', value: 'machine' },
  { label: 'Billing', value: 'billing' },
]

type Bucket = { bucket: string; groups: Record<string, number | null> }

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
  onGroupByChange,
}: {
  range: Range
  grain: Grain
  billing?: BillingValue[]
  workspace?: WorkspaceValue[]
  groupBy: CostGroupBy
  onGroupByChange: (g: CostGroupBy) => void
}) {
  const { data } = useSuspenseQuery(
    usageQueries.timeseries({ range, grain, metric: 'cost', groupBy, billing, workspace }),
  )

  const colorFn = useMemo(() => colorForGroup(groupBy), [groupBy])
  const buckets = data.buckets as Bucket[]
  const groupKeys = data.groupKeys

  const series: ChartSeries<Bucket>[] = groupKeys.map((k) => ({
    key: k,
    label: k,
    color: colorFn(k),
    mark: 'area' as const,
    getValue: (d) => d.groups[k] ?? 0,
  }))

  const headerExtra = (
    <SegmentedControl
      size="xs"
      value={groupBy}
      onChange={(v) => onGroupByChange(v as CostGroupBy)}
      data={GROUPBY_OPTIONS}
    />
  )

  return (
    <ChartCard
      title="Cost over time"
      subtitle="Sum of cost_usd, bucketed by day/week"
      tooltip="Stacked total cost across all calls, grouped by source / machine / billing. Hover a bucket to see per-group dollar values."
      extra={headerExtra}
    >
      {buckets.length > 0 && (
        <StackedArea<Bucket>
          data={buckets}
          height={280}
          chartId="usage-cost-over-time"
          getX={(d) => d.bucket}
          series={series}
          formatValue={fmtUsd}
          ariaLabel="Cost over time, stacked by group"
        />
      )}
    </ChartCard>
  )
}
