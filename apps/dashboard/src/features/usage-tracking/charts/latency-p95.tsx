import { useSuspenseQuery } from '@tanstack/react-query'
import { useElementSize } from '@mantine/hooks'
import { ChartCard, ChartLegend, ZonedLine, useVxTheme } from '@argo/charts'
import { usageQueries, type Grain, type Range } from '../../../lib/queries/usage'
import { fmtMs } from '../constants'

type Bucket = { bucket: string; groups: Record<string, number | null> }

export default function LatencyP95({ range, grain }: { range: Range; grain: Grain }) {
  const { data } = useSuspenseQuery(
    usageQueries.timeseries({ range, grain, metric: 'latency_p95', groupBy: 'none' }),
  )
  const { ref, width } = useElementSize<HTMLDivElement>()
  const { line } = useVxTheme()

  const points = (data.buckets as Bucket[]).map((b) => ({
    date: b.bucket,
    p95: b.groups['value'] ?? null,
  }))
  const hasData = points.some((p) => p.p95 !== null)

  return (
    <ChartCard
      title="p95 latency"
      subtitle="Per-call duration, p95 within each bucket"
      tooltip="95th-percentile latency over time (only rows with duration_ms set are counted). Sudden steps up usually mean a slower model is taking over the workload, or an upstream slowdown."
    >
      <div ref={ref} style={{ height: 240, width: '100%' }}>
        {width > 0 && hasData && (
          <ZonedLine<{ date: string; p95: number | null }>
            data={points}
            width={Math.max(width, 200)}
            height={240}
            chartId="usage-latency-p95"
            getX={(d) => d.date}
            getY={(d) => d.p95}
            yDomain="auto"
            yAutoMinCeil={0}
            seriesLabel="p95 latency"
            formatValue={fmtMs}
          />
        )}
      </div>
      <ChartLegend items={[{ key: 'p95', label: 'p95 latency', color: line }]} />
    </ChartCard>
  )
}
