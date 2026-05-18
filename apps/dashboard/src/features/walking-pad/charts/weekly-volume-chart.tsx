import { useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useElementSize } from '@mantine/hooks'
import { Bars, ChartCard, ChartLegend } from '@argo/charts'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'
import { METRIC_DEFS, MetricToggle, fmtSteps, type MetricKey } from '../metric-toggle'
import { ChartEmpty } from './empty'

type Point = {
  date: string // ISO week YYYY-Www — Bars treats it as a categorical x.
  distance_m: number
  duration_s: number
  steps: number
  sessions: number
}

type WeeklyMetric = {
  pick: (p: Point) => number
  formatTotal: (v: number) => string
  formatAvg: (v: number) => string
  /** Per-week minimum scale ceiling — wider than daily because a typical week
   * sums ~5–7× a typical day. */
  autoMaxFloor: number
}

const WEEKLY_METRICS: Record<MetricKey, WeeklyMetric> = {
  distance: {
    pick: (p) => p.distance_m,
    formatTotal: (m) => `${(m / 1000).toFixed(1)} km total`,
    formatAvg: (m) => `${(m / 1000).toFixed(1)} km/week`,
    autoMaxFloor: 5000,
  },
  duration: {
    pick: (p) => p.duration_s,
    formatTotal: (s) => `${(s / 3600).toFixed(1)} h total`,
    formatAvg: (s) => `${(s / 3600).toFixed(1)} h/week`,
    autoMaxFloor: 60 * 60 * 3,
  },
  steps: {
    pick: (p) => p.steps,
    formatTotal: (v) => `${fmtSteps(v)} steps total`,
    formatAvg: (v) => `${fmtSteps(Math.round(v))} steps/week`,
    autoMaxFloor: 15_000,
  },
}

export function WeeklyVolumeChart({ params }: { params: WalkingPadWindowParams }) {
  const { data } = useSuspenseQuery(walkingPadQueries.series({ ...params, bucket: 'week' }))
  const { ref, width } = useElementSize<HTMLDivElement>()
  const [metricKey, setMetricKey] = useState<MetricKey>('distance')
  const def = METRIC_DEFS[metricKey]
  const metric = WEEKLY_METRICS[metricKey]

  const points: Point[] = data.points
  const getValue = (d: Point, key: string): number | null => {
    if (key !== metricKey) return null
    const v = metric.pick(d)
    return v > 0 ? v : null
  }

  const hasData = points.some((p) => metric.pick(p) > 0)
  const totalValue = points.reduce((s, p) => s + metric.pick(p), 0)
  const avgValue = totalValue / Math.max(1, points.length)

  return (
    <ChartCard
      title="Weekly volume"
      subtitle="Is the habit holding week to week?"
      tooltip="ISO-week buckets within the window. Toggle the metric (distance, duration, or steps). Weeks with no walks render as gaps so dips are visible at a glance."
      extra={
        hasData ? (
          <span style={{ fontSize: 12, fontWeight: 600, color: def.color }}>
            {metric.formatTotal(totalValue)}
          </span>
        ) : null
      }
    >
      <MetricToggle value={metricKey} onChange={setMetricKey} />
      <div ref={ref} style={{ height: 280, width: '100%' }}>
        {!hasData ? (
          <ChartEmpty height={280} label="No weekly data in this window." />
        ) : width > 0 ? (
          <Bars<Point>
            data={points}
            width={Math.max(width, 200)}
            height={280}
            chartId="walking-pad-weekly-volume"
            getX={(d) => d.date}
            getValue={getValue}
            positiveBars={[{ key: metricKey, label: def.label, color: def.color }]}
            leftAxis={{
              domain: 'auto',
              formatTick: def.format,
              numTicks: 5,
              autoMaxFloor: metric.autoMaxFloor,
            }}
            formatValue={def.format}
          />
        ) : null}
      </div>
      <ChartLegend
        items={[{ key: metricKey, label: `${def.label} / week`, color: def.color, shape: 'bar' }]}
      />
      <span style={{ fontSize: 11, color: 'var(--mantine-color-dimmed)', marginTop: 4 }}>
        {hasData ? `${metric.formatAvg(avgValue)} average across the window.` : ''}
      </span>
    </ChartCard>
  )
}
