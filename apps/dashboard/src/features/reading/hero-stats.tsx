import { useQuery } from '@tanstack/react-query'
import { Card, SimpleGrid, Skeleton, Text } from '@mantine/core'
import { StatCard } from 'basalt-ui'
import { readingQueries } from '../../lib/queries/reading'

function HeroCardSkeleton({ label }: { label: string }) {
  return (
    <Card py="xs" px="sm" h="100%">
      <Text size="xs" c="dimmed" mb={6}>
        {label}
      </Text>
      <Skeleton height={28} width={80} radius="sm" mb={8} />
      <Skeleton height={12} width={140} radius="sm" />
    </Card>
  )
}

export function HeroStats() {
  const { data, isLoading } = useQuery(readingQueries.shelf())

  if (isLoading || data === undefined) {
    return (
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} spacing="sm">
        <HeroCardSkeleton label="Total Books" />
        <HeroCardSkeleton label="Read" />
        <HeroCardSkeleton label="Currently Reading" />
        <HeroCardSkeleton label="Want to Read" />
        <HeroCardSkeleton label="Avg Rating" />
      </SimpleGrid>
    )
  }

  const { summary } = data

  const avgRatingLabel =
    summary.avgRating !== null
      ? `${summary.avgRating.toFixed(1)} ★ · ${summary.ratedCount} rated`
      : '—'

  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} spacing="sm">
      <StatCard title="Total Books" value={String(summary.total)} subtitle="across all shelves" />
      <StatCard title="Read" value={String(summary.read)} />
      <StatCard title="Currently Reading" value={String(summary.currentlyReading)} />
      <StatCard title="Want to Read" value={String(summary.wantToRead)} />
      <StatCard
        title="Avg Rating"
        value={avgRatingLabel}
        {...(summary.avgRating !== null && { subtitle: `${summary.ratedCount} rated books` })}
      />
    </SimpleGrid>
  )
}
