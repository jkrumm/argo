import { useMemo } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useElementSize } from '@mantine/hooks'
import { SegmentedControl } from '@mantine/core'
import { ChartCard, ChartLegend, StackedArea } from '@argo/charts'
import { usageQueries, type Grain, type Range } from '../../../lib/queries/usage'
import type { CostGroupBy } from '../types'
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
  groupBy,
  onGroupByChange,
}: {
  range: Range
  grain: Grain
  groupBy: CostGroupBy
  onGroupByChange: (g: CostGroupBy) => void
}) {
  const { data } = useSuspenseQuery(
    usageQueries.timeseries({ range, grain, metric: 'cost', groupBy }),
  )
  const { ref, width } = useElementSize<HTMLDivElement>()

  const colorFn = useMemo(() => colorForGroup(groupBy), [groupBy])
  const buckets = data.buckets as Bucket[]
  const groupKeys = data.groupKeys

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
      <div ref={ref} style={{ height: 280, width: '100%' }}>
        {width > 0 && buckets.length > 0 && (
          <StackedArea<Bucket>
            data={buckets}
            width={Math.max(width, 200)}
            height={280}
            chartId="usage-cost-over-time"
            getX={(d) => d.bucket}
            groups={groupKeys}
            getValue={(d, g) => d.groups[g] ?? 0}
            colorForGroup={colorFn}
            seriesLabel={(g) => g}
            formatValue={fmtUsd}
          />
        )}
      </div>
      <ChartLegend
        items={groupKeys.map((k) => ({
          key: k,
          label: k,
          color: colorFn(k),
          shape: 'bar' as const,
        }))}
      />
    </ChartCard>
  )
}
