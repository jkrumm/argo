import { useMemo, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  AxisBottomDate,
  AxisLeftNumeric,
  ChartCard,
  ChartFrame,
  ChartLegend,
  ChartTooltip,
  Crosshair,
  GridRows,
  Group,
  HoverOverlay,
  LinePath,
  Threshold,
  TooltipBody,
  TooltipHeader,
  TooltipRow,
  VX,
  curveMonotoneX,
  deriveLegend,
  scaleLinear,
  scalePoint,
  smartTicks,
  useHoverSync,
  useTooltipStyles,
  type SeriesStyle,
} from 'basalt-ui/charts'
import { dailyMetricsQueries } from '../../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS } from '../constants'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { ChartEmpty } from './empty'

const MARGIN = VX.margin
const CHART_HEIGHT = 280
const CHART_ID = 'stress'
const GRADIENT_ID = 'stress-zone-gradient'

type StressPoint = {
  date: string
  avgStress: number | null
  sleepStress: number | null
}

function stressZoneLabel(v: number): { text: string; color: string } {
  if (v >= 75) return { text: 'High', color: VX.badSolid }
  if (v >= 50) return { text: 'Moderate', color: VX.warnSolid }
  if (v >= 25) return { text: 'Low', color: VX.goodSolid }
  return { text: 'Rest', color: VX.goodSolid }
}

const STRESS_LEGEND_SERIES: readonly SeriesStyle[] = [
  { key: 'avg', label: 'Avg Stress', color: VX.warnSolid, mark: 'bar' },
  {
    key: 'sleep',
    label: 'Overnight',
    color: VX.line2,
    mark: 'line',
    dash: 'dashed',
    strokeWidth: 1.5,
  },
]

export default function StressChart({ params }: { params: SummaryParams }) {
  const { data } = useSuspenseQuery(dailyMetricsQueries.series(params))
  const [highlighted, setHighlighted] = useState<string | null>(null)

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
      tooltip={METRIC_TOOLTIPS.stress}
      extra={
        latest && latest.avgStress !== null && latestZone ? (
          <span style={{ fontSize: 12 }}>
            <span
              style={{
                fontSize: 14,
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
        <StressChartFrame data={chartData} highlighted={highlighted} />
      )}
      <ChartLegend
        items={deriveLegend(STRESS_LEGEND_SERIES)}
        highlighted={highlighted}
        onHighlight={setHighlighted}
      />
    </ChartCard>
  )
}

function StressChartFrame({
  data,
  highlighted,
}: {
  data: StressPoint[]
  highlighted: string | null
}) {
  return (
    <ChartFrame
      series={[]}
      chartId={CHART_ID}
      height={CHART_HEIGHT}
      legend={false}
      ariaLabel="Average and overnight stress with a gradient zone fill"
    >
      {(plot) => (
        <StressChartInner
          data={data}
          width={plot.width}
          height={plot.height}
          highlighted={highlighted}
        />
      )}
    </ChartFrame>
  )
}

/**
 * Bespoke composition — a vertical stress-zone GRADIENT fill under the avg-stress line (not a flat
 * zone band) plus a secondary dashed overnight line. Composes `ChartFrame` + `useHoverSync`
 * directly, the sanctioned escape hatch for a shape no shipped kind's config surface covers.
 */
function StressChartInner({
  data,
  width,
  height,
  highlighted,
}: {
  data: StressPoint[]
  width: number
  height: number
  highlighted: string | null
}) {
  const xMax = width - MARGIN.left - MARGIN.right
  const yMax = height - MARGIN.top - MARGIN.bottom

  const dim = (key: string): number => (highlighted === null || highlighted === key ? 1 : 0.15)

  const xScale = useMemo(
    () =>
      scalePoint<string>({
        domain: data.map((d) => d.date),
        range: [0, xMax],
        padding: 0.3,
      }),
    [data, xMax],
  )

  const yScale = useMemo(() => scaleLinear<number>({ domain: [0, 100], range: [yMax, 0] }), [yMax])

  type AvgValid = StressPoint & { avgStress: number }
  type SleepValid = StressPoint & { sleepStress: number }

  const avgValid = useMemo<AvgValid[]>(
    () => data.filter((d): d is AvgValid => d.avgStress !== null && !Number.isNaN(d.avgStress)),
    [data],
  )
  const sleepValid = useMemo<SleepValid[]>(
    () =>
      data.filter((d): d is SleepValid => d.sleepStress !== null && !Number.isNaN(d.sleepStress)),
    [data],
  )

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<StressPoint>({
      data,
      chartId: CHART_ID,
      getKey: (d) => d.date,
      xScale,
      marginLeft: MARGIN.left,
    })

  const tickValues = useMemo(
    () =>
      smartTicks(
        data.map((d) => d.date),
        xMax,
      ),
    [data, xMax],
  )

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={yScale} width={xMax} stroke={VX.grid} numTicks={5} />

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

          {/* Zone reference lines: 25 (rest/low), 50 (low/moderate), 75 (moderate/high). */}
          <line
            x1={0}
            x2={xMax}
            y1={yScale(25)}
            y2={yScale(25)}
            stroke={VX.goodRef}
            strokeDasharray="4 4"
          />
          <line
            x1={0}
            x2={xMax}
            y1={yScale(50)}
            y2={yScale(50)}
            stroke={VX.warnRef}
            strokeDasharray="4 4"
          />
          <line
            x1={0}
            x2={xMax}
            y1={yScale(75)}
            y2={yScale(75)}
            stroke={VX.badRef}
            strokeDasharray="4 4"
          />

          {/* Avg stress — primary line (theme neutral; the gradient carries the stress semantic). */}
          <LinePath<AvgValid>
            data={avgValid}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScale(d.avgStress)}
            stroke={VX.line}
            strokeWidth={2}
            strokeOpacity={dim('avg')}
            curve={curveMonotoneX}
          />

          {/* Overnight stress — dimmer dashed line, should hug zero on healthy nights. */}
          <LinePath<SleepValid>
            data={sleepValid}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScale(d.sleepStress)}
            stroke={VX.line2}
            strokeWidth={1.5}
            strokeDasharray="4 4"
            strokeOpacity={dim('sleep')}
            curve={curveMonotoneX}
          />

          {syncedPoint &&
            (() => {
              const sx = xScale(syncedPoint.date) ?? 0
              return (
                <>
                  <Crosshair x={sx} top={0} bottom={yMax} />
                  {syncedPoint.avgStress !== null && (
                    <circle
                      cx={sx}
                      cy={yScale(syncedPoint.avgStress)}
                      r={4}
                      fill={VX.line}
                      stroke={VX.dotStroke}
                      strokeWidth={2}
                    />
                  )}
                  {syncedPoint.sleepStress !== null && (
                    <circle
                      cx={sx}
                      cy={yScale(syncedPoint.sleepStress)}
                      r={4}
                      fill={VX.line2}
                      stroke={VX.dotStroke}
                      strokeWidth={2}
                    />
                  )}
                </>
              )
            })()}

          <AxisLeftNumeric scale={yScale} numTicks={5} />
          <AxisBottomDate top={yMax} scale={xScale} tickValues={tickValues} />

          <HoverOverlay width={xMax} height={yMax} onMove={handleMouse} onLeave={handleLeave} />
        </Group>
      </svg>
      <ChartTooltip tip={isDirectHover ? tip : null} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip && isDirectHover && (
          <>
            <TooltipHeader
              date={tip.data.date}
              {...(tip.data.avgStress !== null
                ? {
                    label: stressZoneLabel(tip.data.avgStress).text,
                    labelColor: stressZoneLabel(tip.data.avgStress).color,
                  }
                : {})}
            />
            <TooltipBody>
              {tip.data.avgStress !== null && (
                <TooltipRow
                  color={VX.line}
                  label="Avg Stress"
                  value={String(Math.round(tip.data.avgStress))}
                  shape="line"
                  strokeWidth={2}
                />
              )}
              {tip.data.sleepStress !== null && (
                <TooltipRow
                  color={VX.line2}
                  label="Overnight"
                  value={String(Math.round(tip.data.sleepStress))}
                  shape="line"
                  strokeWidth={1.5}
                  dashed
                />
              )}
            </TooltipBody>
          </>
        )}
      </ChartTooltip>
    </div>
  )
}
