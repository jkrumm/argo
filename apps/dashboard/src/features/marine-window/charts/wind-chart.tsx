import { useMemo } from 'react'
import {
  AxisBottomDate,
  AxisLeftNumeric,
  ChartCard,
  ChartFrame,
  ChartLegend,
  ChartTooltip,
  Crosshair,
  curveMonotoneX,
  deriveLegend,
  GridRows,
  Group,
  HoverOverlay,
  LinePath,
  scaleBand,
  scaleLinear,
  TooltipBody,
  TooltipHeader,
  TooltipRow,
  useHoverSync,
  useTooltipStyles,
  VX,
  type SeriesStyle,
} from 'basalt-ui/charts'
import { SERIES } from '../../../lib/series'
import { CHART_HEIGHT, METRIC_TOOLTIPS } from '../constants'
import { fmtDegrees, fmtKnots, windKindLabel, windKindTone } from '../formulas'
import type { HourlyPoint } from '../types'
import { ChartEmpty } from './empty'

const MARGIN = VX.margin
const CHART_ID = 'marine-wind'
const Y_TICKS = 5
/** Height of the windKind baseline ribbon, and its gap above the x-axis. Both are SVG geometry,
 * not CSS spacing — no Mantine spacing token can express either. */
const KIND_STRIP_HEIGHT = 6
const KIND_STRIP_GAP = 4

const LEGEND_SERIES: readonly SeriesStyle[] = [
  { key: 'windSpeed', label: 'Wind speed', color: SERIES.windSpeed, mark: 'line', strokeWidth: 2 },
  { key: 'offshore', label: 'Offshore', color: VX.goodSolid, mark: 'bar', role: 'reference' },
  { key: 'cross-shore', label: 'Cross-shore', color: VX.warnSolid, mark: 'bar', role: 'reference' },
  { key: 'onshore', label: 'Onshore', color: VX.badSolid, mark: 'bar', role: 'reference' },
]

/** [0, max*1.15], floored at `minCeil` so a flat series doesn't collapse the axis to a sliver. */
function niceMax(values: (number | null)[], minCeil: number): number {
  const nums = values.filter((v): v is number => v !== null)
  if (nums.length === 0) return minCeil
  return Math.max(minCeil, Math.max(...nums) * 1.15)
}

export default function WindChart({ hourly }: { hourly: HourlyPoint[] }) {
  return (
    <ChartCard title="Wind" tooltip={METRIC_TOOLTIPS.windChart}>
      {hourly.length === 0 ? (
        <ChartEmpty height={CHART_HEIGHT} message="No hourly data for this day" />
      ) : (
        <WindFrame hourly={hourly} />
      )}
      <ChartLegend items={deriveLegend(LEGEND_SERIES)} chartId={CHART_ID} />
    </ChartCard>
  )
}

function WindFrame({ hourly }: { hourly: HourlyPoint[] }) {
  return (
    <ChartFrame
      series={LEGEND_SERIES}
      chartId={CHART_ID}
      height={CHART_HEIGHT}
      legend={false}
      ariaLabel="Wind speed across the day, with an offshore/cross-shore/onshore strip per hour"
    >
      {(plot) => <WindInner hourly={hourly} width={plot.width} height={plot.height} />}
    </ChartFrame>
  )
}

/**
 * Uses `hourly[].localTime` as the x category, drawn with the SAME `scaleBand` construction and
 * the SAME tick-stride formula as `swell-timeline-chart` (not the `ZonedLine` kind's own scale) —
 * the two charts must land a vertical line on the same instant, which a differently-spaced band
 * scale would silently break even given an identical domain array.
 */
function WindInner({
  hourly,
  width,
  height,
}: {
  hourly: HourlyPoint[]
  width: number
  height: number
}) {
  const xMax = width - MARGIN.left - MARGIN.right
  const yMax = height - MARGIN.top - MARGIN.bottom

  const xScale = useMemo(
    () =>
      scaleBand<string>({ domain: hourly.map((h) => h.localTime), range: [0, xMax], padding: 0 }),
    [hourly, xMax],
  )
  const speedDomain: [number, number] = useMemo(
    () => [
      0,
      niceMax(
        hourly.map((h) => h.windSpeed),
        10,
      ),
    ],
    [hourly],
  )
  const yScale = useMemo(
    () => scaleLinear<number>({ domain: speedDomain, range: [yMax, 0] }),
    [speedDomain, yMax],
  )

  const bandwidth = xScale.bandwidth()
  const bandCenter = (localTime: string) => (xScale(localTime) ?? 0) + bandwidth / 2

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<HourlyPoint>({
      data: hourly,
      chartId: CHART_ID,
      getKey: (d) => d.localTime,
      xScale: bandCenter,
      marginLeft: MARGIN.left,
    })

  // Same stride formula as `swell-timeline-chart`, over the same `hourly` array — identical tick
  // positions and tick count, so a vertical line through both charts lands on the same instant.
  const tickStride = Math.max(1, Math.round(hourly.length / 7))
  const tickValues = hourly.filter((_, i) => i % tickStride === 0).map((h) => h.localTime)

  const stripY = yMax - KIND_STRIP_HEIGHT - KIND_STRIP_GAP

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={yScale} width={xMax} stroke={VX.grid} numTicks={Y_TICKS} />

          {/* windKind baseline ribbon — direction alone is not scannable; the classified kind is
              what the eye needs, so it gets its own always-visible band rather than living only in
              the tooltip. */}
          {hourly.map((point) => (
            <rect
              key={`kind-${point.localTime}`}
              x={xScale(point.localTime) ?? 0}
              y={stripY}
              width={bandwidth}
              height={KIND_STRIP_HEIGHT}
              fill={windKindTone(point.windKind)}
            />
          ))}

          <LinePath<HourlyPoint>
            data={hourly.filter((d) => d.windSpeed !== null)}
            x={(d) => bandCenter(d.localTime)}
            y={(d) => yScale(d.windSpeed ?? 0)}
            stroke={SERIES.windSpeed}
            strokeWidth={2}
            curve={curveMonotoneX}
          />

          {syncedPoint && (
            <>
              <Crosshair x={bandCenter(syncedPoint.localTime)} top={0} bottom={yMax} />
              {syncedPoint.windSpeed !== null && (
                <circle
                  cx={bandCenter(syncedPoint.localTime)}
                  cy={yScale(syncedPoint.windSpeed)}
                  r={4}
                  fill={SERIES.windSpeed}
                  stroke={VX.dotStroke}
                  strokeWidth={2}
                />
              )}
            </>
          )}

          <AxisLeftNumeric scale={yScale} numTicks={Y_TICKS} tickFormat={(v) => `${v}kn`} />
          <AxisBottomDate top={yMax} scale={xScale} tickValues={tickValues} />

          <HoverOverlay width={xMax} height={yMax} onMove={handleMouse} onLeave={handleLeave} />
        </Group>
      </svg>
      <ChartTooltip tip={isDirectHover ? tip : null} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip && isDirectHover && (
          <>
            <TooltipHeader date={tip.data.localTime} />
            <TooltipBody>
              <TooltipRow
                color={SERIES.windSpeed}
                label="Wind speed"
                value={fmtKnots(tip.data.windSpeed)}
                shape="line"
                strokeWidth={2}
              />
              <TooltipRow
                color={VX.muted}
                label="Wind direction"
                value={fmtDegrees(tip.data.windDirection)}
                shape="dot"
              />
              <TooltipRow
                color={windKindTone(tip.data.windKind)}
                label="Kind"
                value={windKindLabel(tip.data.windKind)}
                shape="dot"
              />
              <TooltipRow
                color={VX.muted}
                label="Score"
                value={`${tip.data.score}/100`}
                shape="dot"
              />
            </TooltipBody>
          </>
        )}
      </ChartTooltip>
    </div>
  )
}
