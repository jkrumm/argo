import { useQuery } from '@tanstack/react-query'
import { Box, Card, Group, SimpleGrid, Skeleton, Stack, Text, Tooltip } from '@mantine/core'
import { IconInfoCircle } from '@tabler/icons-react'
import {
  fitnessDirectionQueries,
  recoveryQueries,
  trainingLoadQueries,
} from '../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS, ZONE_COLORS } from './constants'
import { acwrZoneColor, acwrZoneLabel, recoveryActionLabel, scoreColor } from './formulas'
import type { SummaryParams } from './types'

function InfoIcon({ tooltip }: { tooltip: string }) {
  return (
    <Tooltip label={tooltip} multiline w={320} withArrow position="bottom-start">
      <Box component="span" ml={4}>
        <IconInfoCircle
          size={12}
          style={{ opacity: 0.45, cursor: 'help', verticalAlign: 'middle' }}
        />
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

function RecoveryCard({ params }: { params: SummaryParams }) {
  const { data, isLoading } = useQuery(recoveryQueries.summary(params))
  if (isLoading || data === undefined) return <HeroCardSkeleton label="Recovery" />
  const score = data.recovery
  const color = score !== null ? scoreColor(score) : ZONE_COLORS.neutral

  const breakdown =
    data.components.hrv !== null || data.components.sleep !== null || data.components.rhr !== null
      ? [
          data.components.hrv !== null ? `HRV ${data.components.hrv.toFixed(0)}` : null,
          data.components.sleep !== null ? `Sleep ${data.components.sleep.toFixed(0)}` : null,
          data.components.rhr !== null ? `RHR ${data.components.rhr.toFixed(0)}` : null,
        ]
          .filter((v): v is string => v !== null)
          .join(' · ')
      : undefined

  return (
    <HeroCard
      label="Recovery"
      tooltip={METRIC_TOOLTIPS.recoveryScore}
      value={score !== null ? String(Math.round(score)) : '—'}
      color={color}
      subLabel={recoveryActionLabel(score)}
      breakdown={breakdown}
    />
  )
}

function FitnessDirectionCard({ params }: { params: SummaryParams }) {
  const { data, isLoading } = useQuery(fitnessDirectionQueries.summary(params))
  if (isLoading || data === undefined) return <HeroCardSkeleton label="Fitness" />

  const breakdown = [
    data.rhrDelta !== null
      ? `RHR ${data.rhrDelta > 0 ? '+' : ''}${data.rhrDelta.toFixed(0)}`
      : null,
    data.hrvDelta !== null
      ? `HRV ${data.hrvDelta > 0 ? '+' : ''}${data.hrvDelta.toFixed(0)}`
      : null,
    data.vo2max !== null ? `VO2 ${data.vo2max.toFixed(1)}` : null,
  ]
    .filter((v): v is string => v !== null)
    .join(' · ')

  return (
    <HeroCard
      label="Fitness"
      tooltip={METRIC_TOOLTIPS.fitnessTrends}
      value={data.symbol}
      color={data.color}
      subLabel={data.label}
      breakdown={breakdown.length > 0 ? breakdown : undefined}
    />
  )
}

function TrainingLoadCard({ params }: { params: SummaryParams }) {
  const { data, isLoading } = useQuery(trainingLoadQueries.summary(params))
  if (isLoading || data === undefined) return <HeroCardSkeleton label="Training Load" />
  const latest = data.points.at(-1) ?? null

  const acwr = latest?.acwr ?? null
  const zone = latest?.zone ?? null
  const color = acwrZoneColor(zone)

  const breakdown =
    latest !== null && (latest.acute !== null || latest.chronic !== null)
      ? `Acute ${latest.acute !== null ? latest.acute.toFixed(0) : '—'} · Chronic ${
          latest.chronic !== null ? latest.chronic.toFixed(0) : '—'
        }`
      : undefined

  return (
    <HeroCard
      label="Training Load"
      tooltip={METRIC_TOOLTIPS.trainingLoad}
      value={acwr !== null ? acwr.toFixed(2) : '—'}
      color={color}
      subLabel={acwrZoneLabel(zone)}
      breakdown={breakdown}
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

/**
 * Lightweight placeholder used while chart subagents are still in flight.
 * Renders a Mantine Card with the chart name and a "Coming soon" message.
 */
export function Placeholder({ label, height = 240 }: { label: string; height?: number }) {
  return (
    <Card padding="md">
      <Stack gap={4} justify="center" align="center" h={height}>
        <Text fw={600}>{label}</Text>
        <Text size="xs" c="dimmed">
          Coming soon
        </Text>
      </Stack>
    </Card>
  )
}
