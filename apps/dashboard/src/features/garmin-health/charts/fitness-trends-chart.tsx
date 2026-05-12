import { useMemo, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useElementSize } from '@mantine/hooks'
import {
  AxisBottomDate,
  AxisLeftNumeric,
  ChartCard,
  ChartLegend,
  ChartTooltip,
  GridRows,
  Group,
  HoverOverlay,
  LinePath,
  TooltipBody,
  TooltipHeader,
  TooltipRow,
  VX,
  curveMonotoneX,
  scaleLinear,
  scalePoint,
  smartTicks,
  useHoverSync,
  useTooltipStyles,
  useVxTheme,
} from '@argo/charts'
import { dailyMetricsQueries } from '../../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS } from '../constants'
import type { SummaryParams } from '../types'

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

// ── Inner chart (bespoke — dual-line + scatter doesn't fit ZonedLine) ────

function FitnessTrendsInner({
  data,
  width,
  height,
  highlighted,
}: {
  data: FitnessPoint[]
  width: number
  height: number
  highlighted: string | null
}) {
  const { axis } = useVxTheme()
  const dim = (key: string): number => (highlighted === null || highlighted === key ? 1 : 0.15)

  const MARGIN_LOCAL = useMemo(() => ({ ...VX.margin, left: Math.max(VX.margin.left, 48) }), [])
  const xMax = width - MARGIN_LOCAL.left - MARGIN_LOCAL.right
  const yMax = height - MARGIN_LOCAL.top - MARGIN_LOCAL.bottom

  const xScale = useMemo(
    () =>
      scalePoint<string>({
        domain: data.map((d) => d.date),
        range: [0, xMax],
        padding: 0.3,
      }),
    [data, xMax],
  )

  // Fixed z-score axis −2.5σ → +2.5σ per spec.
  const yScale = useMemo(
    () => scaleLinear<number>({ domain: [-2.5, 2.5], range: [yMax, 0] }),
    [yMax],
  )

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<FitnessPoint>({
      data,
      chartId: 'fitness-trends',
      getX: (d) => d.date,
      xScale,
      marginLeft: MARGIN_LOCAL.left,
    })

  const tickValues = useMemo(
    () =>
      smartTicks(
        data.map((d) => d.date),
        xMax,
      ),
    [data, xMax],
  )

  const rhrValid = useMemo(
    () => data.filter((d): d is FitnessPoint & { rhrZ: number } => d.rhrZ !== null),
    [data],
  )
  const hrvValid = useMemo(
    () => data.filter((d): d is FitnessPoint & { hrvZ: number } => d.hrvZ !== null),
    [data],
  )
  const vo2Valid = useMemo(
    () =>
      data.filter(
        (d): d is FitnessPoint & { vo2Z: number; vo2max: number } =>
          d.vo2Z !== null && d.vo2max !== null,
      ),
    [data],
  )

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <Group left={MARGIN_LOCAL.left} top={MARGIN_LOCAL.top}>
          <GridRows scale={yScale} width={xMax} stroke={VX.grid} numTicks={5} />

          {/* Zero baseline — "your baseline" */}
          <line
            x1={0}
            x2={xMax}
            y1={yScale(0)}
            y2={yScale(0)}
            stroke={axis}
            strokeWidth={1}
            strokeDasharray="2 4"
            strokeOpacity={0.6}
          />

          <LinePath<FitnessPoint & { rhrZ: number }>
            data={rhrValid}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScale(d.rhrZ)}
            stroke={VX.series.restingHr}
            strokeWidth={2.5}
            strokeOpacity={dim('rhr')}
            curve={curveMonotoneX}
          />
          <LinePath<FitnessPoint & { hrvZ: number }>
            data={hrvValid}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScale(d.hrvZ)}
            stroke={VX.series.hrv}
            strokeWidth={2.5}
            strokeOpacity={dim('hrv')}
            curve={curveMonotoneX}
          />

          {vo2Valid.map((d) => (
            <circle
              key={`vo2-${d.date}`}
              cx={xScale(d.date) ?? 0}
              cy={yScale(d.vo2Z)}
              r={5}
              fill={VX.series.vo2max}
              fillOpacity={dim('vo2')}
              stroke={VX.dotStroke}
              strokeWidth={2}
              strokeOpacity={dim('vo2')}
            />
          ))}

          {syncedPoint && (
            <>
              <line
                x1={xScale(syncedPoint.date) ?? 0}
                x2={xScale(syncedPoint.date) ?? 0}
                y1={0}
                y2={yMax}
                stroke={VX.crosshair}
                strokeWidth={1}
              />
              {syncedPoint.rhrZ !== null && (
                <circle
                  cx={xScale(syncedPoint.date) ?? 0}
                  cy={yScale(syncedPoint.rhrZ)}
                  r={4}
                  fill={VX.series.restingHr}
                  stroke={VX.dotStroke}
                  strokeWidth={2}
                />
              )}
              {syncedPoint.hrvZ !== null && (
                <circle
                  cx={xScale(syncedPoint.date) ?? 0}
                  cy={yScale(syncedPoint.hrvZ)}
                  r={4}
                  fill={VX.series.hrv}
                  stroke={VX.dotStroke}
                  strokeWidth={2}
                />
              )}
            </>
          )}

          <AxisLeftNumeric scale={yScale} numTicks={5} tickFormat={(v) => fmtSigma(Number(v))} />
          <AxisBottomDate top={yMax} scale={xScale} tickValues={tickValues} />

          <HoverOverlay width={xMax} height={yMax} onMove={handleMouse} onLeave={handleLeave} />
        </Group>
      </svg>
      <ChartTooltip tip={isDirectHover ? tip : null} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip && isDirectHover && (
          <>
            <TooltipHeader date={tip.data.date} />
            <TooltipBody>
              {tip.data.rhrZ !== null && tip.data.rhrMA !== null && (
                <TooltipRow
                  color={VX.series.restingHr}
                  label="RHR (7d)"
                  value={`${Math.round(tip.data.rhrMA)} bpm · ${fmtSigma(tip.data.rhrZ)}`}
                  shape="line"
                  strokeWidth={2.5}
                />
              )}
              {tip.data.hrvZ !== null && tip.data.hrvMA !== null && (
                <TooltipRow
                  color={VX.series.hrv}
                  label="HRV (7d)"
                  value={`${Math.round(tip.data.hrvMA)} ms · ${fmtSigma(tip.data.hrvZ)}`}
                  shape="line"
                  strokeWidth={2.5}
                />
              )}
              {tip.data.vo2max !== null && (
                <TooltipRow
                  color={VX.series.vo2max}
                  label="VO2 Max"
                  value={
                    tip.data.vo2Z !== null
                      ? `${tip.data.vo2max.toFixed(1)} · ${fmtSigma(tip.data.vo2Z)}`
                      : tip.data.vo2max.toFixed(1)
                  }
                  shape="dot"
                />
              )}
            </TooltipBody>
          </>
        )}
      </ChartTooltip>
    </div>
  )
}

// ── Public chart ─────────────────────────────────────────────────────────

export default function FitnessTrendsChart({ params }: { params: SummaryParams }) {
  const { data } = useSuspenseQuery(dailyMetricsQueries.series(params))
  const { ref, width } = useElementSize<HTMLDivElement>()
  const [highlighted, setHighlighted] = useState<string | null>(null)

  const seriesPoints: SeriesPoint[] = useMemo(
    () =>
      data.points.map((p) => ({
        date: p.date,
        restingHr: p.restingHr,
        hrv: p.hrv,
        vo2Max: p.vo2Max,
      })),
    [data.points],
  )

  const chartData = useMemo(() => buildFitnessData(seriesPoints), [seriesPoints])
  const summary = useMemo(() => computeFitnessSummary(seriesPoints), [seriesPoints])

  const headerExtra = (
    <span style={{ fontSize: 12 }}>
      {summary.vo2max !== null && (
        <span style={{ marginRight: 12 }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: VX.series.vo2max }}>
            {summary.vo2max.toFixed(1)}
          </span>
          <span style={{ opacity: 0.5 }}> VO2</span>
        </span>
      )}
      {summary.rhrDelta !== null && (
        <span style={{ marginRight: 12 }}>
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
        </span>
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
      <div ref={ref} style={{ height: 280, width: '100%' }}>
        {width > 0 && (
          <FitnessTrendsInner
            data={chartData}
            width={Math.max(width, 200)}
            height={280}
            highlighted={highlighted}
          />
        )}
      </div>
      <ChartLegend
        items={[
          {
            key: 'rhr',
            label: 'RHR (lower = fitter)',
            color: VX.series.restingHr,
            strokeWidth: 2.5,
          },
          {
            key: 'hrv',
            label: 'HRV (7d avg)',
            color: VX.series.hrv,
            strokeWidth: 2.5,
          },
          { key: 'vo2', label: 'VO2 Max', color: VX.series.vo2max, shape: 'bar' },
        ]}
        highlighted={highlighted}
        onHighlight={setHighlighted}
      />
    </ChartCard>
  )
}
