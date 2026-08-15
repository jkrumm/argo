import { useMemo } from 'react'
import {
  alpha,
  AxisBottomDate,
  AxisLeftNumeric,
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
import { fmtDegrees, fmtPercent100 } from '../formulas'
import type { HourlyPoint, Night } from '../types'
import { ChartEmpty } from './empty'

const MARGIN = VX.margin
const CHART_ID = 'astro-timeline'
const Y_DOMAIN: [number, number] = [-20, 20]

const LEGEND_SERIES: readonly SeriesStyle[] = [
  { key: 'core', label: 'Galactic core', color: SERIES.coreAltitude, mark: 'line', strokeWidth: 2 },
  {
    key: 'moon',
    label: 'Moon altitude',
    color: SERIES.moonAltitude,
    mark: 'line',
    dash: 'dashed',
    strokeWidth: 1.5,
  },
  {
    key: 'sun',
    label: 'Sun altitude',
    color: VX.muted,
    mark: 'line',
    dash: 'dashed',
    strokeWidth: 1,
    role: 'reference',
  },
]

/** Contiguous [startIndex, endIndex] runs where `astroDark` is true. */
function darkRuns(hourly: HourlyPoint[]): [number, number][] {
  const runs: [number, number][] = []
  let start: number | null = null
  hourly.forEach((point, i) => {
    if (point.astroDark && start === null) start = i
    if (!point.astroDark && start !== null) {
      runs.push([start, i - 1])
      start = null
    }
  })
  if (start !== null) runs.push([start, hourly.length - 1])
  return runs
}

export default function NightTimelineChart({
  hourly,
  night,
}: {
  hourly: HourlyPoint[]
  night: Night
}) {
  return (
    <ChartCard title="Night Timeline" tooltip={METRIC_TOOLTIPS.nightTimeline}>
      {hourly.length === 0 ? (
        <ChartEmpty height={CHART_HEIGHT} message="No hourly data for this night" />
      ) : (
        <NightTimelineFrame hourly={hourly} night={night} />
      )}
      <ChartLegend items={deriveLegend(LEGEND_SERIES)} chartId={CHART_ID} />
    </ChartCard>
  )
}

function NightTimelineFrame({ hourly, night }: { hourly: HourlyPoint[]; night: Night }) {
  return (
    <ChartFrame
      series={LEGEND_SERIES}
      chartId={CHART_ID}
      height={CHART_HEIGHT}
      legend={false}
      ariaLabel="Galactic core, moon and sun altitude across the night, with dark and shooting-window bands"
    >
      {(plot) => (
        <NightTimelineInner hourly={hourly} night={night} width={plot.width} height={plot.height} />
      )}
    </ChartFrame>
  )
}

/**
 * Bespoke composition — twilight/shooting-window bands + a 3-line altitude plot share no shipped
 * kind's config surface. Uses `scaleBand<string>` over `localTime` (not `scaleTime`): every
 * shipped axis primitive (`AxisBottomDate`) is typed for a string-domain scale, and `localTime`
 * strings double as the shared hover-sync key with `cloud-layers-chart` — a continuous time scale
 * would need its own axis rendering and a separate key format to bridge back to it. The shooting
 * window's arbitrary start/end timestamps are placed by linear interpolation between the two
 * straddling samples, so the band is not snapped to the sampling grid.
 */
function NightTimelineInner({
  hourly,
  night,
  width,
  height,
}: {
  hourly: HourlyPoint[]
  night: Night
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
  const yScale = useMemo(() => scaleLinear<number>({ domain: Y_DOMAIN, range: [yMax, 0] }), [yMax])

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

  const runs = useMemo(() => darkRuns(hourly), [hourly])

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<HourlyPoint>({
      data: hourly,
      chartId: CHART_ID,
      getKey: (d) => d.localTime,
      xScale: bandCenter,
      marginLeft: MARGIN.left,
    })

  // Sparse ticks — every-other-hour reads cleanly across a ~7-11h night at chart width.
  const tickStride = Math.max(1, Math.round(hourly.length / 7))
  const tickValues = hourly.filter((_, i) => i % tickStride === 0).map((h) => h.localTime)

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          {/* Astronomical-dark bands — the faint "when it's actually dark" layer. */}
          {runs.map(([start, end]) => {
            const x0 = xScale(hourly[start]!.localTime) ?? 0
            const x1 = (xScale(hourly[end]!.localTime) ?? 0) + bandwidth
            return (
              <rect
                key={`dark-${start}`}
                x={x0}
                y={0}
                width={x1 - x0}
                height={yMax}
                fill={alpha(VX.accent, 0.1)}
              />
            )
          })}

          {/* The recommended shooting window — stronger fill + a top rule, unmistakable. */}
          {night.window &&
            (() => {
              const wx0 = timeToX(night.window.start)
              const wx1 = timeToX(night.window.end)
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

          {/* Horizon. */}
          <Line from={{ x: 0, y: yScale(0) }} to={{ x: xMax, y: yScale(0) }} stroke={VX.divider} />

          <LinePath<HourlyPoint>
            data={hourly}
            x={(d) => bandCenter(d.localTime)}
            y={(d) => yScale(d.coreAltitude)}
            stroke={SERIES.coreAltitude}
            strokeWidth={2}
            curve={curveMonotoneX}
          />
          <LinePath<HourlyPoint>
            data={hourly}
            x={(d) => bandCenter(d.localTime)}
            y={(d) => yScale(d.moonAltitude)}
            stroke={SERIES.moonAltitude}
            strokeWidth={1.5}
            strokeDasharray={VX.dashArray}
            curve={curveMonotoneX}
          />
          <LinePath<HourlyPoint>
            data={hourly}
            x={(d) => bandCenter(d.localTime)}
            y={(d) => yScale(d.sunAltitude)}
            stroke={VX.muted}
            strokeWidth={1}
            strokeDasharray={VX.dashArray}
            curve={curveMonotoneX}
          />

          {syncedPoint && (
            <>
              <Crosshair x={bandCenter(syncedPoint.localTime)} top={0} bottom={yMax} />
              <circle
                cx={bandCenter(syncedPoint.localTime)}
                cy={yScale(syncedPoint.coreAltitude)}
                r={4}
                fill={SERIES.coreAltitude}
                stroke={VX.dotStroke}
                strokeWidth={2}
              />
              <circle
                cx={bandCenter(syncedPoint.localTime)}
                cy={yScale(syncedPoint.moonAltitude)}
                r={4}
                fill={SERIES.moonAltitude}
                stroke={VX.dotStroke}
                strokeWidth={2}
              />
            </>
          )}

          <AxisLeftNumeric scale={yScale} numTicks={5} tickFormat={(v) => `${v}°`} />
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
                color={SERIES.coreAltitude}
                label="Core alt. / az."
                value={`${fmtDegrees(tip.data.coreAltitude)} / ${fmtDegrees(tip.data.coreAzimuth)}`}
                shape="line"
                strokeWidth={2}
              />
              <TooltipRow
                color={SERIES.moonAltitude}
                label="Moon alt."
                value={fmtDegrees(tip.data.moonAltitude)}
                shape="line"
                strokeWidth={1.5}
                dashed
              />
              <TooltipRow
                color={VX.muted}
                label="Sun alt."
                value={fmtDegrees(tip.data.sunAltitude)}
                shape="line"
                strokeWidth={1}
                dashed
              />
              <TooltipRow
                color={SERIES.cloudLow}
                label="Cloud low"
                value={fmtPercent100(tip.data.cloudLow)}
                shape="dot"
              />
              <TooltipRow
                color={SERIES.cloudMid}
                label="Cloud mid"
                value={fmtPercent100(tip.data.cloudMid)}
                shape="dot"
              />
              <TooltipRow
                color={SERIES.cloudHigh}
                label="Cloud high"
                value={fmtPercent100(tip.data.cloudHigh)}
                shape="dot"
              />
            </TooltipBody>
          </>
        )}
      </ChartTooltip>
    </div>
  )
}
