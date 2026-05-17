import { useEffect, useMemo, useState } from 'react'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Badge, Box, Card, Divider, Group, Skeleton, Stack, Text, ThemeIcon } from '@mantine/core'
import {
  IconActivity,
  IconBolt,
  IconShoe,
  IconFlame,
  IconHistory,
  IconRoute,
  IconWalk,
} from '@tabler/icons-react'
import { useDocumentVisibility } from '@mantine/hooks'
import { walkingPadQueries } from '../../lib/queries/walking-pad'
import {
  formatDurationClock,
  formatKcal,
  formatKm,
  formatMeters,
  formatPace,
  formatSteps,
  relativeTime,
} from './formatters'

/**
 * Live WalkingPad session card.
 *
 * Polls `GET /walking-pad/live` every 2 s while the document is visible.
 * Three rendering branches:
 *   - live snapshot exists       → big tiles + current speed
 *   - no live but recent session → "Last walk N min ago" mini-summary
 *   - no history at all          → empty placeholder
 *
 * The card includes an active-elapsed counter that ticks every second between
 * fetches so the timer feels smooth even though the underlying poll is 2 s.
 */
export function LiveCard() {
  const visibility = useDocumentVisibility()
  const isVisible = visibility === 'visible'

  const { data: live } = useQuery({
    ...walkingPadQueries.live(),
    refetchInterval: isVisible ? 2000 : false,
    refetchIntervalInBackground: false,
    staleTime: 0,
  })

  if (live === null || live === undefined) {
    return <LiveCardIdle />
  }
  return <LiveCardActive live={live} />
}

type LiveSnapshot = {
  uuid: string
  started_at: string
  state: 'active' | 'paused' | 'ended'
  duration_s: number
  distance_m: number
  steps: number
  current_speed_kmh: number
  avg_speed_kmh: number
  max_speed_kmh: number
  kcal: number
  pause_count: number
  sample_at: string
  received_at: string
  age_s: number
}

function LiveCardActive({ live }: { live: LiveSnapshot }) {
  // Local timer that ticks every second between fetches so the elapsed
  // counter doesn't visibly freeze.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const elapsedS = useMemo(() => {
    const sampleAt = new Date(live.sample_at).getTime()
    const drift = (now - sampleAt) / 1000
    return Math.max(0, live.duration_s + (drift > 0 && drift < 15 ? drift : 0))
  }, [now, live.duration_s, live.sample_at])

  const isPaused = live.state === 'paused'
  const stale = live.age_s > 6

  return (
    <Card padding="lg" withBorder shadow="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon size="lg" radius="xl" color={isPaused ? 'gray' : 'green'} variant="light">
              {isPaused ? <IconHistory size={20} /> : <IconWalk size={20} />}
            </ThemeIcon>
            <Stack gap={0}>
              <Group gap={6}>
                <Text fw={700} size="md">
                  {isPaused ? 'Paused' : 'Walking now'}
                </Text>
                <PulseDot color={isPaused ? 'gray' : 'green'} active={!isPaused} />
              </Group>
              <Text size="xs" c="dimmed">
                Started {relativeTime(live.started_at)} · sample {live.age_s}s ago
                {stale ? ' (stale)' : ''}
                {live.pause_count > 0 ? ` · ${live.pause_count} pauses` : ''}
              </Text>
            </Stack>
          </Group>
          <SpeedTile speedKmh={isPaused ? 0 : live.current_speed_kmh} />
        </Group>

        <Divider />

        <Group grow gap="md" wrap="wrap">
          <BigTile
            label="Elapsed"
            value={formatDurationClock(elapsedS)}
            icon={<IconActivity size={16} />}
            color="indigo"
            mono
          />
          <BigTile
            label="Distance"
            value={formatKm(live.distance_m)}
            icon={<IconRoute size={16} />}
            color="teal"
          />
          <BigTile
            label="Steps"
            value={formatSteps(live.steps)}
            icon={<IconShoe size={16} />}
            color="yellow"
          />
          <BigTile
            label="Energy"
            value={formatKcal(live.kcal)}
            icon={<IconFlame size={16} />}
            color="orange"
          />
          <BigTile
            label="Avg pace"
            value={formatPace(live.avg_speed_kmh, 1)}
            icon={<IconWalk size={16} />}
            color="blue"
          />
          <BigTile
            label="Peak"
            value={formatPace(live.max_speed_kmh, 1)}
            icon={<IconBolt size={16} />}
            color="grape"
          />
        </Group>
      </Stack>
    </Card>
  )
}

function LiveCardIdle() {
  const { data: list } = useSuspenseQuery(walkingPadQueries.list({ page: 1, limit: 1 }))
  const last = list.data[0]
  if (last === undefined) {
    return (
      <Card padding="lg" withBorder>
        <Group gap="sm">
          <ThemeIcon size="lg" radius="xl" variant="light" color="gray">
            <IconWalk size={20} />
          </ThemeIcon>
          <Stack gap={0}>
            <Text fw={600}>No walks yet</Text>
            <Text size="xs" c="dimmed">
              Hop on the pad — the daemon will surface a live session here within a second.
            </Text>
          </Stack>
        </Group>
      </Card>
    )
  }
  return (
    <Card padding="lg" withBorder>
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon size="lg" radius="xl" variant="light" color="gray">
            <IconHistory size={20} />
          </ThemeIcon>
          <Stack gap={0}>
            <Group gap={6}>
              <Text fw={700}>Idle</Text>
              <Badge color="gray" variant="light" size="sm">
                no live session
              </Badge>
            </Group>
            <Text size="xs" c="dimmed">
              Last walk {relativeTime(last.ended_at)} · {formatKm(last.distance_m)} in{' '}
              {formatDurationClock(last.duration_s)} · avg {formatPace(last.avg_speed_kmh, 1)}
            </Text>
          </Stack>
        </Group>
        <Group gap="lg">
          <MiniStat label="Distance" value={formatMeters(last.distance_m)} color="teal" />
          <MiniStat label="Steps" value={formatSteps(last.steps)} color="yellow" />
          <MiniStat label="Kcal" value={formatKcal(last.kcal)} color="orange" />
        </Group>
      </Group>
    </Card>
  )
}

function SpeedTile({ speedKmh }: { speedKmh: number }) {
  return (
    <Box ta="right" miw={120}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} lh={1}>
        Current speed
      </Text>
      <Group gap={6} justify="flex-end" align="baseline" mt={2}>
        <Text style={{ fontVariantNumeric: 'tabular-nums' }} fw={700} fz={40} lh={1}>
          {speedKmh.toFixed(1)}
        </Text>
        <Text size="sm" c="dimmed">
          km/h
        </Text>
      </Group>
    </Box>
  )
}

function BigTile({
  label,
  value,
  icon,
  color,
  mono = false,
}: {
  label: string
  value: string
  icon: React.ReactNode
  color: string
  mono?: boolean
}) {
  return (
    <Box>
      <Group gap={6} mb={2}>
        <ThemeIcon size="xs" variant="light" color={color}>
          {icon}
        </ThemeIcon>
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          {label}
        </Text>
      </Group>
      <Text
        fw={700}
        fz={22}
        style={mono ? { fontVariantNumeric: 'tabular-nums' } : undefined}
        lh={1.1}
      >
        {value}
      </Text>
    </Box>
  )
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Box>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} lh={1}>
        {label}
      </Text>
      <Text fw={700} fz={18} c={color}>
        {value}
      </Text>
    </Box>
  )
}

function PulseDot({ color, active }: { color: string; active: boolean }) {
  return (
    <>
      {active && (
        <style>{`@keyframes wp-pulse { 0% { box-shadow: 0 0 0 0 var(--mantine-color-${color}-5); } 70% { box-shadow: 0 0 0 6px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }`}</style>
      )}
      <Box
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: `var(--mantine-color-${color}-6)`,
          animation: active ? 'wp-pulse 1.6s infinite' : undefined,
        }}
      />
    </>
  )
}

export function LiveCardSkeleton() {
  return (
    <Card padding="lg" withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Skeleton height={36} width={200} />
          <Skeleton height={36} width={120} />
        </Group>
        <Divider />
        <Group grow>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height={48} />
          ))}
        </Group>
      </Stack>
    </Card>
  )
}
