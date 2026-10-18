import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { percent } from 'basalt-ui/format'
import { SERIES } from '../../../lib/series'
import { CHART_HEIGHT, METRIC_TOOLTIPS } from '../constants'
import { fmtShortDay, hourlyTicks, hourlyTimeLabel, peakLowCloud, withFacts } from '../formulas'
import type { HourlyPoint } from '../types'

// The 0 gridline is not the plot floor — a series pinned at 0% (a common outcome for "low cloud")
// draws as a visible line above the axis rule instead of merging with it.
const Y_DOMAIN: [number, number] = [-4, 100]
const Y_TICKS = 6

type CloudSeriesKey = 'cloudLow' | 'cloudMid' | 'cloudHigh'
type CloudSeriesDef = { key: CloudSeriesKey; label: string; strokeWidth: number; dash?: 'dashed' }

/**
 * Styled as a severity ramp, not three peers: low cloud is the thickest solid line (the heaviest
 * score factor — no layer is a gate), mid a thinner solid line, high a dashed line (cirrus only
 * costs contrast).
 * Distinct DASH, not just hue, so severity reads in greyscale too — mid and high cloud are
 * near-identical oranges that shape alone would not separate.
 */
const SERIES_DEFS: CloudSeriesDef[] = [
  { key: 'cloudLow', label: 'Low', strokeWidth: 2.5 },
  { key: 'cloudMid', label: 'Mid', strokeWidth: 1.5 },
  { key: 'cloudHigh', label: 'High', strokeWidth: 1.5, dash: 'dashed' },
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
  // is easy to read as chart furniture — and for low cloud, "0% all night" is the single best
  // piece of news on the page. The line stays plotted (it is still data, and the legend toggle
  // needs its entry); the legend note states the finding in words.
  const flat = constantValue(hourly, def.key)
  return {
    key: def.key,
    label: def.label,
    color: SERIES[def.key],
    strokeWidth: def.strokeWidth,
    getValue: (d) => d[def.key],
    formatValue: (v) => percent(v, { input: 'percent' }),
    ...(def.dash !== undefined && { dash: def.dash }),
    ...(flat !== null && { note: `${flat}% all night` }),
  }
}

/**
 * x is the sample's instant as a `Date` (proportional time), drawn on the same x values as
 * `night-timeline-chart` — the two charts share one cursor and must land a vertical line on the
 * same instant. Instants are unique across the Europe/Berlin DST fall-back night, when the
 * "HH:MM" `localTime` (02:00/02:30 twice) is not; `localTime` is only the tick and tooltip
 * LABEL, via `hourlyTimeLabel` / `tooltip.formatHeader`.
 *
 * `tooltip.onFollow` is set so this chart still reports its own cloud rows when
 * `night-timeline-chart` (the paired chart, sharing the same cursor) owns the hovered pointer —
 * that pairing is exactly why `night-timeline-chart` no longer hand-authors cloud rows of its own.
 *
 * A series with no data for the whole night is dropped from both the plot and the legend, rather
 * than drawn as an invisible line at a value no one asked about.
 */
export default function CloudLayersChart({
  hourly,
  date,
}: {
  hourly: HourlyPoint[]
  date: string
}) {
  const peak = peakLowCloud(hourly)
  const series = SERIES_DEFS.filter((def) => hourly.some((d) => d[def.key] !== null)).map((def) =>
    toSeries(def, hourly),
  )

  return (
    <ChartCard
      title={`Cloud cover by layer · ${fmtShortDay(date)}`}
      info={METRIC_TOOLTIPS.cloudLayers}
      {...withFacts(
        peak === null
          ? null
          : {
              value: `${peak.pct} %`,
              unit: 'peak low cloud',
              period: peak.dark ? 'during astronomical dark' : 'over the night',
            },
      )}
      state={{ empty: series.length === 0 && 'No cloud data for this night' }}
      placeholderHeight={CHART_HEIGHT}
    >
      <Lines
        ariaLabel="Low, mid and high cloud cover across the night"
        data={hourly}
        height={CHART_HEIGHT}
        x={(d) => new Date(d.time)}
        xTicks={hourlyTicks(hourly)}
        formatX={hourlyTimeLabel(hourly)}
        series={series}
        y={{ domain: Y_DOMAIN, ticks: Y_TICKS, format: (v) => `${v}%` }}
        tooltip={{ formatHeader: (_x, d) => d.localTime, onFollow: true }}
      />
    </ChartCard>
  )
}
