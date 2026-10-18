import { createFileRoute } from '@tanstack/react-router'
import { Stack } from '@mantine/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EmptyState, PageBar, unwrap } from 'basalt-ui'
import { emit } from 'basalt-ui/commands'
import { IconBooks } from '@tabler/icons-react'
import { api } from '../lib/eden'
import { readingQueries } from '../lib/queries/reading'
import { Backlog } from '../features/reading/backlog'
import { Finished, TimeRead } from '../features/reading/finished'
import { InProgress } from '../features/reading/in-progress'
import {
  backlog as deriveBacklog,
  currentYear,
  finishedGroups,
  finishedInYear,
  readingPace,
  shelfCounts,
  summaryParts,
} from '../features/reading/model'
import classes from '../features/reading/reading.module.css'
import { ReadingStrip } from '../features/reading/strip'
import { PageSummary } from '../components/upstream/page-summary'
import { useNow } from '../lib/use-now'
import { UnmatchedSection } from '../features/reading/unmatched-section'

export const Route = createFileRoute('/reading')({
  loader: ({ context }) => context.queryClient.ensureQueryData(readingQueries.shelf()),
  component: ReadingPage,
})

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
  const now = useNow()

  const shelf = data?.shelf ?? []
  const pace = readingPace(shelf)
  const backlog = deriveBacklog(shelf, pace.median)
  const counts = shelfCounts(shelf)
  const year = currentYear(now)

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

      {data === undefined || shelf.length === 0 ? (
        <>
          <UnmatchedSection />
          <EmptyState
            icon={<IconBooks size={28} />}
            title="Your shelf is empty"
            description="Books appear here once you add them to your shelf on Hardcover. Sync runs daily."
          />
        </>
      ) : (
        <div className={classes.root}>
          <Stack gap="md">
            <PageSummary
              {...summaryParts({
                counts,
                pace: pace.median,
                finished: finishedInYear(shelf, year),
                year,
                backlogHours: backlog.hours,
              })}
            />
            <ReadingStrip counts={counts} shelf={shelf} pace={pace} />
            <UnmatchedSection />
            <InProgress shelf={shelf} pace={pace.median} now={now} />
            <div className={classes.pair}>
              <div data-shot="finished">
                <Finished groups={finishedGroups(shelf)} undated={counts.read - counts.readDated} />
              </div>
              <div data-shot="time-read">
                <TimeRead shelf={shelf} />
              </div>
            </div>
            <Backlog backlog={backlog} pace={pace.median} />
          </Stack>
        </div>
      )}
    </>
  )
}
