import { useSuspenseQuery } from '@tanstack/react-query'
import { ChartCard, StackedArea } from 'basalt-ui/charts'
import { usageQueries, type Grain, type Range } from '../../../lib/queries/usage'
import type { BillingValue, WorkspaceValue } from '../types'
import { colorForSource, fmtCount, groupBands, toTimePoints } from '../constants'

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

  const points = toTimePoints(data.buckets)
  const series = groupBands(data.groupKeys, colorForSource)
  const hasAnyError = points.some((p) => series.some((s) => (s.getValue(p) ?? 0) > 0))

  return (
    <ChartCard
      title="Errors over time"
      subtitle="Count of outcome='error' per source"
      info="Per-source error counts over the window. Healthy systems sit near zero; spikes correlate with bridge incidents, upstream model issues, or rate-limit storms."
    >
      <StackedArea
        ariaLabel="Errors over time by source"
        data={points}
        height={240}
        x={(d) => d.date}
        cursorResolution="leading"
        series={series}
        y={{ format: fmtCount }}
        state={{ empty: !hasAnyError && 'No errors in this window' }}
      />
    </ChartCard>
  )
}
