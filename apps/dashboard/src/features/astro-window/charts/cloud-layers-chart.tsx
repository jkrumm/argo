import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { SERIES } from '../../../lib/series'
import { CHART_HEIGHT, METRIC_TOOLTIPS } from '../constants'
import {
  flatLayersNote,
  fmtPercent,
  fmtShortDay,
  hourlyTicks,
  hourlyTimeLabel,
  lowCloudStat,
  withFacts,
} from '../formulas'
import type { HourlyPoint, Night } from '../types'

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
 * A layer's value is printed in one place each: low in the headline, and every layer in the tooltip
 * at the cursor. The legend and the line ends only name the layer, so a series carries no `note`
 * (the legend and the tooltip row both print it).
 */
function toSeries(def: CloudSeriesDef): ChartSeries<HourlyPoint> {
  return {
    key: def.key,
    label: def.label,
    color: SERIES[def.key],
    strokeWidth: def.strokeWidth,
    getValue: (d) => d[def.key],
    formatValue: fmtPercent,
    ...(def.dash !== undefined && { dash: def.dash }),
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
  night,
}: {
  hourly: HourlyPoint[]
  night: Night
}) {
  const stat = lowCloudStat(night, undefined)
  const series = SERIES_DEFS.filter((def) => hourly.some((d) => d[def.key] !== null)).map((def) =>
    toSeries(def),
  )

  return (
    <ChartCard
      title={`Cloud cover by layer · ${fmtShortDay(night.date)}`}
      info={METRIC_TOOLTIPS.cloudLayers}
      subtitle={flatLayersNote(hourly) ?? undefined}
      {...withFacts(
        stat === null ? null : { value: stat.value, unit: stat.unit, period: stat.basis },
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
        y={{ domain: Y_DOMAIN, ticks: Y_TICKS, format: fmtPercent }}
        tooltip={{ formatHeader: (_x, d) => d.localTime, onFollow: true }}
      />
    </ChartCard>
  )
}
