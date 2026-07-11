import { useSuspenseQuery } from '@tanstack/react-query'
import { useElementSize } from '@mantine/hooks'
import { Card, SimpleGrid, Stack, Text } from '@mantine/core'
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

  if (points.length === 0) {
    return (
      <Card padding="md" withBorder>
        <Text size="sm" c="dimmed">
          No walks in this window — sparklines unlock on first session.
        </Text>
      </Card>
    )
  }

  return (
    <Card padding="md" withBorder>
      <Text fw={600} size="sm" mb="xs">
        At-a-glance trends
      </Text>
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="sm">
        {METRICS.map((m) => (
          <SparkTile key={m.key} metric={m} points={points} />
        ))}
      </SimpleGrid>
    </Card>
  )
}

function SparkTile({ metric, points }: { metric: Metric; points: SeriesPoint[] }) {
  const { ref, width } = useElementSize<HTMLDivElement>()
  const values = points.map((p) => metric.pick(p)).filter((v): v is number => v !== null && v > 0)
  const latest = values.length > 0 ? (values[values.length - 1] ?? null) : null
  const max = values.length > 0 ? Math.max(...values) : 0
  const avg = values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0

  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {metric.label}
      </Text>
      <Text fw={700} size="lg" lh={1.1}>
        {latest !== null ? metric.format(latest) : '—'}
      </Text>
      <div ref={ref} style={{ height: 36, width: '100%' }} aria-label={metric.ariaLabel}>
        {width > 0 ? (
          <LineSparkline
            data={points.map((p) => metric.pick(p) ?? 0)}
            width={Math.max(width, 60)}
            height={36}
            color={metric.color}
          />
        ) : null}
      </div>
      <Text size="xs" c="dimmed">
        avg {metric.format(avg)} · best {metric.format(max)}
      </Text>
    </Stack>
  )
}
