import { useSuspenseQuery } from '@tanstack/react-query'
import { StatCard, StatGroup } from 'basalt-ui'
import { LineSparkline } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'

type Metric = {
  key: string
  label: string
  color: string
  format: (v: number) => string
  pick: (p: SeriesPoint) => number | null
  ariaLabel: string
}

type SeriesPoint = {
  date: string
  sessions: number
  duration_s: number
  distance_m: number
  steps: number
  kcal: number
  avg_speed_kmh: number | null
}

const METRICS: Metric[] = [
  {
    key: 'distance',
    label: 'Distance',
    color: VX.line,
    format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} km` : `${Math.round(v)} m`),
    pick: (p) => p.distance_m,
    ariaLabel: 'distance per day',
  },
  {
    key: 'sessions',
    label: 'Sessions',
    color: VX.line,
    format: (v) => String(Math.round(v)),
    pick: (p) => p.sessions,
    ariaLabel: 'sessions per day',
  },
  {
    key: 'duration',
    label: 'Duration',
    color: VX.line,
    format: (v) => `${Math.round(v / 60)}m`,
    pick: (p) => p.duration_s,
    ariaLabel: 'duration per day',
  },
  {
    key: 'pace',
    label: 'Pace',
    color: VX.line,
    format: (v) => `${v.toFixed(2)} km/h`,
    pick: (p) => p.avg_speed_kmh,
    ariaLabel: 'pace per day',
  },
  {
    key: 'steps',
    label: 'Steps',
    color: VX.line,
    format: (v) => v.toLocaleString('en-US'),
    pick: (p) => p.steps,
    ariaLabel: 'steps per day',
  },
  {
    key: 'kcal',
    label: 'Energy',
    color: VX.line,
    format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} k cal` : `${Math.round(v)} kcal`),
    pick: (p) => p.kcal,
    ariaLabel: 'kcal per day',
  },
]

export function SparklineGridChart({ params }: { params: WalkingPadWindowParams }) {
  const { data } = useSuspenseQuery(walkingPadQueries.series({ ...params, bucket: 'day' }))
  const points: SeriesPoint[] = data.points

  return (
    <StatGroup>
      {METRICS.map((m) => {
        const values = points.map((p) => m.pick(p)).filter((v): v is number => v !== null && v > 0)
        const latest = values.length > 0 ? (values[values.length - 1] ?? null) : null
        const max = values.length > 0 ? Math.max(...values) : 0
        const avg = values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0

        return (
          <StatCard
            key={m.key}
            title={m.label}
            value={latest !== null ? m.format(latest) : '—'}
            subtitle={
              points.length === 0
                ? 'No walks in this window'
                : `avg ${m.format(avg)} · best ${m.format(max)}`
            }
            sparkline={({ width, height }) => (
              <LineSparkline
                ariaLabel={m.ariaLabel}
                data={points.map((p) => m.pick(p) ?? 0)}
                width={width}
                height={height}
                color={m.color}
              />
            )}
          />
        )
      })}
    </StatGroup>
  )
}
