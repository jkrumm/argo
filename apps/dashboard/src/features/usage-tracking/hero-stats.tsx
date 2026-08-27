import { useQuery } from '@tanstack/react-query'
import { Card, SimpleGrid, Skeleton, Text } from '@mantine/core'
import { StatCard } from 'basalt-ui'
import { usageQueries } from '../../lib/queries/usage'
import { fmtCount, fmtMs, fmtPct, fmtUsd, relativeTime } from './constants'

function HeroCardSkeleton({ label }: { label: string }) {
  return (
    <Card py="xs" px="sm" h="100%">
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

  const drift = relativeTime(data.maxTs)

  // `StatCard`'s `subtitle` is the muted unit/basis line the old hand-rolled `HeroCard` called
  // `breakdown`; its `subLabel` (a second figure beside the value) has no `StatCard` slot, so the
  // cost card's "last 7d" figure rides the same line as the billing split.
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} spacing="sm">
      <StatCard
        title="Cost (30d)"
        value={fmtUsd(data.costUsd30d)}
        subtitle={`Last 7d ${fmtUsd(data.costUsd7d)} · Max ${fmtUsd(data.costMaxBilling30d)} · IU ${fmtUsd(data.costIuBilling30d)}`}
      />
      <StatCard
        title="Tokens (30d)"
        value={fmtCount(data.tokens30d)}
        subtitle={`${data.sourcesActive} active sources`}
      />
      <StatCard
        title="Error rate (30d)"
        value={fmtPct(data.errorRate30d)}
        {...(drift !== '—' && { subtitle: `Last event ${drift}` })}
      />
      <StatCard
        title="p95 latency (30d)"
        value={fmtMs(data.p95Ms30d)}
        subtitle={`${data.recordsTotal.toLocaleString()} rows lifetime`}
      />
      <StatCard
        title="Cache hit (30d)"
        value={fmtPct(data.cacheHitRatio30d)}
        subtitle="read / (read + input)"
      />
    </SimpleGrid>
  )
}
