import type { ReactNode } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box, Card, Group, SimpleGrid, Skeleton, Text, ThemeIcon, Tooltip } from '@mantine/core'
import {
  IconArrowDownRight,
  IconArrowRight,
  IconArrowUpRight,
  IconFlame,
  IconInfoCircle,
  IconRoute,
  IconWalk,
} from '@tabler/icons-react'
import { VX } from 'basalt-ui/tokens'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../lib/queries/walking-pad'
import { HERO_TOOLTIPS } from './constants'
import { formatDeltaKmh, formatKm, formatPace, formatPct } from './formatters'

type Direction = 'up' | 'flat' | 'down' | 'na'

function arrowIcon(d: Direction, size = 18) {
  switch (d) {
    case 'up':
      return <IconArrowUpRight size={size} />
    case 'down':
      return <IconArrowDownRight size={size} />
    case 'flat':
      return <IconArrowRight size={size} />
    case 'na':
      return <IconArrowRight size={size} />
  }
}

function colorFor(d: Direction): string {
  switch (d) {
    case 'up':
      return 'green'
    case 'down':
      return 'orange'
    case 'flat':
      return 'gray'
    case 'na':
      return 'gray'
  }
}

function InfoIcon({ tooltip }: { tooltip: string }) {
  return (
    <Tooltip label={tooltip} multiline w={320} withArrow position="bottom-start">
      <Box
        component={IconInfoCircle}
        size={12}
        ml={4}
        style={{ opacity: 0.45, cursor: 'help', verticalAlign: 'middle' }}
      />
    </Tooltip>
  )
}

function HeroCard({
  label,
  tooltip,
  value,
  unit,
  subLabel,
  breakdown,
  color,
  icon,
}: {
  label: string
  tooltip: string
  value: string
  unit?: string
  subLabel?: ReactNode
  breakdown?: string
  color: string
  icon?: ReactNode
}) {
  return (
    <Card py="xs" px="sm" h="100%">
      <Group gap={0} mb={6} justify="space-between">
        <Group gap={6}>
          {icon !== undefined && (
            <ThemeIcon size="sm" variant="light" color={color}>
              {icon}
            </ThemeIcon>
          )}
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            {label}
          </Text>
          <InfoIcon tooltip={tooltip} />
        </Group>
      </Group>
      <Group gap={8} align="baseline" wrap="nowrap">
        <Text style={{ fontSize: VX.text.kpi, fontWeight: 700, lineHeight: 1 }} c={color}>
          {value}
        </Text>
        {unit !== undefined && (
          <Text size="sm" c="dimmed">
            {unit}
          </Text>
        )}
        {subLabel !== undefined && <div style={{ marginLeft: 'auto' }}>{subLabel}</div>}
      </Group>
      {breakdown !== undefined && (
        <Text size="xs" c="dimmed" mt={6}>
          {breakdown}
        </Text>
      )}
    </Card>
  )
}

export function HeroStats({ params }: { params: WalkingPadWindowParams }) {
  const { data } = useSuspenseQuery(walkingPadQueries.heroes(params))

  // ── Volume ─────────────────────────────────────────────────────────────
  const vol = data.volume
  const volDir: Direction =
    vol.direction === 'increasing'
      ? 'up'
      : vol.direction === 'decreasing'
        ? 'down'
        : vol.direction === 'stable'
          ? 'flat'
          : 'na'
  const volColor = colorFor(volDir)
  const volBreakdown =
    vol.direction === 'insufficient'
      ? 'Not enough prior data to compare yet.'
      : vol.deltaPct === null
        ? 'First window with data — no prior to compare.'
        : `${formatPct(vol.deltaPct)} vs prior · prior ${formatKm(vol.priorDistanceM)}`

  // ── Pace ───────────────────────────────────────────────────────────────
  const pace = data.pace
  const paceDir: Direction =
    pace.direction === 'faster'
      ? 'up'
      : pace.direction === 'slower'
        ? 'down'
        : pace.direction === 'stable'
          ? 'flat'
          : 'na'
  const paceColor = colorFor(paceDir)
  const paceBreakdown =
    pace.currentAvgKmh === null
      ? 'No walks in this window.'
      : pace.deltaKmh === null
        ? 'First window — no prior pace to compare.'
        : `${formatDeltaKmh(pace.deltaKmh)} vs prior · prior ${pace.priorAvgKmh !== null ? formatPace(pace.priorAvgKmh, 1) : '—'}`

  // ── Streak ─────────────────────────────────────────────────────────────
  const s = data.streak
  const momentumLabel =
    s.momentum === 'accelerating' ? 'Accelerating' : s.momentum === 'cooling' ? 'Cooling' : 'Steady'
  const streakColor = s.currentDays === 0 ? 'gray' : s.currentDays >= 7 ? 'green' : 'blue'

  return (
    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
      <HeroCard
        label="Volume"
        tooltip={HERO_TOOLTIPS.volume}
        icon={<IconRoute size={14} />}
        value={formatKm(vol.currentDistanceM)}
        color={volColor}
        subLabel={
          <Group gap={2}>
            {arrowIcon(volDir, 14)}
            <Text component="span" size="sm" fw={500} c={volColor}>
              {vol.deltaPct !== null ? formatPct(vol.deltaPct, 0) : ''}
            </Text>
          </Group>
        }
        breakdown={volBreakdown}
      />
      <HeroCard
        label="Pace"
        tooltip={HERO_TOOLTIPS.pace}
        icon={<IconWalk size={14} />}
        value={pace.currentAvgKmh !== null ? formatPace(pace.currentAvgKmh, 1) : '—'}
        color={paceColor}
        subLabel={
          <Group gap={2}>
            {arrowIcon(paceDir, 14)}
            <Text component="span" size="sm" fw={500} c={paceColor}>
              {pace.deltaKmh !== null ? formatDeltaKmh(pace.deltaKmh, 1) : ''}
            </Text>
          </Group>
        }
        breakdown={paceBreakdown}
      />
      <HeroCard
        label="Streak"
        tooltip={HERO_TOOLTIPS.streak}
        icon={<IconFlame size={14} />}
        value={String(s.currentDays)}
        unit={s.currentDays === 1 ? 'day' : 'days'}
        color={streakColor}
        subLabel={s.walkedToday ? '✓ today' : 'walk to extend'}
        breakdown={`Best ${s.bestDays}d · ${momentumLabel}`}
      />
    </SimpleGrid>
  )
}

export function HeroStatsSkeleton() {
  return (
    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} py="xs" px="sm" h="100%">
          <Skeleton height={12} width={100} mb={8} />
          <Skeleton height={32} width={140} mb={8} />
          <Skeleton height={10} width={180} />
        </Card>
      ))}
    </SimpleGrid>
  )
}

export function ChartSkeleton({ height = 320 }: { height?: number }) {
  return (
    <Card py="xs" px="sm">
      <Skeleton height={14} width={140} radius="sm" mb="sm" />
      <Skeleton height={height - 40} radius="sm" />
    </Card>
  )
}
