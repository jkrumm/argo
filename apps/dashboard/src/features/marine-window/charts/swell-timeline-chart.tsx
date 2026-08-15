import { useMemo } from 'react'
import {
  alpha,
  AxisBottomDate,
  AxisLeftNumeric,
  AxisRightNumeric,
  ChartCard,
  ChartFrame,
  ChartLegend,
  ChartTooltip,
  Crosshair,
  curveMonotoneX,
  deriveLegend,
  Group,
  HoverOverlay,
  Line,
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
import { fmtDegrees, fmtMetres, fmtSeconds } from '../formulas'
import type { Day, HourlyPoint } from '../types'
import { ChartEmpty } from './empty'

// Widened right inset: this is the one chart in the pair carrying a right-hand axis (swell
// period, seconds) whose tick labels `VX.margin.right` doesn't reserve room for — the shared
// token assumes no right axis and clips them against the card edge. `left` stays exactly
// `VX.margin.left` (via the spread) so this chart keeps its x-axis column-aligned with
// `wind-chart` below it.
const MARGIN = { ...VX.margin, right: 44 }
const CHART_ID = 'marine-swell-timeline'

const LEGEND_SERIES: readonly SeriesStyle[] = [
  {
    key: 'swellHeight',
    label: 'Swell height',
    color: SERIES.swellHeight,
    mark: 'line',
    strokeWidth: 2,
  },
  {
    key: 'swellPeriod',
    label: 'Swell period',
    color: SERIES.swellPeriod,
    mark: 'line',
    dash: 'dashed',
    strokeWidth: 1.5,
  },
]

/** [0, max*1.15], floored at `minCeil` so a flat series doesn't collapse the axis to a sliver. */
function niceMax(values: (number | null)[], minCeil: number): number {
  const nums = values.filter((v): v is number => v !== null)
  if (nums.length === 0) return minCeil
  return Math.max(minCeil, Math.max(...nums) * 1.15)
}

export default function SwellTimelineChart({ hourly, day }: { hourly: HourlyPoint[]; day: Day }) {
  return (
    <ChartCard title="Swell Timeline" tooltip={METRIC_TOOLTIPS.swellTimeline}>
      {hourly.length === 0 ? (
        <ChartEmpty height={CHART_HEIGHT} message="No hourly data for this day" />
      ) : (
        <SwellTimelineFrame hourly={hourly} day={day} />
      )}
      <ChartLegend items={deriveLegend(LEGEND_SERIES)} chartId={CHART_ID} />
    </ChartCard>
  )
}

function SwellTimelineFrame({ hourly, day }: { hourly: HourlyPoint[]; day: Day }) {
  return (
    <ChartFrame
      series={LEGEND_SERIES}
      chartId={CHART_ID}
      height={CHART_HEIGHT}
      legend={false}
      ariaLabel="Swell height and period across the day, with the recommended session window"
    >
      {(plot) => (
        <SwellTimelineInner hourly={hourly} day={day} width={plot.width} height={plot.height} />
      )}
    </ChartFrame>
  )
}

/**
 * Bespoke composition — the session-window band + a dual-axis 2-line plot share no shipped kind's
 * config surface. Uses `scaleBand<string>` over `localTime` (not `scaleTime`): every shipped axis
 * primitive (`AxisBottomDate`) is typed for a string-domain scale, and `localTime` strings double
 * as the shared hover-sync key with `wind-chart` — a continuous time scale would need its own axis
 * rendering and a separate key format to bridge back to it. The session window's arbitrary
 * start/end timestamps are placed by linear interpolation between the two straddling samples, so
 * the band is not snapped to the sampling grid.
 */
function SwellTimelineInner({
  hourly,
  day,
  width,
  height,
}: {
  hourly: HourlyPoint[]
  day: Day
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
  const heightDomain: [number, number] = useMemo(
    () => [
      0,
      niceMax(
        hourly.map((h) => h.swellHeight),
        1,
      ),
    ],
    [hourly],
  )
  const periodDomain: [number, number] = useMemo(
    () => [
      0,
      niceMax(
        hourly.map((h) => h.swellPeriod),
        10,
      ),
    ],
    [hourly],
  )
  const yHeightScale = useMemo(
    () => scaleLinear<number>({ domain: heightDomain, range: [yMax, 0] }),
    [heightDomain, yMax],
  )
  const yPeriodScale = useMemo(
    () => scaleLinear<number>({ domain: periodDomain, range: [yMax, 0] }),
    [periodDomain, yMax],
  )

  const bandwidth = xScale.bandwidth()
  const bandCenter = (localTime: string) => (xScale(localTime) ?? 0) + bandwidth / 2

  /** Interpolated pixel x for an arbitrary ISO instant, between the two samples straddling it. */
  const timeToX = (iso: string): number => {
    const target = new Date(iso).getTime()
    const first = hourly[0]
    const last = hourly[hourly.length - 1]
    if (!first || !last) return 0
    if (target <= new Date(first.time).getTime()) return bandCenter(first.localTime)
    if (target >= new Date(last.time).getTime()) return bandCenter(last.localTime)
    for (let i = 0; i < hourly.length - 1; i++) {
      const a = hourly[i]!
      const b = hourly[i + 1]!
      const t0 = new Date(a.time).getTime()
      const t1 = new Date(b.time).getTime()
      if (target >= t0 && target <= t1) {
        const frac = t1 === t0 ? 0 : (target - t0) / (t1 - t0)
        const x0 = bandCenter(a.localTime)
        const x1 = bandCenter(b.localTime)
        return x0 + (x1 - x0) * frac
      }
    }
    return bandCenter(last.localTime)
  }

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<HourlyPoint>({
      data: hourly,
      chartId: CHART_ID,
      getKey: (d) => d.localTime,
      xScale: bandCenter,
      marginLeft: MARGIN.left,
    })

  // Sparse ticks — every-other-hour reads cleanly across a daylight-length window at chart width.
  const tickStride = Math.max(1, Math.round(hourly.length / 7))
  const tickValues = hourly.filter((_, i) => i % tickStride === 0).map((h) => h.localTime)

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          {/* The recommended session window — the day's answer, unmistakable. */}
          {day.window &&
            (() => {
              const wx0 = timeToX(day.window.start)
              const wx1 = timeToX(day.window.end)
              return (
                <>
                  <rect
                    x={Math.min(wx0, wx1)}
                    y={0}
                    width={Math.abs(wx1 - wx0)}
                    height={yMax}
                    fill={alpha(VX.accent, 0.22)}
                  />
                  <Line
                    from={{ x: Math.min(wx0, wx1), y: 0 }}
                    to={{ x: Math.max(wx0, wx1), y: 0 }}
                    stroke={VX.accent}
                    strokeWidth={2}
                  />
                </>
              )
            })()}

          <LinePath<HourlyPoint>
            data={hourly.filter((d) => d.swellHeight !== null)}
            x={(d) => bandCenter(d.localTime)}
            y={(d) => yHeightScale(d.swellHeight ?? 0)}
            stroke={SERIES.swellHeight}
            strokeWidth={2}
            curve={curveMonotoneX}
          />
          <LinePath<HourlyPoint>
            data={hourly.filter((d) => d.swellPeriod !== null)}
            x={(d) => bandCenter(d.localTime)}
            y={(d) => yPeriodScale(d.swellPeriod ?? 0)}
            stroke={SERIES.swellPeriod}
            strokeWidth={1.5}
            strokeDasharray={VX.dashArray}
            curve={curveMonotoneX}
          />

          {syncedPoint && (
            <>
              <Crosshair x={bandCenter(syncedPoint.localTime)} top={0} bottom={yMax} />
              {syncedPoint.swellHeight !== null && (
                <circle
                  cx={bandCenter(syncedPoint.localTime)}
                  cy={yHeightScale(syncedPoint.swellHeight)}
                  r={4}
                  fill={SERIES.swellHeight}
                  stroke={VX.dotStroke}
                  strokeWidth={2}
                />
              )}
              {syncedPoint.swellPeriod !== null && (
                <circle
                  cx={bandCenter(syncedPoint.localTime)}
                  cy={yPeriodScale(syncedPoint.swellPeriod)}
                  r={4}
                  fill={SERIES.swellPeriod}
                  stroke={VX.dotStroke}
                  strokeWidth={2}
                />
              )}
            </>
          )}

          <AxisLeftNumeric scale={yHeightScale} numTicks={5} tickFormat={(v) => `${v}m`} />
          <AxisRightNumeric
            scale={yPeriodScale}
            left={xMax}
            numTicks={5}
            tickFormat={(v) => `${v}s`}
          />
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
                color={SERIES.swellHeight}
                label="Swell height"
                value={fmtMetres(tip.data.swellHeight)}
                shape="line"
                strokeWidth={2}
              />
              <TooltipRow
                color={SERIES.swellPeriod}
                label="Swell period"
                value={fmtSeconds(tip.data.swellPeriod)}
                shape="line"
                strokeWidth={1.5}
                dashed
              />
              <TooltipRow
                color={VX.muted}
                label="Swell direction"
                value={fmtDegrees(tip.data.swellDirection)}
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
