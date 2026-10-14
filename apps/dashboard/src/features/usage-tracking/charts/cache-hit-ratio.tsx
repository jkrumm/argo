import { useSuspenseQuery } from '@tanstack/react-query'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { usageQueries, type Grain, type Range } from '../../../lib/queries/usage'
import type { BillingValue, WorkspaceValue } from '../types'
import { dayToDate, fmtPct } from '../constants'

type Point = { date: Date; ratio: number | null }

// One table drives both the plotted zones and their legend entries.
const THRESHOLDS = [
  { key: 'good', label: 'Good (>60%)', from: 0.6, to: 1, fill: VX.good, color: VX.goodSolid },
  { key: 'bad', label: 'Poor (<30%)', from: 0, to: 0.3, fill: VX.bad, color: VX.badSolid },
] as const

const ZONES = THRESHOLDS.map(({ from, to, fill }) => ({ from, to, fill }))

// Legend-only entries (`getValue` always null): they name the zones without plotting or listing a
// tooltip row.
const SERIES: readonly ChartSeries<Point>[] = [
  {
    key: 'ratio',
    label: 'Cache hit ratio',
    color: VX.line,
    getValue: (d) => d.ratio,
    formatValue: fmtPct,
  },
  ...THRESHOLDS.map(({ key, label, color }): ChartSeries<Point> => ({
    key,
    label,
    color,
    mark: 'bar',
    role: 'reference',
    getValue: () => null,
  })),
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

  const points: Point[] = data.buckets.map((b) => ({
    date: dayToDate(b.bucket),
    ratio: b.groups['value'] ?? null,
  }))

  return (
    <ChartCard
      title="Cache hit ratio"
      subtitle="cache_read / (cache_read + input), weighted per bucket"
      info="Weighted cache hit ratio over time. >60% means prompt caching is doing its job; sustained <30% usually means the cache key is changing too often."
    >
      <Lines
        ariaLabel="Cache hit ratio over time"
        data={points}
        height={240}
        x={(d) => d.date}
        cursorResolution="leading"
        series={SERIES}
        y={{ domain: [0, 1], format: fmtPct }}
        zones={ZONES}
        legend={{ toggle: false }}
        state={{ empty: !points.some((p) => p.ratio !== null) }}
      />
    </ChartCard>
  )
}
