import { useSuspenseQuery } from '@tanstack/react-query'
import { useElementSize } from '@mantine/hooks'
import { Bars, ChartCard, ChartLegend, useVxTheme, VX } from '@argo/charts'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'
import { ChartEmpty } from './empty'

type Point = {
  date: string
  distance_m: number
  sessions: number
  duration_s: number
}

const fmtKm = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`)

const getValue = (d: Point, key: string): number | null => {
  switch (key) {
    case 'distance':
      return d.distance_m > 0 ? d.distance_m : null
    case 'sessions':
      return d.sessions > 0 ? d.sessions : null
    default:
      return null
  }
}

export function DailyActivityChart({ params }: { params: WalkingPadWindowParams }) {
  const { data } = useSuspenseQuery(walkingPadQueries.series({ ...params, bucket: 'day' }))
  const { ref, width } = useElementSize<HTMLDivElement>()
  const { line2 } = useVxTheme()

  const points: Point[] = data.points
  const hasData = points.some((p) => p.distance_m > 0)
  const totalKm = points.reduce((s, p) => s + p.distance_m, 0) / 1000
  const totalSessions = points.reduce((s, p) => s + p.sessions, 0)

  return (
    <ChartCard
      title="Daily activity"
      subtitle="How much did I walk each day?"
      tooltip="Distance walked per UTC day across the window. Empty bars are days with no sessions. The dashed line is the per-day session count on the right axis — useful for spotting days you walked many short sessions vs one long one."
      extra={
        hasData ? (
          <span style={{ fontSize: 12, fontWeight: 600, color: VX.series.walkingDistance }}>
            {totalKm.toFixed(1)} km · {totalSessions} sessions
          </span>
        ) : null
      }
    >
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
            positiveBars={[
              { key: 'distance', label: 'Distance', color: VX.series.walkingDistance },
            ]}
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
            leftAxis={{ domain: 'auto', formatTick: fmtKm, numTicks: 5, autoMaxFloor: 1000 }}
            rightAxis={{
              domain: 'auto',
              formatTick: (v) => String(Math.round(v)),
              numTicks: 4,
              autoMaxFloor: 3,
            }}
            formatValue={(v) => fmtKm(v)}
          />
        ) : null}
      </div>
      <ChartLegend
        items={[
          {
            key: 'distance',
            label: 'Distance / day',
            color: VX.series.walkingDistance,
            shape: 'bar',
          },
          { key: 'sessions', label: 'Sessions', color: line2, dashed: true, strokeWidth: 1.5 },
        ]}
      />
      <span style={{ fontSize: 11, color: 'var(--mantine-color-dimmed)', marginTop: 4 }}>
        {hasData
          ? `${(totalKm / Math.max(1, points.length)).toFixed(2)} km/day average across the window.`
          : ''}
      </span>
    </ChartCard>
  )
}

export function DailyActivityChartSkeleton() {
  return <ChartEmpty height={280} label="Loading…" />
}
