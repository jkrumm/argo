import { useSuspenseQuery } from '@tanstack/react-query'
import { ChartCard, StackedArea, type StackedAreaBand } from 'basalt-ui/charts'
import { usageQueries, type Grain, type Range } from '../../../lib/queries/usage'
import type { BillingValue, TimeBucket, WorkspaceValue } from '../types'
import { colorForSource, fmtCount } from '../constants'

export default function ErrorRate({
  range,
  grain,
  billing,
  workspace,
}: {
  range: Range
  grain: Grain
  billing?: BillingValue[] | undefined
  workspace?: WorkspaceValue[] | undefined
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

  const buckets = data.buckets as TimeBucket[]
  const series: StackedAreaBand<TimeBucket>[] = data.groupKeys.map((k) => ({
    key: k,
    label: k,
    color: colorForSource(k),
    getValue: (d) => d.groups[k] ?? 0,
  }))
  const hasAnyError = buckets.some((b) => data.groupKeys.some((g) => (b.groups[g] ?? 0) > 0))

  return (
    <ChartCard
      title="Errors over time"
      subtitle="Count of outcome='error' per source"
      info="Per-source error counts over the window. Healthy systems sit near zero; spikes correlate with bridge incidents, upstream model issues, or rate-limit storms."
    >
      <StackedArea
        ariaLabel="Errors over time by source"
        data={buckets}
        height={240}
        x={(d) => new Date(d.bucket)}
        cursorResolution="leading"
        series={series}
        y={{ format: fmtCount }}
        state={{ empty: hasAnyError ? false : 'No errors in this window' }}
      />
    </ChartCard>
  )
}
