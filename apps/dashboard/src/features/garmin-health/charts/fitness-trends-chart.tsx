import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Group, Text } from '@mantine/core'
import { dot } from '@tanstack/charts/dot'
import { lineY } from '@tanstack/charts/line'
import { decorative } from '@tanstack/charts/mark/decorative'
import { CartesianChart, ChartCard, chartCurve, type ChartSeries } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import { dailyMetricsQueries } from '../../../lib/queries/daily-metrics'
import { SERIES } from '../../../lib/series'
import { METRIC_TOOLTIPS } from '../constants'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { chartStateOf } from '../../../lib/chart-state'
import { buildFitnessData, type FitnessPoint, type SeriesPoint } from './fitness-data'

const CHART_HEIGHT = 280
const DIMMED = 0.15
const LINE_WIDTH = 2.5

function fmtSigma(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}σ`
}

// The z-score axis is the plot; each row pairs the plotted σ with its raw 7d value, read straight
// off the hovered datum.
const FITNESS_SERIES: ChartSeries<FitnessPoint>[] = [
  {
    key: 'rhr',
    label: 'RHR (lower = fitter)',
    color: SERIES.restingHr,
    strokeWidth: LINE_WIDTH,
    getValue: (d) => d.rhrZ,
    formatValue: (v, d) =>
      d.rhrMA === null ? fmtSigma(v) : `${Math.round(d.rhrMA)} bpm · ${fmtSigma(v)}`,
  },
  {
    key: 'hrv',
    label: 'HRV (7d avg)',
    color: SERIES.hrv,
    strokeWidth: LINE_WIDTH,
    getValue: (d) => d.hrvZ,
    formatValue: (v, d) =>
      d.hrvMA === null ? fmtSigma(v) : `${Math.round(d.hrvMA)} ms · ${fmtSigma(v)}`,
  },
  {
    key: 'vo2',
    label: 'VO2 Max',
    color: SERIES.vo2max,
    mark: 'bar', // legend swatch only — the marks below draw VO2 as dots
    getValue: (d) => d.vo2Z,
    formatValue: (v, d) =>
      d.vo2max === null ? fmtSigma(v) : `${d.vo2max.toFixed(1)} · ${fmtSigma(v)}`,
  },
]

function fieldAvg(points: SeriesPoint[], field: 'restingHr' | 'hrv'): number | null {
  const vals = points.map((p) => p[field]).filter((v): v is number => v !== null)
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function computeFitnessSummary(points: SeriesPoint[]) {
  const vo2Values = points.filter((d) => d.vo2Max !== null)
  const vo2max = vo2Values.length > 0 ? (vo2Values[vo2Values.length - 1]?.vo2Max ?? null) : null

  const halfFirst = Math.min(7, Math.floor(points.length / 2))
  const halfLast = Math.min(7, Math.ceil(points.length / 2))

  const rhrFirst = fieldAvg(points.slice(0, halfFirst), 'restingHr')
  const rhrLast = fieldAvg(points.slice(-halfLast), 'restingHr')
  const rhrDelta = rhrFirst !== null && rhrLast !== null ? rhrLast - rhrFirst : null

  const hrvFirst = fieldAvg(points.slice(0, halfFirst), 'hrv')
  const hrvLast = fieldAvg(points.slice(-halfLast), 'hrv')
  const hrvDelta = hrvFirst !== null && hrvLast !== null ? hrvLast - hrvFirst : null

  return { vo2max, rhrDelta, hrvDelta }
}

// ── Public chart ─────────────────────────────────────────────────────────

export default function FitnessTrendsChart({ params }: { params: SummaryParams }) {
  const query = useQuery(dailyMetricsQueries.series(params))

  const seriesPoints: SeriesPoint[] = useMemo(
    () =>
      applyVisibilityFilter(
        (query.data?.points ?? []).map((p) => ({
          date: p.date,
          restingHr: p.restingHr,
          hrv: p.hrv,
          vo2Max: p.vo2Max,
        })),
        (p) => p.date,
        { hideToday: false },
      ),
    [query.data],
  )

  const chartData = useMemo(() => buildFitnessData(seriesPoints), [seriesPoints])
  const summary = useMemo(() => computeFitnessSummary(seriesPoints), [seriesPoints])

  const headerExtra = (
    <Group gap="sm" wrap="nowrap">
      {summary.vo2max !== null && (
        <Group gap={4} align="baseline" wrap="nowrap">
          <Text span fw={600} size="md" c={SERIES.vo2max}>
            {summary.vo2max.toFixed(1)}
          </Text>
          <Text span size="xs" c="dimmed">
            VO2
          </Text>
        </Group>
      )}
      {summary.rhrDelta !== null && (
        <Group gap={4} align="baseline" wrap="nowrap">
          <Text span fw={600} size="xs" c={summary.rhrDelta <= 0 ? VX.goodSolid : VX.badSolid}>
            {summary.rhrDelta > 0 ? '+' : ''}
            {summary.rhrDelta.toFixed(0)}
          </Text>
          <Text span size="xs" c="dimmed">
            bpm RHR
          </Text>
        </Group>
      )}
      {summary.hrvDelta !== null && (
        <Group gap={4} align="baseline" wrap="nowrap">
          <Text span fw={600} size="xs" c={summary.hrvDelta >= 0 ? VX.goodSolid : VX.badSolid}>
            {summary.hrvDelta > 0 ? '+' : ''}
            {summary.hrvDelta.toFixed(0)}
          </Text>
          <Text span size="xs" c="dimmed">
            ms HRV
          </Text>
        </Group>
      )}
    </Group>
  )

  return (
    <ChartCard
      title="Fitness Trends"
      subtitle="Is my body adapting?"
      info={METRIC_TOOLTIPS.fitnessTrends}
      actions={headerExtra}
      state={chartStateOf(
        query,
        chartData.length === 0 ? 'No fitness readings in this window' : undefined,
      )}
      placeholderHeight={CHART_HEIGHT}
    >
      <CartesianChart
        cursorResolution="leading"
        ariaLabel="Resting heart rate and HRV trend z-scores with VO2 max markers"
        data={chartData}
        height={CHART_HEIGHT}
        x={(d) => d.day}
        series={FITNESS_SERIES}
        y={{ domain: [-2.5, 2.5], ticks: 5, format: fmtSigma }}
        refLines={[{ value: 0, color: alpha(VX.axis, 0.6), dashed: true }]}
        marks={(plot) =>
          plot.visible.map((s) => {
            const opacity = plot.highlighted === null || plot.highlighted === s.key ? 1 : DIMMED
            if (s.mark === 'bar') {
              return decorative(
                dot(
                  plot.rows(s.key).filter((r) => r.y !== null),
                  {
                    id: s.key,
                    x: 'x',
                    y: 'y',
                    r: 5,
                    fill: s.color,
                    fillOpacity: opacity,
                    stroke: VX.dotStroke,
                    strokeWidth: 2,
                    strokeOpacity: opacity,
                  },
                ),
              )
            }
            return lineY(plot.rows(s.key), {
              id: s.key,
              x: 'x',
              y: 'y',
              z: 'series',
              curve: chartCurve('monotone'),
              stroke: s.color,
              strokeWidth: LINE_WIDTH,
              strokeOpacity: opacity,
            })
          })
        }
      />
    </ChartCard>
  )
}
