import { useQuery } from '@tanstack/react-query'
import { Box, Card, Group, Skeleton, Text } from '@mantine/core'
import { useDocumentVisibility } from '@mantine/hooks'
import { durationClock, relativeTime } from 'basalt-ui/format'
import { walkingPadQueries } from '../../lib/queries/walking-pad'
import { fmtDuration, withKcal, withKm, withKmh, withSteps } from './model'
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
    <Card data-shot="record-header">
      <Group justify="space-between" gap="sm" wrap="wrap">
        <Group gap="sm" wrap="nowrap">
          <Box className={dot === 'live' ? `${classes.dot} ${classes.live}` : classes.dot} />
          <Text fw={600}>{status}</Text>
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
 * visible), otherwise the last closed walk. The window never filters it.
 */
export function RecordHeader() {
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
    return (
      <Row
        dot={paused ? 'idle' : 'live'}
        status={paused ? 'Paused' : 'Walking now'}
        facts={`${durationClock(s.duration_s)} · ${withKm(s.distance_m)} · ${withKmh(paused ? 0 : s.current_speed_kmh)} now · avg ${withKmh(s.avg_speed_kmh)}`}
        stats={`${withSteps(s.steps)} · ${withKcal(s.kcal)}, this walk${s.pause_count > 0 ? ` · ${s.pause_count}\u00a0${s.pause_count === 1 ? 'pause' : 'pauses'}` : ''}`}
      />
    )
  }
  if (last.isPending) return <Skeleton height={48} radius="md" />
  const walk = last.data?.data[0]
  if (walk === undefined) {
    return <Row dot="idle" status="Not walking" facts="no walk recorded yet" stats="" />
  }
  return (
    <Row
      dot="idle"
      status="Not walking"
      facts={`last walk ${relativeTime(walk.ended_at)} · ${withKm(walk.distance_m)} · ${fmtDuration(walk.duration_s)} · ${withKmh(walk.avg_speed_kmh)}`}
      stats={`${withSteps(walk.steps)} · ${withKcal(walk.kcal)}, last walk`}
    />
  )
}
