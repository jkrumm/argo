import { useMemo } from 'react'
import { Box } from '@mantine/core'
import { DeltaBadge } from 'basalt-ui'
import { format } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { SERIES } from '../../../lib/series'
import { skinfoldLogQueries, type SkinfoldWindowParams } from '../../../lib/queries/skinfold-log'
import { windowLabel } from '../model'
import { METRIC_TOOLTIPS, SKINFOLD_SITES } from '../constants'
import {
  axisDateFormat,
  markerRadiusFor,
  toSkinfoldChartPoints,
  type SkinfoldChartPoint,
} from './series-data'

const CHART_HEIGHT = 220

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
  const prior = chartData[chartData.length - 2] ?? null
  const priorDelta = latest !== null && prior !== null ? latest.average - prior.average : null
  const dotR = markerRadiusFor(chartData.length)

  const series: ChartSeries<SkinfoldChartPoint>[] = [
    {
      key: 'average',
      label: 'Average',
      color: VX.line,
      strokeWidth: 1.5,
      dash: 'dashed',
      getValue: (d) => d.average,
      formatValue: fmtMm,
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

  return (
    <Box data-shot="skinfold-chart" data-shot-absent="empty loading error">
      <ChartCard
        title={`Skinfold, ${windowLabel(params)}`}
        info={METRIC_TOOLTIPS.skinfoldChart}
        {...(latest && {
          facts: {
            value: latest.average.toFixed(1),
            unit: 'mm',
            period: 'session average',
            ...(priorDelta !== null &&
              prior !== null && {
                comparison: (
                  <DeltaBadge
                    value={priorDelta}
                    polarity="up-bad"
                    format={(v) => `${Math.abs(v).toFixed(1)} mm`}
                    period={format(prior.date, 'd MMM')}
                  />
                ),
              }),
          },
          subtitle: `${chartData.length} sessions`,
        })}
        state={{ pending: query.isPending, error: query.isError ? query.error : undefined }}
        placeholderHeight={CHART_HEIGHT}
      >
        <Lines
          ariaLabel="Skinfold caliper readings per site and their average, over time"
          data={chartData}
          height={CHART_HEIGHT}
          x={(d) => d.date}
          formatX={axisDateFormat(chartData.map((d) => d.date))}
          tooltip={{ formatHeader: (x) => format(x, 'EEE d MMM yyyy') }}
          series={series}
          y={{ domain: skinfoldDomain, ticks: 5, nice: true, format: (v) => `${v} mm` }}
        />
      </ChartCard>
    </Box>
  )
}
