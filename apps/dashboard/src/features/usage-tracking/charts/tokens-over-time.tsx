import { useMemo } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ViewTabs } from 'basalt-ui/controls'
import { ChartCard, StackedArea, type ChartSeries } from 'basalt-ui/charts'
import { usageQueries, type Grain, type Range } from '../../../lib/queries/usage'
import { usageStore } from '../../../lib/window-stores'
import type { BillingValue, TokensGroupBy, WorkspaceValue } from '../types'
import { colorForKey, colorForSource, fmtCount } from '../constants'

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
}: {
  range: Range
  grain: Grain
  billing?: BillingValue[]
  workspace?: WorkspaceValue[]
  groupBy: TokensGroupBy
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

  return (
    <ChartCard
      title="Tokens over time"
      subtitle="Sum of incremental token columns, bucketed"
      info="Total token volume (input + output + cache_write + reasoning) over time. cache_read is excluded — it's the full prior context re-read from cache on every turn, not a delta, so summing it across rows would inflate the total. Group by sub-tool to see which sideclaw workflows burn tokens."
      actions={<ViewTabs field={usageStore.field.tokensGroupBy} label="Group by" />}
    >
      {buckets.length > 0 && (
        <StackedArea
          ariaLabel="Tokens over time, stacked by group"
          data={buckets}
          height={280}
          chartId="usage-tokens-over-time"
          getX={(d) => d.bucket}
          cursorResolution="leading"
          series={series}
          y={{ format: fmtCount }}
          legend={{ maxRows: 8 }}
        />
      )}
    </ChartCard>
  )
}
