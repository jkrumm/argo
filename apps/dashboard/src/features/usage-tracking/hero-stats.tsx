import { useQuery } from '@tanstack/react-query'
import { Card, Group, SimpleGrid, Skeleton, Text } from '@mantine/core'
import { usageQueries } from '../../lib/queries/usage'
import { fmtCount, fmtMs, fmtPct, fmtUsd, relativeTime } from './constants'

function HeroCard({
  label,
  value,
  subLabel,
  breakdown,
  valueColor,
}: {
  label: string
  value: string
  subLabel?: string
  breakdown?: string
  valueColor?: string
}) {
  return (
    <Card padding="md" withBorder h="100%">
      <Text size="xs" c="dimmed" mb={6}>
        {label}
      </Text>
      <Group gap={8} align="baseline">
        <Text style={{ fontSize: 28, fontWeight: 700, lineHeight: 1, color: valueColor }}>
          {value}
        </Text>
        {subLabel !== undefined && subLabel.length > 0 && (
          <Text size="sm" c="dimmed">
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
    <Card padding="md" withBorder h="100%">
      <Text size="xs" c="dimmed" mb={6}>
        {label}
      </Text>
      <Skeleton height={28} width={140} radius="sm" mb={8} />
      <Skeleton height={12} width={180} radius="sm" />
    </Card>
  )
}

export function HeroStats() {
  const { data, isLoading } = useQuery(usageQueries.headline())

  if (isLoading || data === undefined) {
    return (
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} spacing="sm">
        <HeroCardSkeleton label="Cost (30d)" />
        <HeroCardSkeleton label="Tokens (30d)" />
        <HeroCardSkeleton label="Error rate" />
        <HeroCardSkeleton label="p95 latency" />
        <HeroCardSkeleton label="Cache hit" />
      </SimpleGrid>
    )
  }

  const costBreakdown = `Max ${fmtUsd(data.costMaxBilling30d)} · IU ${fmtUsd(data.costIuBilling30d)}`
  const drift = relativeTime(data.maxTs)
  const last7 = `Last 7d ${fmtUsd(data.costUsd7d)}`

  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} spacing="sm">
      <HeroCard
        label="Cost (30d)"
        value={fmtUsd(data.costUsd30d)}
        subLabel={last7}
        breakdown={costBreakdown}
      />
      <HeroCard
        label="Tokens (30d)"
        value={fmtCount(data.tokens30d)}
        breakdown={`${data.sourcesActive} active sources`}
      />
      <HeroCard
        label="Error rate (30d)"
        value={fmtPct(data.errorRate30d)}
        breakdown={drift !== '—' ? `Last event ${drift}` : undefined}
      />
      <HeroCard
        label="p95 latency (30d)"
        value={fmtMs(data.p95Ms30d)}
        breakdown={`${data.recordsTotal.toLocaleString()} rows lifetime`}
      />
      <HeroCard
        label="Cache hit (30d)"
        value={fmtPct(data.cacheHitRatio30d)}
        breakdown="read / (read + input)"
      />
    </SimpleGrid>
  )
}
