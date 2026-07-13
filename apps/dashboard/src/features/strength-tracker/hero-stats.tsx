import { useSuspenseQuery } from '@tanstack/react-query'
import { Box, Card, Group, SimpleGrid, Skeleton, Stack, Text, Tooltip } from '@mantine/core'
import { IconInfoCircle } from '@tabler/icons-react'
import { strengthQueries, type StrengthQueryParams } from '../../lib/queries/strength'
import { METRIC_TOOLTIPS, ZONE_COLORS } from './constants'
import {
  balanceColor,
  balanceLabel,
  balanceSymbol,
  directionArrow,
  directionColor,
  exerciseLabel,
  loadQualityColor,
  loadQualityLabel,
  momentumLabel,
  readinessColor,
} from './formulas'

function InfoIcon({ tooltip }: { tooltip: string }) {
  return (
    <Tooltip label={tooltip} multiline w={320} withArrow position="bottom-start">
      <Box component="span" ml={4} style={{ display: 'inline-block', verticalAlign: 'middle' }}>
        <IconInfoCircle size={12} style={{ opacity: 0.45, cursor: 'help' }} />
      </Box>
    </Tooltip>
  )
}

function HeroCard({
  label,
  tooltip,
  value,
  unit,
  color,
  subLabel,
  breakdown,
}: {
  label: string
  tooltip: string
  value: string
  unit?: string
  color: string
  subLabel?: string
  breakdown?: string
}) {
  return (
    <Card padding="md" h="100%">
      <Group gap={0} mb={6}>
        <Text size="xs" c="dimmed">
          {label}
        </Text>
        <InfoIcon tooltip={tooltip} />
      </Group>
      <Group gap={8} align="baseline">
        <Text style={{ fontSize: 32, fontWeight: 700, lineHeight: 1, color }}>{value}</Text>
        {unit !== undefined && unit.length > 0 && (
          <Text size="sm" c="dimmed">
            {unit}
          </Text>
        )}
        {subLabel !== undefined && subLabel.length > 0 && (
          <Text size="sm" fw={500} style={{ color }}>
            {subLabel}
          </Text>
        )}
      </Group>
      {breakdown !== undefined && breakdown.length > 0 && (
        <Text size="xs" c="dimmed" mt={6}>
          {breakdown}
        </Text>
      )}
    </Card>
  )
}

export function HeroStats({ params }: { params: StrengthQueryParams }) {
  const { data } = useSuspenseQuery(strengthQueries.heroes(params))

  // ── Strength direction ────────────────────────────────────────────────
  const dir = data.strengthDirection
  const dirColor = directionColor(dir.direction)
  const dirSub = dir.leaderExercise !== null ? exerciseLabel(dir.leaderExercise) : ''
  const dirBreakdown = [
    dir.leaderVelocityPctPerMonth !== null
      ? `${dir.leaderVelocityPctPerMonth > 0 ? '+' : ''}${dir.leaderVelocityPctPerMonth.toFixed(1)}%/mo`
      : null,
    momentumLabel(dir.momentumSign),
  ]
    .filter((v): v is string => v !== null && v.length > 0)
    .join(' · ')

  // ── Load quality ──────────────────────────────────────────────────────
  const lq = data.loadQuality
  const lqColor = loadQualityColor(lq.score)
  const lqBreakdown =
    lq.dragComponent !== null
      ? `Drag: ${lq.dragComponent}`
      : [
          lq.latestInol !== null ? `INOL ${lq.latestInol.toFixed(2)}` : null,
          lq.latestAcwr !== null ? `ACWR ${lq.latestAcwr.toFixed(2)}` : null,
        ]
          .filter((v): v is string => v !== null)
          .join(' · ')

  // ── Third card: readiness if available, else balance ─────────────────
  const readiness = data.readiness
  const balance = data.balance

  return (
    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
      <HeroCard
        label="Strength Direction"
        tooltip={METRIC_TOOLTIPS.heroStrength}
        value={directionArrow(dir.direction)}
        color={dirColor}
        subLabel={dirSub}
        breakdown={dirBreakdown.length > 0 ? dirBreakdown : undefined}
      />
      <HeroCard
        label="Load Quality"
        tooltip={METRIC_TOOLTIPS.heroLoadQuality}
        value={String(Math.round(lq.score))}
        color={lqColor}
        subLabel={loadQualityLabel(lq.verdict)}
        breakdown={lqBreakdown.length > 0 ? lqBreakdown : undefined}
      />
      {readiness !== null ? (
        <HeroCard
          label="Readiness"
          tooltip={METRIC_TOOLTIPS.heroReadiness}
          value={readiness.score !== null ? String(Math.round(readiness.score)) : '—'}
          color={readiness.score !== null ? readinessColor(readiness.score) : ZONE_COLORS.neutral}
          subLabel={readiness.verdict}
          breakdown={readiness.driver ?? undefined}
        />
      ) : (
        <HeroCard
          label="Balance"
          tooltip={METRIC_TOOLTIPS.heroBalance}
          value={balanceSymbol(balance.status)}
          color={balanceColor(balance.status)}
          subLabel={balanceLabel(balance.status)}
          breakdown={
            balance.worstPair !== null
              ? `${balance.worstPair.label}: ${balance.worstPair.ratio.toFixed(2)}`
              : undefined
          }
        />
      )}
    </SimpleGrid>
  )
}

/**
 * Skeleton shimmer used as the Suspense fallback for the three hero cards.
 * Mirrors the garmin-health `HeroCardSkeleton` pattern — one shimmer card per
 * column so the layout doesn't reflow on load.
 */
function HeroCardSkeleton({ label }: { label: string }) {
  return (
    <Card padding="md" h="100%">
      <Text size="xs" c="dimmed" mb={6}>
        {label}
      </Text>
      <Skeleton height={32} width={120} radius="sm" mb={8} />
      <Skeleton height={12} width={180} radius="sm" />
    </Card>
  )
}

export function HeroStatsSkeleton() {
  return (
    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
      <HeroCardSkeleton label="Strength Direction" />
      <HeroCardSkeleton label="Load Quality" />
      <HeroCardSkeleton label="Readiness" />
    </SimpleGrid>
  )
}

/**
 * Chart skeleton — used as the Suspense fallback for individual chart cards.
 * Renders a card-like shell with a faded title and a single Skeleton block.
 */
export function ChartSkeleton({ height = 320 }: { height?: number }) {
  return (
    <Card padding="md">
      <Skeleton height={14} width={140} radius="sm" mb="sm" />
      <Skeleton height={height - 40} radius="sm" />
    </Card>
  )
}

/**
 * Lightweight placeholder used while chart subagents are still in flight.
 * Renders a Mantine Card with the chart name and a "Coming soon" message.
 */
export function Placeholder({ label, height = 320 }: { label: string; height?: number }) {
  return (
    <Card padding="md">
      <Stack gap={4} justify="center" align="center" h={height}>
        <Text fw={600}>{label}</Text>
        <Text size="xs" c="dimmed">
          Chart coming in Phase 4
        </Text>
      </Stack>
    </Card>
  )
}
