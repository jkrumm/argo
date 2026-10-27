import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Alert, Stack, Text } from '@mantine/core'
import { PageBar, PageSummary } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import { IconInfoCircle } from '@tabler/icons-react'
import { wardenQueries } from '../lib/queries/warden'
import { shotState } from '../lib/shot-state'
import { deriveAwaitingOwner, waitingOnOwner } from '../features/warden/model'
import {
  deriveBoard,
  derivePollers,
  deriveSummary,
  oldestAgeDays,
} from '../features/warden/page-model'
import { StaleBanner } from '../features/warden/stale-banner'
import { HealthStrip } from '../features/warden/health-strip'
import { DecisionQueues } from '../features/warden/decision-queues'
import { Board } from '../features/warden/board'
import { PollersList } from '../features/warden/pollers-list'
import { ItemTimeline } from '../features/warden/item-timeline'

/** Warden stopped polling and acting on 2026-10-27; this board is frozen history from then on. */
function SwitchedOffBanner() {
  return (
    <Alert
      data-shot="switched-off"
      color="gray"
      variant="light"
      icon={<IconInfoCircle size={16} />}
    >
      Warden was switched off on 2026-10-27. This board is a frozen history.
    </Alert>
  )
}

/** The headline's ink: plain when healthy, a status hue when the loop is degraded or stalled. */
const STATUS_TONE = {
  ok: null,
  degraded: VX.status.warn,
  stalled: VX.status.bad,
} as const

export const Route = createFileRoute('/warden')({
  loader: ({ context }) => context.queryClient.ensureQueryData(wardenQueries.snapshot()),
  component: WardenPage,
})

/**
 * The Warden control-plane page: the mini's deterministic loop over its own SQLite ledger, as
 * pushed to Argo after every tick. Argo renders what warden pushed — states, metrics, budget and
 * timelines are all warden's; the page only words and groups them (`features/warden/page-model.ts`).
 * Top to bottom: the switched-off banner, the summary sentence, the health strip with the budget
 * meters, the decision cards (needs you, failed), the board of everything still open, the
 * pollers. Warden was switched off 2026-10-27 — the page is read-only history, no action queue.
 */
function WardenPage() {
  const snapshotQuery = useQuery(wardenQueries.snapshot())
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null)
  // Only a manual refresh dims the page (while its fetch is in flight); the 60 s background poll
  // swaps data in place.
  const [refreshRequested, setRefreshRequested] = useState(false)

  // `empty` is the real "nothing pushed yet" branch (404 → null).
  const pushedSnapshot = snapshotQuery.data ?? null
  const snapshot = shotState() === 'empty' ? null : pushedSnapshot
  // The request ends when the fetch it started settles — two quick clicks share one settle.
  const isFetching = snapshotQuery.isFetching
  const [wasFetching, setWasFetching] = useState(isFetching)
  if (wasFetching !== isFetching) {
    setWasFetching(isFetching)
    if (!isFetching) setRefreshRequested(false)
  }
  const raw = snapshot?.raw
  const awaitingOwner = deriveAwaitingOwner(raw?.board, raw?.items)
  const waiting = waitingOnOwner(awaitingOwner)
  const board = deriveBoard(raw?.board, awaitingOwner)
  const pollers = derivePollers(raw?.metrics, raw?.health)

  const summary = deriveSummary({
    needsCount: waiting.length,
    oldestAgeDays: oldestAgeDays(waiting),
    receivedAt: snapshot?.receivedAt ?? null,
    stalePoller: pollers.find((poller) => poller.stale) ?? null,
    healthOk: raw?.health?.ok,
  })

  const tone = STATUS_TONE[summary.status]
  const sentence =
    tone === null ? (
      summary.text
    ) : (
      <Text span inherit c={tone}>
        {summary.text}
      </Text>
    )

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
        <SwitchedOffBanner />
        <StaleBanner snapshot={snapshot} />
        {snapshotQuery.isPending || snapshot !== null ? (
          <PageSummary loading={snapshotQuery.isPending} sentence={sentence} />
        ) : null}
        {snapshot === null ? null : (
          <>
            <HealthStrip metrics={raw?.metrics} health={raw?.health} budget={raw?.budget} />
            <DecisionQueues
              view={awaitingOwner}
              receivedAt={snapshot?.receivedAt ?? null}
              items={raw?.items}
              onSelectItem={setSelectedEventId}
            />
            <Board
              columns={board.columns}
              open={board.open}
              emptyText={board.emptyText}
              onSelectItem={setSelectedEventId}
            />
          </>
        )}
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
