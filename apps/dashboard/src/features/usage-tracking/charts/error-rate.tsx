import { useMemo } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useElementSize } from '@mantine/hooks'
import { ChartCard, ChartLegend, StackedArea } from '@argo/charts'
import { usageQueries, type Grain, type Range } from '../../../lib/queries/usage'
import { colorForSource, fmtCount } from '../constants'

type Bucket = { bucket: string; groups: Record<string, number | null> }

export default function ErrorRate({ range, grain }: { range: Range; grain: Grain }) {
  const { data } = useSuspenseQuery(
    usageQueries.timeseries({ range, grain, metric: 'errors', groupBy: 'source' }),
  )
  const { ref, width } = useElementSize<HTMLDivElement>()

  const buckets = data.buckets as Bucket[]
  const groupKeys = data.groupKeys
  const hasAnyError = useMemo(
    () => buckets.some((b) => groupKeys.some((g) => (b.groups[g] ?? 0) > 0)),
    [buckets, groupKeys],
  )

  return (
    <ChartCard
      title="Errors over time"
      subtitle="Count of outcome='error' per source"
      tooltip="Per-source error counts over the window. Healthy systems sit near zero; spikes correlate with bridge incidents, upstream model issues, or rate-limit storms."
    >
      <div ref={ref} style={{ height: 240, width: '100%' }}>
        {width > 0 && hasAnyError && (
          <StackedArea<Bucket>
            data={buckets}
            width={Math.max(width, 200)}
            height={240}
            chartId="usage-errors-over-time"
            getX={(d) => d.bucket}
            groups={groupKeys}
            getValue={(d, g) => d.groups[g] ?? 0}
            colorForGroup={colorForSource}
            seriesLabel={(g) => g}
            formatValue={fmtCount}
          />
        )}
      </div>
      <ChartLegend
        items={groupKeys.slice(0, 8).map((k) => ({
          key: k,
          label: k,
          color: colorForSource(k),
          shape: 'bar' as const,
        }))}
      />
    </ChartCard>
  )
}
