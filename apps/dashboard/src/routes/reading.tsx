import { createFileRoute } from '@tanstack/react-router'
import { Stack } from '@mantine/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EmptyState, PageBar, unwrap } from 'basalt-ui'
import { emit } from 'basalt-ui/notifications'
import { IconBooks } from '@tabler/icons-react'
import { api } from '../lib/eden'
import { readingQueries } from '../lib/queries/reading'
import { HeroStats } from '../features/reading/hero-stats'
import { ShelfSection } from '../features/reading/shelf-section'
import { UnmatchedSection } from '../features/reading/unmatched-section'

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

/**
 * Triggers an on-demand Hardcover shelf sync (the same job the daily cron runs) and refetches the
 * shelf on success. The BUTTON is basalt's `SyncButton` via `PageBar.sync` (law C12) — this owns
 * only the mutation and its notifications.
 */
function useShelfSync() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => unwrap(await api.reading.sync.post()),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: readingQueries.all() })
      if (result.errors > 0) {
        emit(
          'reading:partial',
          {
            message: `Synced ${result.upserted} book(s) with ${result.errors} error(s) — check server logs.`,
          },
          { title: 'Sync complete' },
        )
      } else {
        emit(
          'reading:success',
          { message: `Synced ${result.upserted} book(s) from Hardcover.` },
          { title: 'Sync complete' },
        )
      }
    },
    onError: () => {
      emit(
        'reading:error',
        { message: 'Could not run the Hardcover sync. Check the server logs.' },
        { title: 'Sync failed' },
      )
    },
  })
}

function ReadingPage() {
  const { data } = useQuery(readingQueries.shelf())
  const sync = useShelfSync()

  const shelf = data?.shelf ?? []

  return (
    <>
      {/* The in-body `Reading` title is gone: the breadcrumb names the page (law C8). */}
      <PageBar
        sync={{
          syncing: sync.isPending,
          onSync: () => sync.mutate(),
          label: 'Sync now',
        }}
      />

      <Stack gap="md">
        <HeroStats />

        <UnmatchedSection />

        {shelf.length === 0 ? (
          <EmptyState
            icon={<IconBooks size={28} />}
            title="Your shelf is empty"
            description="Books appear here once you add them to your shelf on Hardcover. Sync runs daily."
          />
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
    </>
  )
}
