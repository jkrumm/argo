import { useMemo } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { SegmentedControl } from '@mantine/core'
import { ChartCard, StackedArea, type ChartSeries } from 'basalt-ui/charts'
import { usageQueries, type Grain, type Range } from '../../../lib/queries/usage'
import type { BillingValue, TokensGroupBy, WorkspaceValue } from '../types'
import { colorForKey, colorForSource, fmtCount } from '../constants'

const GROUPBY_OPTIONS = [
  { label: 'Sub-tool', value: 'sub_tool' },
  { label: 'Model', value: 'model_norm' },
  { label: 'Project', value: 'project' },
  { label: 'Source', value: 'source' },
]

type Bucket = { bucket: string; groups: Record<string, number | null> }

function colorForGroup(groupBy: TokensGroupBy): (key: string) => string {
  if (groupBy === 'source') return colorForSource
  return colorForKey
}

export default function TokensOverTime({
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
  groupBy: TokensGroupBy
  onGroupByChange: (g: TokensGroupBy) => void
}) {
  const { data } = useSuspenseQuery(
    usageQueries.timeseries({ range, grain, metric: 'tokens', groupBy, billing, workspace }),
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
      onChange={(v) => onGroupByChange(v as TokensGroupBy)}
      data={GROUPBY_OPTIONS}
    />
  )

  return (
    <ChartCard
      title="Tokens over time"
      subtitle="Sum of incremental token columns, bucketed"
      tooltip="Total token volume (input + output + cache_write + reasoning) over time. cache_read is excluded — it's the full prior context re-read from cache on every turn, not a delta, so summing it across rows would inflate the total. Group by sub-tool to see which sideclaw workflows burn tokens."
      extra={headerExtra}
    >
      {buckets.length > 0 && (
        <StackedArea
          ariaLabel="Tokens over time, stacked by group"
          data={buckets}
          height={280}
          chartId="usage-tokens-over-time"
          getX={(d) => d.bucket}
          series={series}
          formatValue={fmtCount}
          legend={{ maxRows: 8 }}
        />
      )}
    </ChartCard>
  )
}
