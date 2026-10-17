import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Stack, Text } from '@mantine/core'
import { PageBar } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import { wardenQueries } from '../lib/queries/warden'
import { deriveAwaitingOwner } from '../features/warden/model'
import {
  deriveBoardColumns,
  derivePollers,
  deriveStrip,
  deriveSummary,
  needsCards,
  oldestAgeDays,
} from '../features/warden/page-model'
import { StaleBanner } from '../features/warden/stale-banner'
import { HealthStrip } from '../features/warden/health-strip'
import { DecisionQueues } from '../features/warden/decision-queues'
import { Board } from '../features/warden/board'
import { PollersList } from '../features/warden/pollers-list'
import { useWardenActions } from '../features/warden/use-warden-actions'
import { ItemTimeline } from '../features/warden/item-timeline'

export const Route = createFileRoute('/warden')({
  loader: ({ context }) => context.queryClient.ensureQueryData(wardenQueries.snapshot()),
  component: WardenPage,
})

/**
 * The Warden control-plane page: the mini's deterministic loop over its own SQLite ledger, as
 * pushed to Argo after every tick. Argo renders what warden pushed — states, metrics, budget and
 * timelines are all warden's; the page only words and groups them (`features/warden/page-model.ts`).
 * Top to bottom: the summary sentence, the health strip with the budget meters, the decision cards
 * (needs you, failed), the board of everything still open, the pollers. The owner action queue
 * (mutation + pending-state reconciliation) lives in `use-warden-actions.ts`.
 */
function WardenPage() {
  const snapshotQuery = useQuery(wardenQueries.snapshot())
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null)
  // Only a manual refresh dims the page (while its fetch is in flight); the 60 s background poll
  // swaps data in place.
  const [refreshRequested, setRefreshRequested] = useState(false)

  const snapshot = snapshotQuery.data ?? null
  // The request ends when the fetch it started settles — two quick clicks share one settle.
  const isFetching = snapshotQuery.isFetching
  const [wasFetching, setWasFetching] = useState(isFetching)
  if (wasFetching !== isFetching) {
    setWasFetching(isFetching)
    if (!isFetching) setRefreshRequested(false)
  }
  const raw = snapshot?.raw
  const awaitingOwner = deriveAwaitingOwner(raw?.board)
  const needs = needsCards(awaitingOwner)
  const claimed = new Set([...needs, ...awaitingOwner.failed].map((row) => row.eventId))
  const columns = deriveBoardColumns(raw?.board, claimed)
  const pollers = derivePollers(raw?.metrics, raw?.health)
  const strip = deriveStrip(raw?.metrics, raw?.health)
  const { pending, handleAction } = useWardenActions(snapshot?.machine, raw?.board?.items)

  const summary = deriveSummary({
    needsCount: needs.length,
    oldestAgeDays: oldestAgeDays(needs),
    receivedAt: snapshot?.receivedAt ?? null,
    oldestPollerMin: strip.poller.oldestMin,
    unattendedFixes: strip.unattended.fixes,
    windowDays: strip.unattended.windowDays,
    stalePoller: pollers.find((poller) => poller.stale) ?? null,
    healthOk: raw?.health?.ok,
  })

  return (
    <>
      <PageBar
        sync={{
          syncing: snapshotQuery.isFetching,
          onSync: () => {
            setRefreshRequested(true)
            void snapshotQuery.refetch()
          },
          label: 'Refresh',
        }}
      />

      <Stack gap="md" opacity={refreshRequested && snapshotQuery.isFetching ? 0.6 : 1}>
        <StaleBanner snapshot={snapshot} />
        {snapshot ? (
          <Text
            size="sm"
            {...(summary.status === 'stalled'
              ? { c: VX.status.bad, fw: 600 }
              : summary.status === 'degraded'
                ? { c: VX.status.warn, fw: 600 }
                : {})}
          >
            {summary.text}
          </Text>
        ) : null}
        <HealthStrip metrics={raw?.metrics} health={raw?.health} budget={raw?.budget} />
        <DecisionQueues
          view={awaitingOwner}
          items={raw?.items}
          pending={pending}
          onSelectItem={setSelectedEventId}
          onAction={handleAction}
        />
        <Board columns={columns} onSelectItem={setSelectedEventId} />
        <PollersList pollers={pollers} />
      </Stack>

      <ItemTimeline
        eventId={selectedEventId}
        items={raw?.items}
        onClose={() => setSelectedEventId(null)}
      />
    </>
  )
}
