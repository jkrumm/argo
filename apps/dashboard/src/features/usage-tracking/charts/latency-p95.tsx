import { useSuspenseQuery } from '@tanstack/react-query'
import { ChartCard, VX, ZonedLine, type ChartSeries } from 'basalt-ui/charts'
import { usageQueries, type Grain, type Range } from '../../../lib/queries/usage'
import type { BillingValue, WorkspaceValue } from '../types'
import { fmtMs } from '../constants'

type Bucket = { bucket: string; groups: Record<string, number | null> }
type Point = { date: string; p95: number | null }

export default function LatencyP95({
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
      metric: 'latency_p95',
      groupBy: 'none',
      billing,
      workspace,
    }),
  )

  const points: Point[] = (data.buckets as Bucket[]).map((b) => ({
    date: b.bucket,
    p95: b.groups['value'] ?? null,
  }))
  const hasData = points.some((p) => p.p95 !== null)

  const series: ChartSeries<Point>[] = [
    { key: 'p95', label: 'p95 latency', color: VX.line, mark: 'line', getValue: (d) => d.p95 },
  ]

  return (
    <ChartCard
      title="p95 latency"
      subtitle="Per-call duration, p95 within each bucket"
      tooltip="95th-percentile latency over time (only rows with duration_ms set are counted). Sudden steps up usually mean a slower model is taking over the workload, or an upstream slowdown."
    >
      {hasData && (
        <ZonedLine
          ariaLabel="p95 latency over time"
          data={points}
          height={240}
          chartId="usage-latency-p95"
          getX={(d) => d.date}
          series={series}
          yDomain="auto"
          yAutoMinCeil={0}
          formatValue={fmtMs}
        />
      )}
    </ChartCard>
  )
}
