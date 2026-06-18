import { createFileRoute } from '@tanstack/react-router'
import { Group, Stack, Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { readingQueries } from '../lib/queries/reading'
import { HeroStats } from '../features/reading/hero-stats'
import { ShelfSection } from '../features/reading/shelf-section'
import { EmptyShelf } from '../features/reading/empty-state'
import { SyncButton } from '../features/reading/sync-button'

export const Route = createFileRoute('/reading')({
  loader: ({ context }) => context.queryClient.ensureQueryData(readingQueries.shelf()),
  component: ReadingPage,
})

// Status groups in display order — status 6 (Ignored) is intentionally omitted
const SHELF_GROUPS: { statusId: number; label: string }[] = [
  { statusId: 2, label: 'Currently Reading' },
  { statusId: 1, label: 'Want to Read' },
  { statusId: 3, label: 'Read' },
  { statusId: 4, label: 'Paused' },
  { statusId: 5, label: 'Did Not Finish' },
]

function ReadingPage() {
  const { data } = useQuery(readingQueries.shelf())

  const shelf = data?.shelf ?? []

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={2}>
          <Text fw={700} size="xl">
            Reading
          </Text>
          <Text size="sm" c="dimmed">
            Your Hardcover shelf — what you've read, rated, and want to read next.
          </Text>
        </Stack>
        <SyncButton />
      </Group>

      <HeroStats />

      {shelf.length === 0 ? (
        <EmptyShelf />
      ) : (
        <Stack gap="md">
          {SHELF_GROUPS.map(({ statusId, label }) => {
            const books = shelf.filter((b) => b.statusId === statusId)
            if (books.length === 0) return null
            return <ShelfSection key={statusId} title={label} books={books} />
          })}
        </Stack>
      )}
    </Stack>
  )
}
