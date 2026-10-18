import { useMemo } from 'react'
import { ChartCard, Lines, type ChartSeries, type XZoneSpec } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import { SERIES } from '../../../lib/series'
import { CHART_HEIGHT, METRIC_TOOLTIPS } from '../constants'
import {
  fmtAzimuth,
  fmtDegrees,
  fmtShortDay,
  hourlyTicks,
  hourlyTimeLabel,
  windowFact,
  withFacts,
} from '../formulas'
import type { HourlyPoint, Night } from '../types'

const Y_DOMAIN: [number, number] = [-20, 20]
const Y_TICKS = 5

/** A track outside the plot's altitude domain is a gap: it is not drawn, so it has no hover row either. */
const inPlot = (v: number): number | null => (v < Y_DOMAIN[0] || v > Y_DOMAIN[1] ? null : v)

const PLOT_SERIES: ChartSeries<HourlyPoint>[] = [
  {
    key: 'core',
    label: 'Galactic core',
    color: SERIES.coreAltitude,
    strokeWidth: 2,
    getValue: (d) => inPlot(d.coreAltitude),
    // The row pairs the plotted altitude with its bearing, read straight off the hovered datum.
    formatValue: (v, d) => `${fmtDegrees(v)} · ${fmtAzimuth(d.coreAzimuth)}`,
  },
  {
    key: 'moon',
    label: 'Moon altitude',
    color: SERIES.moonAltitude,
    dash: 'dashed',
    strokeWidth: 1.5,
    getValue: (d) => inPlot(d.moonAltitude),
    formatValue: fmtDegrees,
  },
  {
    key: 'sun',
    label: 'Sun altitude',
    color: VX.muted,
    dash: 'dashed',
    strokeWidth: 1,
    role: 'reference',
    getValue: (d) => inPlot(d.sunAltitude),
    formatValue: fmtDegrees,
  },
]

/** The horizon is the 0° altitude line the three tracks cross. */
const HORIZON = [{ value: 0, color: VX.divider }]

/** Contiguous [startIndex, endIndex] runs where `astroDark` is true. */
function darkRuns(hourly: HourlyPoint[]): [number, number][] {
  const runs: [number, number][] = []
  let start: number | null = null
  for (const [i, point] of hourly.entries()) {
    if (point.astroDark && start === null) start = i
    if (!point.astroDark && start !== null) {
      runs.push([start, i - 1])
      start = null
    }
  }
  if (start !== null) runs.push([start, hourly.length - 1])
  return runs
}

/** `iso` as a `Date`, held inside the sampled night so a window that spills past the first or
 * last sample stops at the plot edge instead of being drawn outside it. */
function clampToNight(iso: string, first: Date, last: Date): Date {
  const t = new Date(iso).getTime()
  return new Date(Math.min(last.getTime(), Math.max(first.getTime(), t)))
}

/**
 * Core, moon and sun altitude over one night, with the dark bands and the recommended shooting
 * window behind them. The tracks, legend and tooltip come from `series`; the window is an
 * annotation, drawn from its own two instants rather than from sample rows — with a time x the
 * window's arbitrary start/end land exactly where they are, no interpolation between samples.
 * x is the sample's instant (unique across the Europe/Berlin DST fall-back night, unlike the
 * "HH:MM" `localTime`, which is only the label) and matches `cloud-layers-chart`'s, so a hover in
 * either chart lands on the same instant in the other.
 */
export default function NightTimelineChart({
  hourly,
  night,
  withMiss,
}: {
  hourly: HourlyPoint[]
  night: Night
  /** Append the missed gate beside a window (Forecast); a no-window night always names it. */
  withMiss: boolean
}) {
  const win = night.window
  const fact = windowFact(night, { withMiss })
  const refLines =
    night.coreGateDeg === null
      ? HORIZON
      : [
          ...HORIZON,
          {
            value: night.coreGateDeg,
            color: VX.muted,
            legend: { label: `Core gate ${fmtDegrees(night.coreGateDeg)}` },
          },
        ]

  // Astronomical-dark bands — the faint "when it's actually dark" layer. `align: 'edge'` widens
  // each band by half a step at its terminal bounds, so a run covers the full sampling cell of
  // every sample in it (and a single-sample run still renders).
  const darkZones: XZoneSpec<Date>[] = useMemo(
    () =>
      darkRuns(hourly).map(([start, end]): XZoneSpec<Date> => ({
        from: new Date(hourly[start]!.time),
        to: new Date(hourly[end]!.time),
        fill: alpha(VX.accent, 0.1),
        align: 'edge',
      })),
    [hourly],
  )

  // The recommended shooting window, ruled at both sides by the zone's own `edge`.
  const zones: XZoneSpec<Date>[] = useMemo(() => {
    const first = hourly[0]
    const last = hourly.at(-1)
    if (win === null || first === undefined || last === undefined) return darkZones
    return [
      ...darkZones,
      {
        from: clampToNight(win.start, new Date(first.time), new Date(last.time)),
        to: clampToNight(win.end, new Date(first.time), new Date(last.time)),
        fill: alpha(VX.accent, 0.22),
        edge: { side: 'both', color: VX.accent, width: 2 },
      },
    ]
  }, [darkZones, hourly, win])

  return (
    <ChartCard
      title={`Core, moon and sun altitude · ${fmtShortDay(night.date)}`}
      info={METRIC_TOOLTIPS.nightTimeline}
      {...withFacts(fact)}
      state={{ empty: hourly.length === 0 && 'No hourly data for this night' }}
      placeholderHeight={CHART_HEIGHT}
    >
      <Lines
        ariaLabel="Galactic core, moon and sun altitude across the night, with dark and shooting-window bands"
        data={hourly}
        height={CHART_HEIGHT}
        x={(d) => new Date(d.time)}
        xTicks={hourlyTicks(hourly)}
        formatX={hourlyTimeLabel(hourly)}
        series={PLOT_SERIES}
        y={{ domain: Y_DOMAIN, ticks: Y_TICKS, format: (v) => `${v}°`, grid: false }}
        xZones={zones}
        legend={{ placement: 'header' }}
        refLines={refLines}
        // Cloud low/mid/high are reported by `cloud-layers-chart` (`onFollow: true`) so it can
        // speak for its own series — no hand-authored rows duplicating that data here.
        tooltip={{ formatHeader: (_x, d) => d.localTime }}
      />
    </ChartCard>
  )
}
