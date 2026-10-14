import { useSuspenseQuery } from '@tanstack/react-query'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { usageQueries, type Grain, type Range } from '../../../lib/queries/usage'
import type { BillingValue, TimeBucket, WorkspaceValue } from '../types'
import { fmtMs } from '../constants'

type Point = { date: Date; p95: number | null }

const SERIES: readonly ChartSeries<Point>[] = [
  {
    key: 'p95',
    label: 'p95 latency',
    color: VX.line,
    getValue: (d) => d.p95,
    formatValue: fmtMs,
  },
]

export default function LatencyP95({
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
      metric: 'latency_p95',
      groupBy: 'none',
      billing,
      workspace,
    }),
  )

  const points: Point[] = (data.buckets as TimeBucket[]).map((b) => ({
    date: new Date(b.bucket),
    p95: b.groups['value'] ?? null,
  }))

  return (
    <ChartCard
      title="p95 latency"
      subtitle="Per-call duration, p95 within each bucket"
      info="95th-percentile latency over time (only rows with duration_ms set are counted). Sudden steps up usually mean a slower model is taking over the workload, or an upstream slowdown."
    >
      <Lines
        ariaLabel="p95 latency over time"
        data={points}
        height={240}
        x={(d) => d.date}
        cursorResolution="leading"
        series={SERIES}
        y={{ autoMinCeil: 0, format: fmtMs }}
        state={{ empty: !points.some((p) => p.p95 !== null) }}
      />
    </ChartCard>
  )
}
