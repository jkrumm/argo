import { useSuspenseQuery } from '@tanstack/react-query'
import { useElementSize } from '@mantine/hooks'
import { Bars, ChartCard, ChartLegend, useVxTheme, VX } from '@argo/charts'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'
import { ChartEmpty } from './empty'

type Point = {
  date: string // ISO week YYYY-Www — Bars treats it as a categorical x.
  distance_m: number
  duration_s: number
  sessions: number
}

const fmtKm = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`)
const fmtMinutes = (s: number) => `${Math.round(s / 60)} min`

const getValue = (d: Point, key: string): number | null => {
  switch (key) {
    case 'distance':
      return d.distance_m > 0 ? d.distance_m : null
    case 'duration':
      return d.duration_s > 0 ? d.duration_s : null
    default:
      return null
  }
}

export function WeeklyVolumeChart({ params }: { params: WalkingPadWindowParams }) {
  const { data } = useSuspenseQuery(walkingPadQueries.series({ ...params, bucket: 'week' }))
  const { ref, width } = useElementSize<HTMLDivElement>()
  const { line2 } = useVxTheme()

  const points: Point[] = data.points
  const hasData = points.some((p) => p.distance_m > 0)
  const total = points.reduce((s, p) => s + p.distance_m, 0)

  return (
    <ChartCard
      title="Weekly volume"
      subtitle="Is the habit holding week to week?"
      tooltip="ISO-week buckets within the window: total distance (left axis) alongside total duration (right axis, in minutes). Weeks with no walks render as gaps so dips are visible at a glance."
      extra={
        hasData ? (
          <span style={{ fontSize: 12, fontWeight: 600, color: VX.series.walkingDistance }}>
            {(total / 1000).toFixed(1)} km total
          </span>
        ) : null
      }
    >
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
            positiveBars={[
              { key: 'distance', label: 'Distance', color: VX.series.walkingDistance },
              {
                key: 'duration',
                label: 'Duration',
                color: VX.series.walkingDuration,
                axisSide: 'right',
                formatValue: fmtMinutes,
              },
            ]}
            barLayout="grouped"
            leftAxis={{
              domain: 'auto',
              formatTick: fmtKm,
              numTicks: 5,
              autoMaxFloor: 5000,
            }}
            rightAxis={{
              domain: 'auto',
              formatTick: (v) => `${Math.round(v / 60)}m`,
              numTicks: 4,
              autoMaxFloor: 30 * 60,
            }}
            formatValue={(v) => fmtKm(v)}
          />
        ) : null}
      </div>
      <ChartLegend
        items={[
          { key: 'distance', label: 'Distance', color: VX.series.walkingDistance, shape: 'bar' },
          { key: 'duration', label: 'Duration', color: VX.series.walkingDuration, shape: 'bar' },
        ]}
      />
      {/* line2 reserved for future moving-average overlay */}
      <span style={{ display: 'none' }}>{line2}</span>
    </ChartCard>
  )
}
