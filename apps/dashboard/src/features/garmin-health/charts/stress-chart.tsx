import { useMemo } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  CartesianChart,
  ChartCard,
  LinePath,
  Threshold,
  VX,
  curveMonotoneX,
  type ChartSeries,
} from 'basalt-ui/charts'
import { dailyMetricsQueries } from '../../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS } from '../constants'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { ChartEmpty } from './empty'

const CHART_HEIGHT = 280
const CHART_ID = 'stress'
const GRADIENT_ID = 'stress-zone-gradient'

type StressPoint = {
  date: string
  avgStress: number | null
  sleepStress: number | null
}

type AvgValid = StressPoint & { avgStress: number }
type SleepValid = StressPoint & { sleepStress: number }

function stressZoneLabel(v: number): { text: string; color: string } {
  if (v >= 75) return { text: 'High', color: VX.badSolid }
  if (v >= 50) return { text: 'Moderate', color: VX.warnSolid }
  if (v >= 25) return { text: 'Low', color: VX.goodSolid }
  return { text: 'Rest', color: VX.goodSolid }
}

const fmtStress = (v: number): string => String(Math.round(v))

const STRESS_SERIES: ChartSeries<StressPoint>[] = [
  {
    key: 'avg',
    label: 'Avg Stress',
    color: VX.line,
    mark: 'line',
    strokeWidth: 2,
    getValue: (d) => d.avgStress,
    formatValue: fmtStress,
  },
  {
    key: 'sleep',
    label: 'Overnight',
    color: VX.line2,
    mark: 'line',
    dash: 'dashed',
    strokeWidth: 1.5,
    getValue: (d) => d.sleepStress,
    formatValue: fmtStress,
  },
]

/** Zone boundaries: 25 (rest/low), 50 (low/moderate), 75 (moderate/high). */
const ZONE_LINES = [
  { value: 25, color: VX.goodRef, dashed: true },
  { value: 50, color: VX.warnRef, dashed: true },
  { value: 75, color: VX.badRef, dashed: true },
]

export default function StressChart({ params }: { params: SummaryParams }) {
  const { data } = useSuspenseQuery(dailyMetricsQueries.series(params))

  const chartData = useMemo<StressPoint[]>(
    () =>
      applyVisibilityFilter(
        data.points
          .filter((p) => p.stress !== null)
          .map((p) => ({
            date: p.date,
            avgStress: p.stress,
            sleepStress: p.avgSleepStress,
          })),
        (p) => p.date,
      ),
    [data],
  )

  const latest = chartData[chartData.length - 1]
  const latestZone = latest && latest.avgStress !== null ? stressZoneLabel(latest.avgStress) : null

  return (
    <ChartCard
      title="Stress Levels"
      subtitle="How calm was my day?"
      info={METRIC_TOOLTIPS.stress}
      actions={
        latest && latest.avgStress !== null && latestZone ? (
          <span style={{ fontSize: VX.text.xs }}>
            <span
              style={{
                fontSize: VX.text.md,
                fontWeight: 600,
                color: latestZone.color,
              }}
            >
              {Math.round(latest.avgStress)}
            </span>
            <span style={{ opacity: 0.5 }}> {latestZone.text}</span>
          </span>
        ) : null
      }
    >
      {chartData.length === 0 ? (
        <ChartEmpty height={CHART_HEIGHT} />
      ) : (
        <StressPlot data={chartData} />
      )}
    </ChartCard>
  )
}

/**
 * The vertical stress-zone GRADIENT under the avg-stress line (not a flat zone band) is why this
 * chart draws its own marks instead of reaching for a shipped kind.
 */
function StressPlot({ data }: { data: StressPoint[] }) {
  const avgValid = useMemo<AvgValid[]>(
    () => data.filter((d): d is AvgValid => d.avgStress !== null && !Number.isNaN(d.avgStress)),
    [data],
  )
  const sleepValid = useMemo<SleepValid[]>(
    () =>
      data.filter((d): d is SleepValid => d.sleepStress !== null && !Number.isNaN(d.sleepStress)),
    [data],
  )

  return (
    <CartesianChart
      data={data}
      chartId={CHART_ID}
      getX={(d) => d.date}
      series={STRESS_SERIES}
      y={{ domain: [0, 100], ticks: 5 }}
      refLines={ZONE_LINES}
      height={CHART_HEIGHT}
      tooltip={{ label: (d) => (d.avgStress === null ? null : stressZoneLabel(d.avgStress)) }}
      ariaLabel="Average and overnight stress with a gradient zone fill"
    >
      {({ xScale, yScale, yMax, visible, highlighted }) => {
        const dim = (key: string): number =>
          highlighted === null || highlighted === key ? 1 : 0.15
        const avg = visible.find((s) => s.key === 'avg')
        const sleep = visible.find((s) => s.key === 'sleep')

        return (
          <>
            {avg && (
              <>
                {/* Vertical gradient mapped to stress zones (userSpaceOnUse so each
                    pixel of y-range has its own color). Stops are placed at the
                    25/50/75 zone boundaries: green → yellow → orange → red. */}
                <defs>
                  <linearGradient
                    id={GRADIENT_ID}
                    gradientUnits="userSpaceOnUse"
                    x1={0}
                    y1={yScale(100)}
                    x2={0}
                    y2={yScale(0)}
                  >
                    <stop offset="0%" stopColor={VX.badSolid} stopOpacity={0.45} />
                    <stop offset="25%" stopColor={VX.badSolid} stopOpacity={0.3} />
                    <stop offset="50%" stopColor={VX.warnSolid} stopOpacity={0.28} />
                    <stop offset="75%" stopColor={VX.warnSolid} stopOpacity={0.15} />
                    <stop offset="100%" stopColor={VX.goodSolid} stopOpacity={0.12} />
                  </linearGradient>
                </defs>

                {/* Gradient-filled area under avg_stress. Threshold renders both
                    above- and below-area; clipBelow at yMax (zero) gives us a true
                    area-under-the-curve fill. */}
                <Threshold<AvgValid>
                  id={`${CHART_ID}-area`}
                  data={avgValid}
                  x={(d) => xScale(d.date) ?? 0}
                  y0={() => yScale(0)}
                  y1={(d) => yScale(d.avgStress)}
                  clipAboveTo={0}
                  clipBelowTo={yMax}
                  curve={curveMonotoneX}
                  belowAreaProps={{
                    fill: `url(#${GRADIENT_ID})`,
                    fillOpacity: dim('avg'),
                  }}
                  aboveAreaProps={{
                    fill: `url(#${GRADIENT_ID})`,
                    fillOpacity: dim('avg'),
                  }}
                />

                {/* Avg stress — primary line (theme neutral; the gradient carries the stress semantic). */}
                <LinePath<AvgValid>
                  data={avgValid}
                  x={(d) => xScale(d.date) ?? 0}
                  y={(d) => yScale(d.avgStress)}
                  stroke={avg.color}
                  strokeWidth={avg.strokeWidth}
                  strokeOpacity={dim('avg')}
                  curve={curveMonotoneX}
                />
              </>
            )}

            {/* Overnight stress — dimmer dashed line, should hug zero on healthy nights. */}
            {sleep && (
              <LinePath<SleepValid>
                data={sleepValid}
                x={(d) => xScale(d.date) ?? 0}
                y={(d) => yScale(d.sleepStress)}
                stroke={sleep.color}
                strokeWidth={sleep.strokeWidth}
                strokeDasharray="4 4"
                strokeOpacity={dim('sleep')}
                curve={curveMonotoneX}
              />
            )}
          </>
        )
      }}
    </CartesianChart>
  )
}
