import { useMemo } from 'react'
import { Box } from '@mantine/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  AreaClosed,
  AreaGradient,
  areaFillUrl,
  CartesianChart,
  ChartCard,
  LinePath,
  VX,
  curveMonotoneX,
  type ChartSeries,
} from 'basalt-ui/charts'
import { SERIES } from '../../../lib/series'
import {
  skinfoldLogQueries,
  type SkinfoldSite,
  type SkinfoldWindowParams,
} from '../../../lib/queries/skinfold-log'
import { METRIC_TOOLTIPS, SKINFOLD_SITES } from '../constants'

type ApiPoint = {
  date: string
  average: number
  readings: { site: SkinfoldSite; valueMm: number }[]
}

type ChartPoint = {
  date: string
  average: number
  bySite: Partial<Record<SkinfoldSite, number>>
}

const CHART_HEIGHT = 260
const AREA_ID = 'skinfold-average-area'

const SITE_COLORS: Record<SkinfoldSite, string> = {
  abdominal: SERIES.skinfoldAbdominal,
  suprailiac: SERIES.skinfoldSuprailiac,
}

const fmtMm = (v: number): string => `${v.toFixed(1)} mm`

const SKINFOLD_SERIES: ChartSeries<ChartPoint>[] = [
  {
    key: 'average',
    label: 'Average',
    color: VX.line,
    mark: 'line',
    strokeWidth: 3,
    getValue: (d) => d.average,
    formatValue: fmtMm,
  },
  ...SKINFOLD_SITES.map((site) => ({
    key: site.key,
    label: site.label,
    color: SITE_COLORS[site.key],
    mark: 'line' as const,
    strokeWidth: 1.75,
    getValue: (d: ChartPoint) => d.bySite[site.key] ?? null,
    formatValue: fmtMm,
  })),
]

function toChartPoints(points: ApiPoint[]): ChartPoint[] {
  return points
    .toSorted((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((p) => {
      const bySite: Partial<Record<SkinfoldSite, number>> = {}
      for (const r of p.readings) bySite[r.site] = r.valueMm
      return { date: p.date, average: p.average, bySite }
    })
}

function skinfoldDomain(
  data: readonly ChartPoint[],
  visible: readonly ChartSeries<ChartPoint>[],
): [number, number] {
  const vals: number[] = []
  for (const d of data) {
    for (const s of visible) {
      const v = s.getValue(d)
      if (v !== null) vals.push(v)
    }
  }
  if (vals.length === 0) return [0, 50]
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const pad = Math.max((max - min) * 0.2, 1)
  return [Math.max(min - pad, 0), max + pad]
}

export default function SkinfoldChart({ params }: { params: SkinfoldWindowParams }) {
  const { data } = useSuspenseQuery(skinfoldLogQueries.series(params))

  const apiPoints = data.points as ApiPoint[]
  const chartData = useMemo(() => toChartPoints(apiPoints), [apiPoints])
  const latest = chartData[chartData.length - 1] ?? null

  const headerExtra = latest ? (
    <span style={{ fontSize: VX.text.xs }}>
      <span style={{ fontWeight: 600, fontSize: VX.text.md }}>{latest.average.toFixed(1)} mm</span>
      <Box component="span" ml={4} style={{ opacity: 0.5 }}>
        avg
      </Box>
    </span>
  ) : null

  return (
    <ChartCard
      title="Skinfold / Belly Fat"
      subtitle="Am I trending leaner?"
      info={METRIC_TOOLTIPS.skinfoldChart}
      actions={headerExtra}
      state={{
        empty:
          chartData.length === 0 &&
          'No readings yet — log your first caliper session to start the trend.',
      }}
      placeholderHeight={CHART_HEIGHT}
    >
      <CartesianChart
        data={chartData}
        chartId="skinfold"
        getX={(d) => d.date}
        series={SKINFOLD_SERIES}
        y={{ domain: skinfoldDomain, ticks: 5, nice: true }}
        height={CHART_HEIGHT}
        ariaLabel="Skinfold caliper readings per site and their average, over time"
      >
        {({ visible, xScale, yScale }) => {
          const dotR = chartData.length > 60 ? 2.5 : chartData.length > 20 ? 3.5 : 4.5
          const shown = new Set(visible.map((s) => s.key))
          return (
            <>
              <defs>
                <AreaGradient id={AREA_ID} color={VX.line} />
              </defs>

              {shown.has('average') && (
                <AreaClosed<ChartPoint>
                  data={chartData}
                  x={(d) => xScale(d.date) ?? 0}
                  y={(d) => yScale(d.average)}
                  yScale={yScale}
                  curve={curveMonotoneX}
                  fill={areaFillUrl(AREA_ID)}
                />
              )}

              {/* Per-site lines — thinner, distinct categorical colors */}
              {SKINFOLD_SITES.map((site) => {
                if (!shown.has(site.key)) return null
                const pts = chartData.filter((d) => d.bySite[site.key] !== undefined)
                if (pts.length === 0) return null
                return (
                  <LinePath<ChartPoint>
                    key={site.key}
                    data={pts}
                    x={(d) => xScale(d.date) ?? 0}
                    y={(d) => yScale(d.bySite[site.key] as number)}
                    stroke={SITE_COLORS[site.key]}
                    strokeWidth={1.75}
                    curve={curveMonotoneX}
                  />
                )
              })}

              {/* Bold average line — the belly-fat trend, primary emphasis */}
              {shown.has('average') && (
                <LinePath<ChartPoint>
                  data={chartData}
                  x={(d) => xScale(d.date) ?? 0}
                  y={(d) => yScale(d.average)}
                  stroke={VX.line}
                  strokeWidth={3}
                  curve={curveMonotoneX}
                />
              )}

              {/* Dots per data point */}
              {SKINFOLD_SITES.map((site) =>
                !shown.has(site.key)
                  ? null
                  : chartData
                      .filter((d) => d.bySite[site.key] !== undefined)
                      .map((d) => (
                        <circle
                          key={`dot-${site.key}-${d.date}`}
                          cx={xScale(d.date) ?? 0}
                          cy={yScale(d.bySite[site.key] as number)}
                          r={dotR - 1}
                          fill={SITE_COLORS[site.key]}
                          stroke={VX.dotStroke}
                          strokeWidth={1}
                        />
                      )),
              )}
              {shown.has('average') &&
                chartData.map((d) => (
                  <circle
                    key={`dot-average-${d.date}`}
                    cx={xScale(d.date) ?? 0}
                    cy={yScale(d.average)}
                    r={dotR}
                    fill={VX.line}
                    stroke={VX.dotStroke}
                    strokeWidth={1.5}
                  />
                ))}
            </>
          )
        }}
      </CartesianChart>
    </ChartCard>
  )
}
