import { useMemo } from 'react'
import {
  alpha,
  CartesianChart,
  ChartCard,
  curveMonotoneX,
  Line,
  LinePath,
  TooltipRow,
  VX,
  type ChartSeries,
  type XZoneSpec,
} from 'basalt-ui/charts'
import { SERIES } from '../../../lib/series'
import { CHART_HEIGHT, METRIC_TOOLTIPS } from '../constants'
import { fmtDegrees, fmtPercent100 } from '../formulas'
import type { HourlyPoint, Night } from '../types'
import { ChartEmpty } from './empty'

const CHART_ID = 'astro-timeline'
const Y_DOMAIN: [number, number] = [-20, 20]
const Y_TICKS = 5

const PLOT_SERIES: ChartSeries<HourlyPoint>[] = [
  {
    key: 'core',
    label: 'Galactic core',
    color: SERIES.coreAltitude,
    mark: 'line',
    strokeWidth: 2,
    getValue: (d) => d.coreAltitude,
    // The row pairs the plotted altitude with azimuth, read straight off the hovered datum.
    formatValue: (v, d) => `${fmtDegrees(v)} / ${fmtDegrees(d.coreAzimuth)}`,
  },
  {
    key: 'moon',
    label: 'Moon altitude',
    color: SERIES.moonAltitude,
    mark: 'line',
    dash: 'dashed',
    strokeWidth: 1.5,
    getValue: (d) => d.moonAltitude,
    formatValue: fmtDegrees,
  },
  {
    key: 'sun',
    label: 'Sun altitude',
    color: VX.muted,
    mark: 'line',
    dash: 'dashed',
    strokeWidth: 1,
    role: 'reference',
    getValue: (d) => d.sunAltitude,
    formatValue: fmtDegrees,
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

/**
 * Interpolated plot x for an arbitrary ISO instant, between the two samples straddling it — so the
 * shooting window's arbitrary start/end timestamps are not snapped to the sampling grid.
 */
function timeToX(hourly: HourlyPoint[], iso: string, xAt: (localTime: string) => number): number {
  const target = new Date(iso).getTime()
  const first = hourly[0]
  const last = hourly[hourly.length - 1]
  if (!first || !last) return 0
  if (target <= new Date(first.time).getTime()) return xAt(first.localTime)
  if (target >= new Date(last.time).getTime()) return xAt(last.localTime)
  for (let i = 0; i < hourly.length - 1; i++) {
    const a = hourly[i]!
    const b = hourly[i + 1]!
    const t0 = new Date(a.time).getTime()
    const t1 = new Date(b.time).getTime()
    if (target >= t0 && target <= t1) {
      const frac = t1 === t0 ? 0 : (target - t0) / (t1 - t0)
      const x0 = xAt(a.localTime)
      const x1 = xAt(b.localTime)
      return x0 + (x1 - x0) * frac
    }
  }
  return xAt(last.localTime)
}

/**
 * Bespoke composition — the shooting-window band + a 3-line altitude plot share no shipped kind's
 * config surface, so those marks are drawn by hand over `CartesianChart` (the astro-dark bands
 * ride the `xZones` prop instead). `localTime` ("HH:MM") is the x domain key, shared with
 * `cloud-layers-chart` so a hover in either chart lands on the same instant in the other.
 */
export default function NightTimelineChart({
  hourly,
  night,
}: {
  hourly: HourlyPoint[]
  night: Night
}) {
  const win = night.window

  // Astronomical-dark bands — the faint "when it's actually dark" layer. `align: 'edge'` widens
  // each band by half a step at its terminal bounds, so a run covers the full sampling cell of
  // every sample in it (and a single-sample run still renders) instead of stopping at the
  // outermost sample's center.
  const darkZones: XZoneSpec[] = useMemo(
    () =>
      darkRuns(hourly).map(
        ([start, end]): XZoneSpec => ({
          from: hourly[start]!.localTime,
          to: hourly[end]!.localTime,
          fill: alpha(VX.accent, 0.1),
          align: 'edge',
        }),
      ),
    [hourly],
  )

  return (
    <ChartCard title="Night Timeline" tooltip={METRIC_TOOLTIPS.nightTimeline}>
      {hourly.length === 0 ? (
        <ChartEmpty height={CHART_HEIGHT} message="No hourly data for this night" />
      ) : (
        <CartesianChart
          data={hourly}
          chartId={CHART_ID}
          getX={(d) => d.localTime}
          series={PLOT_SERIES}
          y={{ domain: Y_DOMAIN, ticks: Y_TICKS, format: (v) => `${v}°`, grid: false }}
          xZones={darkZones}
          height={CHART_HEIGHT}
          // The sun is a reference line explaining where the dark bands come from — it carries a
          // tooltip row but never a cursor dot.
          cursorValue={(point, s) => (s.key === 'sun' ? null : s.getValue(point))}
          tooltip={{
            extraRows: (d) => (
              <>
                <TooltipRow
                  color={SERIES.cloudLow}
                  label="Cloud low"
                  value={fmtPercent100(d.cloudLow)}
                  shape="dot"
                />
                <TooltipRow
                  color={SERIES.cloudMid}
                  label="Cloud mid"
                  value={fmtPercent100(d.cloudMid)}
                  shape="dot"
                />
                <TooltipRow
                  color={SERIES.cloudHigh}
                  label="Cloud high"
                  value={fmtPercent100(d.cloudHigh)}
                  shape="dot"
                />
              </>
            ),
          }}
          ariaLabel="Galactic core, moon and sun altitude across the night, with dark and shooting-window bands"
        >
          {({ visible, xScale, yScale, xMax, yMax }) => {
            const xAt = (localTime: string) => xScale(localTime) ?? 0
            const band =
              win === null
                ? null
                : (() => {
                    const a = timeToX(hourly, win.start, xAt)
                    const b = timeToX(hourly, win.end, xAt)
                    return { x: Math.min(a, b), width: Math.abs(b - a) }
                  })()

            return (
              <>
                {/* The recommended shooting window — stronger fill + a top rule, unmistakable.
                    Stays hand-drawn: its start/end are arbitrary ISO instants interpolated
                    between two straddling samples, not `getX` domain keys `xZones` can resolve. */}
                {band !== null && (
                  <>
                    <rect
                      x={band.x}
                      y={0}
                      width={band.width}
                      height={yMax}
                      fill={alpha(VX.accent, 0.22)}
                    />
                    <Line
                      from={{ x: band.x, y: 0 }}
                      to={{ x: band.x + band.width, y: 0 }}
                      stroke={VX.accent}
                      strokeWidth={2}
                    />
                  </>
                )}

                {/* Horizon. */}
                <Line
                  from={{ x: 0, y: yScale(0) }}
                  to={{ x: xMax, y: yScale(0) }}
                  stroke={VX.divider}
                />

                {visible.map((s) => (
                  <LinePath<HourlyPoint>
                    key={s.key}
                    data={hourly}
                    x={(d) => xAt(d.localTime)}
                    y={(d) => yScale(s.getValue(d) ?? 0)}
                    stroke={s.color}
                    strokeWidth={s.strokeWidth}
                    strokeDasharray={s.dash === 'dashed' ? VX.dashArray : undefined}
                    curve={curveMonotoneX}
                  />
                ))}
              </>
            )
          }}
        </CartesianChart>
      )}
    </ChartCard>
  )
}
