import { useQuery } from '@tanstack/react-query'
import { Box, Card, Group, Skeleton, Text } from '@mantine/core'
import { useDocumentVisibility } from '@mantine/hooks'
import { durationClock } from 'basalt-ui/format'
import { relativeTime } from '../../lib/format'
import { walkingPadQueries } from '../../lib/queries/walking-pad'
import { fmtDuration, fmtKm, fmtKmh } from './model'
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
    <Card py="sm" px="md" data-shot="record-header">
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
        facts={`${durationClock(s.duration_s)} · ${fmtKm(s.distance_m)} km · ${fmtKmh(paused ? 0 : s.current_speed_kmh)} km/h now · avg ${fmtKmh(s.avg_speed_kmh)} km/h`}
        stats={`${s.steps.toLocaleString('en-GB')} steps · ${Math.round(s.kcal)} kcal${s.pause_count > 0 ? ` · ${s.pause_count} ${s.pause_count === 1 ? 'pause' : 'pauses'}` : ''}`}
      />
    )
  }
  if (last.isPending) return <Skeleton height={48} radius="md" />
  const walk = last.data?.data[0]
  if (walk === undefined) {
    return <Row dot="idle" status="Idle" facts="no walk recorded yet" stats="" />
  }
  return (
    <Row
      dot="idle"
      status="Idle"
      facts={`last walk ${relativeTime(walk.ended_at)} · ${fmtKm(walk.distance_m)} km · ${fmtDuration(walk.duration_s)} · ${fmtKmh(walk.avg_speed_kmh)} km/h`}
      stats={`${walk.steps.toLocaleString('en-GB')} steps · ${Math.round(walk.kcal)} kcal`}
    />
  )
}
