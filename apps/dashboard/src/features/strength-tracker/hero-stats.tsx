import { useSuspenseQuery } from '@tanstack/react-query'
import { Card, SimpleGrid, Skeleton, Stack, Text } from '@mantine/core'
import { StatCard, type StatCardBreakdownRow } from 'basalt-ui'
import { strengthQueries, type StrengthQueryParams } from '../../lib/queries/strength'
import { METRIC_TOOLTIPS } from './constants'
import {
  balanceLabel,
  balanceSymbol,
  balanceTone,
  directionArrow,
  directionTone,
  exerciseLabel,
  loadQualityLabel,
  loadQualityTone,
  momentumLabel,
  readinessTone,
} from './formulas'

/**
 * The three hero cards are `StatCard`s (basalt-ui 1.27.0), not a local `HeroCard` — see the
 * docblock in `garmin-health/hero-stats.tsx` for the two shape changes that came with it (the
 * verdict word moves from beside the value to the `subtitle` line, and the zone colour moves from
 * the value's ink to the card's `tone` rail).
 */

/** `WidgetHeader` renders `subtitle` whenever it is not `undefined`, so an empty verdict — every
 *  label helper returns `''` for a null reading — must become `undefined`, not a blank line. */
function orUndefined(label: string): string | undefined {
  return label.length > 0 ? label : undefined
}

export function HeroStats({ params }: { params: StrengthQueryParams }) {
  const { data } = useSuspenseQuery(strengthQueries.heroes(params))

  // ── Strength direction ────────────────────────────────────────────────
  const dir = data.strengthDirection
  const dirBreakdown: StatCardBreakdownRow[] = [
    ...(dir.leaderVelocityPctPerMonth !== null
      ? [
          {
            label: 'Velocity',
            value: `${dir.leaderVelocityPctPerMonth > 0 ? '+' : ''}${dir.leaderVelocityPctPerMonth.toFixed(1)}%/mo`,
          },
        ]
      : []),
    ...(momentumLabel(dir.momentumSign).length > 0
      ? [{ label: 'Momentum', value: momentumLabel(dir.momentumSign) }]
      : []),
  ]

  // ── Load quality ──────────────────────────────────────────────────────
  const lq = data.loadQuality
  const lqBreakdown: StatCardBreakdownRow[] =
    lq.dragComponent !== null
      ? [{ label: 'Drag', value: lq.dragComponent }]
      : [
          ...(lq.latestInol !== null ? [{ label: 'INOL', value: lq.latestInol.toFixed(2) }] : []),
          ...(lq.latestAcwr !== null ? [{ label: 'ACWR', value: lq.latestAcwr.toFixed(2) }] : []),
        ]

  // ── Third card: readiness if available, else balance ─────────────────
  const readiness = data.readiness
  const balance = data.balance

  return (
    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
      <StatCard
        title="Strength Direction"
        info={METRIC_TOOLTIPS.heroStrength}
        value={directionArrow(dir.direction)}
        subtitle={dir.leaderExercise !== null ? exerciseLabel(dir.leaderExercise) : undefined}
        breakdown={dirBreakdown}
        tone={directionTone(dir.direction)}
      />
      <StatCard
        title="Load Quality"
        info={METRIC_TOOLTIPS.heroLoadQuality}
        value={String(Math.round(lq.score))}
        subtitle={orUndefined(loadQualityLabel(lq.verdict))}
        breakdown={lqBreakdown}
        tone={loadQualityTone(lq.score)}
      />
      {readiness !== null ? (
        <StatCard
          title="Readiness"
          info={METRIC_TOOLTIPS.heroReadiness}
          value={readiness.score !== null ? String(Math.round(readiness.score)) : '—'}
          subtitle={readiness.verdict}
          breakdown={
            readiness.driver !== null ? [{ label: 'Driver', value: readiness.driver }] : []
          }
          tone={readinessTone(readiness.score)}
        />
      ) : (
        <StatCard
          title="Balance"
          info={METRIC_TOOLTIPS.heroBalance}
          value={balanceSymbol(balance.status)}
          subtitle={orUndefined(balanceLabel(balance.status))}
          breakdown={
            balance.worstPair !== null
              ? [{ label: balance.worstPair.label, value: balance.worstPair.ratio.toFixed(2) }]
              : []
          }
          tone={balanceTone(balance.status)}
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
    <Card py="xs" px="sm" h="100%">
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
    <Card py="xs" px="sm">
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
    <Card py="xs" px="sm">
      <Stack gap={4} justify="center" align="center" h={height}>
        <Text fw={600}>{label}</Text>
        <Text size="xs" c="dimmed">
          Chart coming in Phase 4
        </Text>
      </Stack>
    </Card>
  )
}
