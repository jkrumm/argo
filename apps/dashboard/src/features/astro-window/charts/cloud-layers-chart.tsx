import {
  CartesianChart,
  ChartCard,
  curveMonotoneX,
  LinePath,
  VX,
  type ChartSeries,
} from 'basalt-ui/charts'
import { SERIES } from '../../../lib/series'
import { CHART_HEIGHT, METRIC_TOOLTIPS } from '../constants'
import { fmtPercent100, hourlyTimeLabel } from '../formulas'
import type { HourlyPoint } from '../types'

const CHART_ID = 'astro-cloud-layers'
// The 0 gridline is not the plot floor — a series pinned at 0% (a common outcome for "low cloud")
// draws as a visible line above the axis rule instead of merging with it.
const Y_DOMAIN: [number, number] = [-4, 100]
const Y_TICKS = 6

type CloudSeriesKey = 'cloudLow' | 'cloudMid' | 'cloudHigh'
type CloudSeriesDef = { key: CloudSeriesKey; label: string; strokeWidth: number; dash?: 'dashed' }

/**
 * Styled as a severity ramp, not three peers: low cloud is the thickest solid line (it ends a
 * night outright), mid a thinner solid line, high a dashed line (cirrus only costs contrast).
 * Distinct DASH, not just hue, so severity reads in greyscale too — the two near-identical
 * oranges the critic flagged were indistinguishable by shape alone.
 */
const SERIES_DEFS: CloudSeriesDef[] = [
  { key: 'cloudLow', label: 'Low cloud', strokeWidth: 2.5 },
  { key: 'cloudMid', label: 'Mid cloud', strokeWidth: 1.5 },
  { key: 'cloudHigh', label: 'High cloud', strokeWidth: 1.5, dash: 'dashed' },
]

/**
 * The single value a series holds for the entire night, or null when it varies (or has any gap).
 * Used to move a flat line's story out of the plot and into the legend.
 */
function constantValue(hourly: HourlyPoint[], key: CloudSeriesKey): number | null {
  const first = hourly[0]?.[key]
  if (first === null || first === undefined) return null
  return hourly.every((d) => d[key] === first) ? first : null
}

function toSeries(def: CloudSeriesDef, hourly: HourlyPoint[]): ChartSeries<HourlyPoint> {
  // A layer that holds one value all night draws as a straight line sitting on a gridline, which
  // reads as chart furniture rather than data — and for low cloud, "0% all night" is the single
  // best piece of news on the page. State it in the legend instead of expecting the eye to find
  // the line.
  const flat = constantValue(hourly, def.key)
  return {
    key: def.key,
    label: def.label,
    color: SERIES[def.key],
    mark: 'line',
    strokeWidth: def.strokeWidth,
    getValue: (d) => d[def.key],
    formatValue: fmtPercent100,
    ...(def.dash !== undefined && { dash: def.dash }),
    ...(flat !== null && { note: `${flat}% all night` }),
  }
}

/**
 * Uses `d.time` (the ISO instant) as the x domain key, drawn by the same `CartesianChart`
 * primitive as `night-timeline-chart` — the two charts must land a vertical line on the same
 * instant, which one chart owning its own scale, margins or tick thinning would silently break
 * even given an identical domain array. `localTime` ("HH:MM") is not unique across the
 * Europe/Berlin DST fall-back night (02:00/02:30 occur twice), so it can only be the tick/tooltip
 * LABEL (via `formatX`/`tooltip.formatHeader`), never the domain key itself.
 *
 * `tooltip.onFollow` is set so this chart still reports its own cloud rows when
 * `night-timeline-chart` (the paired chart, sharing the same cursor) owns the hovered pointer —
 * that pairing is exactly why `night-timeline-chart` no longer hand-authors cloud rows of its own.
 *
 * A series with no data for the whole night is dropped from both the plot and the legend, rather
 * than drawn as an invisible line at a value no one asked about.
 */
export default function CloudLayersChart({ hourly }: { hourly: HourlyPoint[] }) {
  const series = SERIES_DEFS.filter((def) => hourly.some((d) => d[def.key] !== null)).map((def) =>
    toSeries(def, hourly),
  )

  const formatX = hourlyTimeLabel(hourly)

  return (
    <ChartCard
      title="Cloud Layers"
      info={METRIC_TOOLTIPS.cloudLayers}
      state={{ empty: series.length === 0 && 'No cloud data for this night' }}
      placeholderHeight={CHART_HEIGHT}
    >
      <CartesianChart
        data={hourly}
        chartId={CHART_ID}
        getX={(d) => d.time}
        formatX={formatX}
        series={series}
        y={{ domain: Y_DOMAIN, ticks: Y_TICKS, format: (v) => `${v}%` }}
        height={CHART_HEIGHT}
        tooltip={{ formatHeader: (_key, d) => d.localTime, onFollow: true }}
        ariaLabel="Low, mid and high cloud cover across the night"
      >
        {({ visible, xScale, yScale }) =>
          visible.map((s) => (
            <LinePath<HourlyPoint>
              key={s.key}
              data={hourly.filter((d) => s.getValue(d) !== null)}
              x={(d) => xScale(d.time) ?? 0}
              y={(d) => yScale(s.getValue(d) ?? 0)}
              stroke={s.color}
              strokeWidth={s.strokeWidth}
              strokeDasharray={s.dash === 'dashed' ? VX.dashArray : undefined}
              curve={curveMonotoneX}
            />
          ))
        }
      </CartesianChart>
    </ChartCard>
  )
}
