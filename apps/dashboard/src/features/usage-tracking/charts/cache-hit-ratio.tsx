import { useSuspenseQuery } from '@tanstack/react-query'
import { useElementSize } from '@mantine/hooks'
import { ChartCard, ChartLegend, VX, ZonedLine, useVxTheme } from '@argo/charts'
import { usageQueries, type Grain, type Range } from '../../../lib/queries/usage'
import { fmtPct } from '../constants'

type Bucket = { bucket: string; groups: Record<string, number | null> }

export default function CacheHitRatio({ range, grain }: { range: Range; grain: Grain }) {
  const { data } = useSuspenseQuery(
    usageQueries.timeseries({ range, grain, metric: 'cache_ratio', groupBy: 'none' }),
  )
  const { ref, width } = useElementSize<HTMLDivElement>()
  const { line } = useVxTheme()

  const points = (data.buckets as Bucket[]).map((b) => ({
    date: b.bucket,
    ratio: b.groups['value'] ?? null,
  }))
  const hasData = points.some((p) => p.ratio !== null)

  return (
    <ChartCard
      title="Cache hit ratio"
      subtitle="cache_read / (cache_read + input), weighted per bucket"
      tooltip="Weighted cache hit ratio over time. >60% means prompt caching is doing its job; sustained <30% usually means the cache key is changing too often."
    >
      <div ref={ref} style={{ height: 240, width: '100%' }}>
        {width > 0 && hasData && (
          <ZonedLine<{ date: string; ratio: number | null }>
            data={points}
            width={Math.max(width, 200)}
            height={240}
            chartId="usage-cache-hit-ratio"
            getX={(d) => d.date}
            getY={(d) => d.ratio}
            yDomain={[0, 1]}
            zones={[
              { from: 0.6, to: 1, fill: VX.good },
              { from: 0, to: 0.3, fill: VX.bad },
            ]}
            seriesLabel="Cache hit"
            formatValue={fmtPct}
          />
        )}
      </div>
      <ChartLegend
        items={[
          { key: 'ratio', label: 'Cache hit ratio', color: line },
          { key: 'good', label: 'Good (>60%)', color: VX.goodSolid, shape: 'bar' },
          { key: 'bad', label: 'Poor (<30%)', color: VX.badSolid, shape: 'bar' },
        ]}
      />
    </ChartCard>
  )
}
