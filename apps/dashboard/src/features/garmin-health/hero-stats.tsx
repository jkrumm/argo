import { useQuery } from '@tanstack/react-query'
import { Card, SimpleGrid, Skeleton, Text } from '@mantine/core'
import { StatCard, type StatCardBreakdownRow } from 'basalt-ui'
import {
  fitnessDirectionQueries,
  recoveryQueries,
  trainingLoadQueries,
} from '../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS } from './constants'
import { acwrZoneLabel, acwrZoneTone, recoveryActionLabel, scoreTone } from './formulas'
import type { SummaryParams } from './types'

/**
 * The three hero cards are `StatCard`s (basalt-ui 1.27.0), not a local `HeroCard`: `unit`,
 * `breakdown` and `deltaFormat` closed the three gaps that kept this file forking the composite.
 *
 * Two shape changes came with it and are deliberate. The verdict word that used to sit BESIDE the
 * value (`Push hard`, `Optimal`) is now the `subtitle` line under it — `StatCard` has no
 * second-figure slot and the framework's hero row is one number. And the value is no longer painted
 * in the zone colour: `tone` draws the same verdict as an accent rail down the card's leading edge,
 * which is what every other basalt surface does with a threshold.
 */

/** Only the components that measured become rows — an absent one is left out, never shown as `—`. */
function measuredRows(
  parts: readonly (readonly [label: string, value: number | null, digits?: number])[],
): StatCardBreakdownRow[] {
  return parts
    .filter((p): p is readonly [string, number, number?] => p[1] !== null)
    .map(([label, value, digits = 0]) => ({ label, value: value.toFixed(digits) }))
}

/** `WidgetHeader` renders `subtitle` whenever it is not `undefined`, so an empty verdict — every
 *  label helper returns `''` for a null reading — must become `undefined`, not a blank line. */
function orUndefined(label: string): string | undefined {
  return label.length > 0 ? label : undefined
}

/** A signed figure reads as a delta even in a breakdown row, so keep the `+`. */
function signed(value: number, digits = 0): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`
}

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

function RecoveryCard({ params }: { params: SummaryParams }) {
  const { data, isLoading } = useQuery(recoveryQueries.summary(params))
  if (isLoading || data === undefined) return <HeroCardSkeleton label="Recovery" />
  const score = data.recovery
  const subtitle = orUndefined(recoveryActionLabel(score))
  const tone = scoreTone(score)

  return (
    <StatCard
      title="Recovery"
      info={METRIC_TOOLTIPS.recoveryScore}
      value={score !== null ? String(Math.round(score)) : '—'}
      breakdown={measuredRows([
        ['HRV', data.components.hrv],
        ['Sleep', data.components.sleep],
        ['RHR', data.components.rhr],
      ])}
      {...(subtitle !== undefined && { subtitle })}
      {...(tone !== undefined && { tone })}
    />
  )
}

function FitnessDirectionCard({ params }: { params: SummaryParams }) {
  const { data, isLoading } = useQuery(fitnessDirectionQueries.summary(params))
  if (isLoading || data === undefined) return <HeroCardSkeleton label="Fitness" />

  const breakdown: StatCardBreakdownRow[] = [
    ...(data.rhrDelta !== null ? [{ label: 'RHR', value: signed(data.rhrDelta) }] : []),
    ...(data.hrvDelta !== null ? [{ label: 'HRV', value: signed(data.hrvDelta) }] : []),
    ...(data.vo2max !== null ? [{ label: 'VO2', value: data.vo2max.toFixed(1) }] : []),
  ]

  const subtitle = orUndefined(data.label)

  return (
    <StatCard
      title="Fitness"
      info={METRIC_TOOLTIPS.fitnessTrends}
      value={data.symbol}
      breakdown={breakdown}
      {...(subtitle !== undefined && { subtitle })}
    />
  )
}

function TrainingLoadCard({ params }: { params: SummaryParams }) {
  const { data, isLoading } = useQuery(trainingLoadQueries.summary(params))
  if (isLoading || data === undefined) return <HeroCardSkeleton label="Training Load" />
  const latest = data.points.at(-1) ?? null
  const zone = latest?.zone ?? null
  const acwr = latest?.acwr ?? null
  const subtitle = orUndefined(acwrZoneLabel(zone))
  const tone = acwrZoneTone(zone)

  return (
    <StatCard
      title="Training Load"
      info={METRIC_TOOLTIPS.trainingLoad}
      value={acwr !== null ? acwr.toFixed(2) : '—'}
      breakdown={measuredRows([
        ['Acute', latest?.acute ?? null],
        ['Chronic', latest?.chronic ?? null],
      ])}
      {...(subtitle !== undefined && { subtitle })}
      {...(tone !== undefined && { tone })}
    />
  )
}

export function HeroStats({ params }: { params: SummaryParams }) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
      <RecoveryCard params={params} />
      <FitnessDirectionCard params={params} />
      <TrainingLoadCard params={params} />
    </SimpleGrid>
  )
}
