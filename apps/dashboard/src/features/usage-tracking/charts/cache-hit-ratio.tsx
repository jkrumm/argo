import { useSuspenseQuery } from '@tanstack/react-query'
import {
  ChartCard,
  ChartLegend,
  deriveLegend,
  VX,
  ZonedLine,
  type ChartSeries,
  type SeriesStyle,
} from 'basalt-ui/charts'
import { usageQueries, type Grain, type Range } from '../../../lib/queries/usage'
import type { BillingValue, WorkspaceValue } from '../types'
import { fmtPct } from '../constants'

type Bucket = { bucket: string; groups: Record<string, number | null> }
type Point = { date: string; ratio: number | null }

const CACHE_HIT_LEGEND_SERIES: readonly SeriesStyle[] = [
  { key: 'ratio', label: 'Cache hit ratio', color: VX.line, mark: 'line' },
  { key: 'good', label: 'Good (>60%)', color: VX.goodSolid, mark: 'bar' },
  { key: 'bad', label: 'Poor (<30%)', color: VX.badSolid, mark: 'bar' },
]

export default function CacheHitRatio({
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
      metric: 'cache_ratio',
      groupBy: 'none',
      billing,
      workspace,
    }),
  )

  const points: Point[] = (data.buckets as Bucket[]).map((b) => ({
    date: b.bucket,
    ratio: b.groups['value'] ?? null,
  }))
  const hasData = points.some((p) => p.ratio !== null)

  const series: ChartSeries<Point>[] = [
    {
      key: 'ratio',
      label: 'Cache hit',
      color: VX.line,
      mark: 'line',
      getValue: (d) => d.ratio,
      formatValue: fmtPct,
    },
  ]

  return (
    <ChartCard
      title="Cache hit ratio"
      subtitle="cache_read / (cache_read + input), weighted per bucket"
      info="Weighted cache hit ratio over time. >60% means prompt caching is doing its job; sustained <30% usually means the cache key is changing too often."
    >
      {hasData && (
        <ZonedLine
          ariaLabel="Cache hit ratio over time"
          data={points}
          height={240}
          chartId="usage-cache-hit-ratio"
          getX={(d) => d.date}
          cursorResolution="leading"
          series={series}
          y={{ domain: [0, 1] }}
          zones={[
            { from: 0.6, to: 1, fill: VX.good },
            { from: 0, to: 0.3, fill: VX.bad },
          ]}
          legend={false}
        />
      )}
      <ChartLegend items={deriveLegend(CACHE_HIT_LEGEND_SERIES)} />
    </ChartCard>
  )
}
