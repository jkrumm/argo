import { useMemo } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ChartCard, StackedArea, type ChartSeries } from 'basalt-ui/charts'
import { usageQueries, type Grain, type Range } from '../../../lib/queries/usage'
import type { BillingValue, WorkspaceValue } from '../types'
import { colorForSource, fmtCount } from '../constants'

type Bucket = { bucket: string; groups: Record<string, number | null> }

export default function ErrorRate({
  range,
  grain,
  billing,
  workspace,
}: {
  range: Range
  grain: Grain
  billing?: BillingValue[]
  workspace?: WorkspaceValue[]
}) {
  const { data } = useSuspenseQuery(
    usageQueries.timeseries({
      range,
      grain,
      metric: 'errors',
      groupBy: 'source',
      billing,
      workspace,
    }),
  )

  const buckets = data.buckets as Bucket[]
  const groupKeys = data.groupKeys
  const hasAnyError = useMemo(
    () => buckets.some((b) => groupKeys.some((g) => (b.groups[g] ?? 0) > 0)),
    [buckets, groupKeys],
  )

  const series: ChartSeries<Bucket>[] = groupKeys.map((k) => ({
    key: k,
    label: k,
    color: colorForSource(k),
    mark: 'area' as const,
    getValue: (d) => d.groups[k] ?? 0,
  }))

  return (
    <ChartCard
      title="Errors over time"
      subtitle="Count of outcome='error' per source"
      tooltip="Per-source error counts over the window. Healthy systems sit near zero; spikes correlate with bridge incidents, upstream model issues, or rate-limit storms."
    >
      {hasAnyError && (
        <StackedArea
          ariaLabel="Errors over time by source"
          data={buckets}
          height={240}
          chartId="usage-errors-over-time"
          getX={(d) => d.bucket}
          series={series}
          formatValue={fmtCount}
          legend={{ maxRows: 8 }}
        />
      )}
    </ChartCard>
  )
}
