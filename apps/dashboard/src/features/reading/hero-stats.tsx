import { useQuery } from '@tanstack/react-query'
import { Card, Group, SimpleGrid, Skeleton, Text } from '@mantine/core'
import { readingQueries } from '../../lib/queries/reading'

function HeroCard({ label, value, subLabel }: { label: string; value: string; subLabel?: string }) {
  return (
    <Card padding="md" withBorder h="100%">
      <Text size="xs" c="dimmed" mb={6}>
        {label}
      </Text>
      <Group gap={8} align="baseline">
        <Text style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{value}</Text>
      </Group>
      {subLabel !== undefined && subLabel.length > 0 && (
        <Text size="xs" c="dimmed" mt={6}>
          {subLabel}
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

  const avgRatingSubLabel =
    summary.avgRating !== null ? `${summary.ratedCount} rated books` : 'No ratings yet'

  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} spacing="sm">
      <HeroCard label="Total Books" value={String(summary.total)} subLabel="across all shelves" />
      <HeroCard label="Read" value={String(summary.read)} />
      <HeroCard label="Currently Reading" value={String(summary.currentlyReading)} />
      <HeroCard label="Want to Read" value={String(summary.wantToRead)} />
      <HeroCard
        label="Avg Rating"
        value={avgRatingLabel}
        subLabel={summary.avgRating !== null ? avgRatingSubLabel : undefined}
      />
    </SimpleGrid>
  )
}
