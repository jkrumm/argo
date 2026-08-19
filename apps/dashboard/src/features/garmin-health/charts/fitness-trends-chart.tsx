import { useMemo } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box } from '@mantine/core'
import {
  CartesianChart,
  ChartCard,
  Group,
  LinePath,
  VX,
  alpha,
  curveMonotoneX,
  type ChartSeries,
} from 'basalt-ui/charts'
import { dailyMetricsQueries } from '../../../lib/queries/daily-metrics'
import { SERIES } from '../../../lib/series'
import { METRIC_TOOLTIPS } from '../constants'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { ChartEmpty } from './empty'

const CHART_HEIGHT = 280
const CHART_ID = 'fitness-trends'
const LINE_WIDTH = 2.5

// ── Local helpers ────────────────────────────────────────────────────────

function movingAverage(values: (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => {
    const start = Math.max(0, i - window + 1)
    const slice = values.slice(start, i + 1).filter((v): v is number => v !== null)
    return slice.length >= Math.min(3, window)
      ? Math.round((slice.reduce((a, b) => a + b, 0) / slice.length) * 10) / 10
      : null
  })
}

function sampleStdDev(values: number[]): number | null {
  if (values.length < 2) return null
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const sq = values.reduce((a, v) => a + (v - mean) * (v - mean), 0)
  return Math.sqrt(sq / (values.length - 1))
}

function fmtSigma(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}σ`
}

function zScore(v: number | null, mean: number | null, sd: number, flip = false): number | null {
  if (v === null || mean === null) return null
  const raw = (v - mean) / sd
  return flip ? -raw : raw
}

type SeriesPoint = {
  date: string
  restingHr: number | null
  hrv: number | null
  vo2Max: number | null
}

type FitnessPoint = {
  date: string
  rhrMA: number | null
  hrvMA: number | null
  vo2max: number | null
  rhrZ: number | null
  hrvZ: number | null
  vo2Z: number | null
}

// The z-score axis is the plot; each row pairs the plotted σ with its raw 7d value, read straight
// off the hovered datum.
const FITNESS_SERIES: ChartSeries<FitnessPoint>[] = [
  {
    key: 'rhr',
    label: 'RHR (lower = fitter)',
    color: SERIES.restingHr,
    mark: 'line',
    strokeWidth: LINE_WIDTH,
    getValue: (d) => d.rhrZ,
    formatValue: (v, d) =>
      d.rhrMA === null ? fmtSigma(v) : `${Math.round(d.rhrMA)} bpm · ${fmtSigma(v)}`,
  },
  {
    key: 'hrv',
    label: 'HRV (7d avg)',
    color: SERIES.hrv,
    mark: 'line',
    strokeWidth: LINE_WIDTH,
    getValue: (d) => d.hrvZ,
    formatValue: (v, d) =>
      d.hrvMA === null ? fmtSigma(v) : `${Math.round(d.hrvMA)} ms · ${fmtSigma(v)}`,
  },
  {
    key: 'vo2',
    label: 'VO2 Max',
    color: SERIES.vo2max,
    mark: 'bar',
    getValue: (d) => d.vo2Z,
    formatValue: (v, d) =>
      d.vo2max === null ? fmtSigma(v) : `${d.vo2max.toFixed(1)} · ${fmtSigma(v)}`,
  },
]

function buildFitnessData(points: SeriesPoint[]): FitnessPoint[] {
  const rhrMA = movingAverage(
    points.map((d) => d.restingHr),
    7,
  )
  const hrvMA = movingAverage(
    points.map((d) => d.hrv),
    7,
  )

  const rhrMAVals = rhrMA.filter((v): v is number => v !== null)
  const hrvMAVals = hrvMA.filter((v): v is number => v !== null)
  const vo2Vals = points.map((d) => d.vo2Max).filter((v): v is number => v !== null)

  const rhrMean = rhrMAVals.length ? rhrMAVals.reduce((a, b) => a + b, 0) / rhrMAVals.length : null
  const hrvMean = hrvMAVals.length ? hrvMAVals.reduce((a, b) => a + b, 0) / hrvMAVals.length : null
  const vo2Mean = vo2Vals.length ? vo2Vals.reduce((a, b) => a + b, 0) / vo2Vals.length : null

  const rhrSd = Math.max(sampleStdDev(rhrMAVals) ?? 0, 0.5)
  const hrvSd = Math.max(sampleStdDev(hrvMAVals) ?? 0, 1)
  const vo2Sd = Math.max(sampleStdDev(vo2Vals) ?? 0, 0.2)

  return points
    .map((d, i) => ({
      date: d.date,
      rhrMA: rhrMA[i] ?? null,
      hrvMA: hrvMA[i] ?? null,
      vo2max: d.vo2Max,
      rhrZ: zScore(rhrMA[i] ?? null, rhrMean, rhrSd, true),
      hrvZ: zScore(hrvMA[i] ?? null, hrvMean, hrvSd),
      vo2Z: zScore(d.vo2Max, vo2Mean, vo2Sd),
    }))
    .filter((d) => d.rhrMA !== null || d.hrvMA !== null)
}

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
  const { data } = useSuspenseQuery(dailyMetricsQueries.series(params))

  const seriesPoints: SeriesPoint[] = useMemo(
    () =>
      applyVisibilityFilter(
        data.points.map((p) => ({
          date: p.date,
          restingHr: p.restingHr,
          hrv: p.hrv,
          vo2Max: p.vo2Max,
        })),
        (p) => p.date,
        { hideToday: false },
      ),
    [data.points],
  )

  const chartData = useMemo(() => buildFitnessData(seriesPoints), [seriesPoints])
  const summary = useMemo(() => computeFitnessSummary(seriesPoints), [seriesPoints])

  const headerExtra = (
    <span style={{ fontSize: VX.text.xs }}>
      {summary.vo2max !== null && (
        <Box component="span" mr="sm">
          <span style={{ fontWeight: 600, fontSize: VX.text.md, color: SERIES.vo2max }}>
            {summary.vo2max.toFixed(1)}
          </span>
          <span style={{ opacity: 0.5 }}> VO2</span>
        </Box>
      )}
      {summary.rhrDelta !== null && (
        <Box component="span" mr="sm">
          <span
            style={{
              color: summary.rhrDelta <= 0 ? VX.goodSolid : VX.badSolid,
              fontWeight: 600,
            }}
          >
            {summary.rhrDelta > 0 ? '+' : ''}
            {summary.rhrDelta.toFixed(0)}
          </span>
          <span style={{ opacity: 0.5 }}> bpm RHR</span>
        </Box>
      )}
      {summary.hrvDelta !== null && (
        <span>
          <span
            style={{
              color: summary.hrvDelta >= 0 ? VX.goodSolid : VX.badSolid,
              fontWeight: 600,
            }}
          >
            {summary.hrvDelta > 0 ? '+' : ''}
            {summary.hrvDelta.toFixed(0)}
          </span>
          <span style={{ opacity: 0.5 }}> ms HRV</span>
        </span>
      )}
    </span>
  )

  return (
    <ChartCard
      title="Fitness Trends"
      subtitle="Is my body adapting?"
      tooltip={METRIC_TOOLTIPS.fitnessTrends}
      extra={headerExtra}
    >
      {chartData.length === 0 ? (
        <ChartEmpty height={CHART_HEIGHT} />
      ) : (
        <CartesianChart
          data={chartData}
          chartId={CHART_ID}
          getX={(d) => d.date}
          series={FITNESS_SERIES}
          y={{ domain: [-2.5, 2.5], ticks: 5, format: fmtSigma }}
          refLines={[{ value: 0, color: alpha(VX.axis, 0.6), dashed: true }]}
          height={CHART_HEIGHT}
          ariaLabel="Resting heart rate and HRV trend z-scores with VO2 max markers"
        >
          {({ visible, xScale, yScale, highlighted }) =>
            visible.map((s) => {
              const opacity = highlighted === null || highlighted === s.key ? 1 : 0.15
              if (s.mark === 'line') {
                return (
                  <LinePath<FitnessPoint>
                    key={s.key}
                    data={chartData.filter((d) => s.getValue(d) !== null)}
                    x={(d) => xScale(d.date) ?? 0}
                    y={(d) => yScale(s.getValue(d) ?? 0)}
                    stroke={s.color}
                    strokeWidth={LINE_WIDTH}
                    strokeOpacity={opacity}
                    curve={curveMonotoneX}
                  />
                )
              }
              return (
                <Group key={s.key}>
                  {chartData.map((d) => {
                    const v = s.getValue(d)
                    if (v === null) return null
                    return (
                      <circle
                        key={d.date}
                        cx={xScale(d.date) ?? 0}
                        cy={yScale(v)}
                        r={5}
                        fill={s.color}
                        fillOpacity={opacity}
                        stroke={VX.dotStroke}
                        strokeWidth={2}
                        strokeOpacity={opacity}
                      />
                    )
                  })}
                </Group>
              )
            })
          }
        </CartesianChart>
      )}
    </ChartCard>
  )
}
