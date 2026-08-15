import { ChartCard, MultiLine, type ChartSeries } from 'basalt-ui/charts'
import { SERIES } from '../../../lib/series'
import { CHART_HEIGHT, METRIC_TOOLTIPS } from '../constants'
import type { HourlyPoint } from '../types'
import { ChartEmpty } from './empty'

const fmtCloud = (v: number): string => `${Math.round(v)}%`

const series: ChartSeries<HourlyPoint>[] = [
  {
    key: 'cloudLow',
    label: 'Low cloud',
    color: SERIES.cloudLow,
    mark: 'line',
    strokeWidth: 2,
    getValue: (d) => d.cloudLow,
    formatValue: fmtCloud,
  },
  {
    key: 'cloudMid',
    label: 'Mid cloud',
    color: SERIES.cloudMid,
    mark: 'line',
    strokeWidth: 2,
    getValue: (d) => d.cloudMid,
    formatValue: fmtCloud,
  },
  {
    key: 'cloudHigh',
    label: 'High cloud',
    color: SERIES.cloudHigh,
    mark: 'line',
    strokeWidth: 2,
    getValue: (d) => d.cloudHigh,
    formatValue: fmtCloud,
  },
]

/**
 * Uses `d.localTime` as the x category — same key format as `night-timeline-chart`, so the two
 * charts share one hover-sync cursor under the page's `<ChartHoverSync>`.
 */
export default function CloudLayersChart({ hourly }: { hourly: HourlyPoint[] }) {
  const hasData = hourly.some(
    (d) => d.cloudLow !== null || d.cloudMid !== null || d.cloudHigh !== null,
  )

  return (
    <ChartCard title="Cloud Layers" tooltip={METRIC_TOOLTIPS.cloudLayers}>
      {!hasData ? (
        <ChartEmpty height={CHART_HEIGHT} message="No cloud data for this night" />
      ) : (
        <MultiLine
          ariaLabel="Low, mid and high cloud cover across the night"
          data={hourly}
          height={CHART_HEIGHT}
          chartId="astro-cloud-layers"
          getX={(d) => d.localTime}
          series={series}
          yDomain={[0, 100]}
          formatValue={fmtCloud}
        />
      )}
    </ChartCard>
  )
}
