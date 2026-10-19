import { useQuery } from '@tanstack/react-query'
import { Box, Card, Group, Skeleton, Text } from '@mantine/core'
import { useDocumentVisibility } from '@mantine/hooks'
import { durationClock, relativeTime } from 'basalt-ui/format'
import { FACT_SEPARATOR } from '../../lib/text-breaks'
import { walkingPadQueries } from '../../lib/queries/walking-pad'
import {
  lastWalkLabel,
  toLastWalk,
  fmtDuration,
  withKcal,
  withKm,
  withKmh,
  withSteps,
} from './model'
import classes from './record-header.module.css'

function Row({
  dot,
  status,
  facts,
  stats,
}: {
  dot: 'idle' | 'live'
  status: string
  facts: string
  stats: string
}) {
  return (
    <Card data-shot="record-header" data-shot-states="empty">
      <Group justify="space-between" gap="sm" wrap="wrap">
        <Group gap="sm" wrap="nowrap">
          <Box className={dot === 'live' ? `${classes.dot} ${classes.live}` : classes.dot} />
          <Text fw={600} className={classes.status}>
            {status}
          </Text>
          <Text size="sm" c="dimmed" className={classes.facts}>
            {facts}
          </Text>
        </Group>
        <Text size="sm" c="dimmed">
          {stats}
        </Text>
      </Group>
    </Card>
  )
}

/**
 * One row for what the pad is doing: live while a session streams (polled every 2 s while the tab is
 * visible), otherwise the last closed walk. The window never filters it. When the window is empty
 * the headline already says how long ago the last walk was, so the row leaves the age out.
 */
export function RecordHeader({ empty = false }: { empty?: boolean }) {
  const visible = useDocumentVisibility() === 'visible'
  const live = useQuery({
    ...walkingPadQueries.live(),
    refetchInterval: visible ? 2000 : false,
    refetchIntervalInBackground: false,
    staleTime: 0,
  })
  const last = useQuery(walkingPadQueries.list({ page: 1, limit: 1 }))

  if (live.data) {
    const s = live.data
    const paused = s.state === 'paused'
    const pauses =
      s.pause_count > 0 ? [`${s.pause_count}\u00a0${s.pause_count === 1 ? 'pause' : 'pauses'}`] : []
    return (
      <Row
        dot={paused ? 'idle' : 'live'}
        status={paused ? 'Paused' : 'Walking now'}
        facts={[
          durationClock(s.duration_s),
          withKm(s.distance_m),
          `${withKmh(paused ? 0 : s.current_speed_kmh)} now`,
          `avg ${withKmh(s.avg_speed_kmh)}`,
        ].join(FACT_SEPARATOR)}
        stats={[withSteps(s.steps), `${withKcal(s.kcal)}, this walk`, ...pauses].join(
          FACT_SEPARATOR,
        )}
      />
    )
  }
  if (last.isPending) return <Skeleton height={48} radius="md" />
  // A failed live read cannot assert the pad is idle.
  const status = live.isError ? 'Status unknown' : 'Not walking'
  const walk = last.data?.data[0]
  const lookup = toLastWalk({
    isPending: false,
    isError: last.isError,
    endedAt: walk?.ended_at,
  })
  if (lookup.state === 'failed') {
    return <Row dot="idle" status={status} facts="last walk not available" stats="" />
  }
  if (walk === undefined) {
    return <Row dot="idle" status={status} facts="no walk recorded yet" stats="" />
  }
  const label = lastWalkLabel({
    endedAt: walk.ended_at,
    relative: empty ? null : relativeTime,
  })
  return (
    <Row
      dot="idle"
      status={status}
      facts={[
        label,
        withKm(walk.distance_m),
        fmtDuration(walk.duration_s),
        withKmh(walk.avg_speed_kmh),
      ].join(FACT_SEPARATOR)}
      stats={[withSteps(walk.steps), withKcal(walk.kcal)].join(FACT_SEPARATOR)}
    />
  )
}
