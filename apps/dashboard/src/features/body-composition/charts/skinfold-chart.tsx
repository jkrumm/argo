import { useMemo } from 'react'
import { Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { SERIES } from '../../../lib/series'
import { skinfoldLogQueries, type SkinfoldWindowParams } from '../../../lib/queries/skinfold-log'
import { METRIC_TOOLTIPS, SKINFOLD_SITES } from '../constants'
import { toSkinfoldChartPoints, type SkinfoldChartPoint } from './series-data'

const CHART_HEIGHT = 260

const SITE_COLORS = {
  abdominal: SERIES.skinfoldAbdominal,
  suprailiac: SERIES.skinfoldSuprailiac,
} as const

const fmtMm = (v: number): string => `${v.toFixed(1)} mm`

function skinfoldDomain(
  data: readonly SkinfoldChartPoint[],
  visible: readonly ChartSeries<SkinfoldChartPoint>[],
): [number, number] {
  const vals = data.flatMap((d) =>
    visible.map((s) => s.getValue(d)).filter((v): v is number => v !== null),
  )
  if (vals.length === 0) return [0, 50]
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const pad = Math.max((max - min) * 0.2, 1)
  return [Math.max(min - pad, 0), max + pad]
}

export default function SkinfoldChart({ params }: { params: SkinfoldWindowParams }) {
  const query = useQuery(skinfoldLogQueries.series(params))
  const apiPoints = query.data?.points
  const chartData = useMemo(() => toSkinfoldChartPoints(apiPoints ?? []), [apiPoints])
  const latest = chartData[chartData.length - 1] ?? null
  const dotR = chartData.length > 60 ? 2.5 : chartData.length > 20 ? 3.5 : 4.5

  const series: ChartSeries<SkinfoldChartPoint>[] = [
    {
      key: 'average',
      label: 'Average',
      color: VX.line,
      strokeWidth: 3,
      area: true,
      getValue: (d) => d.average,
      formatValue: fmtMm,
      getMarker: () => ({ color: VX.line, r: dotR }),
    },
    ...SKINFOLD_SITES.map((site): ChartSeries<SkinfoldChartPoint> => ({
      key: site.key,
      label: site.label,
      color: SITE_COLORS[site.key],
      strokeWidth: 1.75,
      getValue: (d) => d.bySite[site.key] ?? null,
      formatValue: fmtMm,
      getMarker: (d) =>
        d.bySite[site.key] === undefined ? null : { color: SITE_COLORS[site.key], r: dotR - 1 },
    })),
  ]

  const empty =
    chartData.length === 0 && 'No readings yet — log your first caliper session to start the trend.'

  return (
    <ChartCard
      title="Skinfold / Belly Fat"
      subtitle="Am I trending leaner?"
      info={METRIC_TOOLTIPS.skinfoldChart}
      actions={
        latest ? (
          <Text span size="xs">
            <Text span size="md" fw={600}>
              {latest.average.toFixed(1)} mm
            </Text>
            <Text span ml={4} opacity={0.5}>
              avg
            </Text>
          </Text>
        ) : null
      }
      state={{ pending: query.isPending, error: query.isError ? query.error : undefined, empty }}
      placeholderHeight={CHART_HEIGHT}
    >
      <Lines
        ariaLabel="Skinfold caliper readings per site and their average, over time"
        data={chartData}
        height={CHART_HEIGHT}
        x={(d) => d.date}
        series={series}
        y={{ domain: skinfoldDomain, ticks: 5, nice: true }}
      />
    </ChartCard>
  )
}
