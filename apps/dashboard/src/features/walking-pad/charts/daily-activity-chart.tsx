import { useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useElementSize } from '@mantine/hooks'
import { Bars, ChartCard, ChartLegend, useVxTheme } from '@argo/charts'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'
import { METRIC_DEFS, MetricToggle, fmtSteps, type MetricKey } from '../metric-toggle'
import { ChartEmpty } from './empty'

type Point = {
  date: string
  distance_m: number
  sessions: number
  duration_s: number
  steps: number
}

type DailyMetric = {
  pick: (p: Point) => number
  formatTotal: (v: number) => string
  formatAvg: (v: number) => string
  /** Per-day minimum scale ceiling so a near-empty window still shows a usable y-axis. */
  autoMaxFloor: number
}

const DAILY_METRICS: Record<MetricKey, DailyMetric> = {
  distance: {
    pick: (p) => p.distance_m,
    formatTotal: (m) => `${(m / 1000).toFixed(1)} km`,
    formatAvg: (m) => `${(m / 1000).toFixed(2)} km/day`,
    autoMaxFloor: 1000,
  },
  duration: {
    pick: (p) => p.duration_s,
    formatTotal: (s) => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`),
    formatAvg: (s) => `${Math.round(s / 60)} min/day`,
    autoMaxFloor: 1800,
  },
  steps: {
    pick: (p) => p.steps,
    formatTotal: fmtSteps,
    formatAvg: (v) => `${fmtSteps(Math.round(v))} steps/day`,
    autoMaxFloor: 3000,
  },
}

export function DailyActivityChart({ params }: { params: WalkingPadWindowParams }) {
  const { data } = useSuspenseQuery(walkingPadQueries.series({ ...params, bucket: 'day' }))
  const { ref, width } = useElementSize<HTMLDivElement>()
  const { line2 } = useVxTheme()
  const [metricKey, setMetricKey] = useState<MetricKey>('distance')
  const def = METRIC_DEFS[metricKey]
  const metric = DAILY_METRICS[metricKey]

  const points: Point[] = data.points
  const getValue = (d: Point, key: string): number | null => {
    if (key === metricKey) {
      const v = metric.pick(d)
      return v > 0 ? v : null
    }
    if (key === 'sessions') return d.sessions > 0 ? d.sessions : null
    return null
  }

  const hasData = points.some((p) => metric.pick(p) > 0)
  const totalValue = points.reduce((s, p) => s + metric.pick(p), 0)
  const totalSessions = points.reduce((s, p) => s + p.sessions, 0)
  const avgValue = totalValue / Math.max(1, points.length)

  return (
    <ChartCard
      title="Daily activity"
      subtitle="How much did I walk each day?"
      tooltip="Per-UTC-day total of the selected metric (distance, duration, or steps). Empty bars are days with no sessions. The dashed line is the per-day session count on the right axis — useful for spotting days you walked many short sessions vs one long one."
      extra={
        hasData ? (
          <span style={{ fontSize: 12, fontWeight: 600, color: def.color }}>
            {metric.formatTotal(totalValue)} · {totalSessions} sessions
          </span>
        ) : null
      }
    >
      <MetricToggle value={metricKey} onChange={setMetricKey} />
      <div ref={ref} style={{ height: 280, width: '100%' }}>
        {!hasData ? (
          <ChartEmpty height={280} label="No walks in this window" />
        ) : width > 0 ? (
          <Bars<Point>
            data={points}
            width={Math.max(width, 200)}
            height={280}
            chartId="walking-pad-daily-activity"
            getX={(d) => d.date}
            getValue={getValue}
            positiveBars={[{ key: metricKey, label: def.label, color: def.color }]}
            lines={[
              {
                key: 'sessions',
                label: 'Sessions',
                color: line2,
                axisSide: 'right',
                dashed: true,
                strokeWidth: 1.5,
                formatValue: (v) => String(Math.round(v)),
              },
            ]}
            leftAxis={{
              domain: 'auto',
              formatTick: def.format,
              numTicks: 5,
              autoMaxFloor: metric.autoMaxFloor,
            }}
            rightAxis={{
              domain: 'auto',
              formatTick: (v) => String(Math.round(v)),
              numTicks: 4,
              autoMaxFloor: 3,
            }}
            formatValue={def.format}
          />
        ) : null}
      </div>
      <ChartLegend
        items={[
          {
            key: metricKey,
            label: `${def.label} / day`,
            color: def.color,
            shape: 'bar',
          },
          { key: 'sessions', label: 'Sessions', color: line2, dashed: true, strokeWidth: 1.5 },
        ]}
      />
      <span style={{ fontSize: 11, color: 'var(--mantine-color-dimmed)', marginTop: 4 }}>
        {hasData ? `${metric.formatAvg(avgValue)} average across the window.` : ''}
      </span>
    </ChartCard>
  )
}

export function DailyActivityChartSkeleton() {
  return <ChartEmpty height={280} label="Loading…" />
}
