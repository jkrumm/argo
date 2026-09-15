import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Stack } from '@mantine/core'
import { PageBar } from 'basalt-ui'
import { wardenQueries } from '../lib/queries/warden'
import { deriveWardenPage } from '../features/warden/model'
import { StaleBanner } from '../features/warden/stale-banner'
import { FunnelStats } from '../features/warden/funnel-stats'
import { BoardSections } from '../features/warden/board-section'
import { GithubIssuesSection } from '../features/warden/issues-section'
import { useWardenActions } from '../features/warden/use-warden-actions'
import { ItemTimeline } from '../features/warden/item-timeline'
import { IntentsSection } from '../features/warden/intents-section'

export const Route = createFileRoute('/warden')({
  loader: ({ context }) => context.queryClient.ensureQueryData(wardenQueries.snapshot()),
  component: WardenPage,
})

/**
 * The Warden control-plane board: the mini's deterministic loop over its own SQLite ledger, as
 * pushed to Argo after every tick. Argo renders what warden pushed — the states, the funnel
 * metrics, the budget and the timelines are all warden's; the page derives only its own feed age
 * (`StaleBanner`) and how to bucket/format that payload (`features/warden/model.ts`). The owner
 * action queue (mutation + pending-state reconciliation) lives in `use-warden-actions.ts`.
 */
function WardenPage() {
  const snapshotQuery = useQuery(wardenQueries.snapshot())
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null)

  const snapshot = snapshotQuery.data ?? null
  const raw = snapshot?.raw
  const { buckets, issueGroups, boardItems } = deriveWardenPage(raw)
  const { pending, handleAction } = useWardenActions(snapshot?.machine, boardItems)

  return (
    <>
      <PageBar
        sync={{
          syncing: snapshotQuery.isFetching,
          onSync: () => void snapshotQuery.refetch(),
          label: 'Refresh',
        }}
      />

      <Stack gap="md">
        <StaleBanner snapshot={snapshot} />
        <FunnelStats metrics={raw?.metrics} budget={raw?.budget} />
        <GithubIssuesSection
          groups={issueGroups}
          pending={pending}
          onSelectItem={setSelectedEventId}
          onAction={handleAction}
        />
        <BoardSections buckets={buckets} onSelectItem={setSelectedEventId} />
        <IntentsSection intents={raw?.intents} />
      </Stack>

      <ItemTimeline
        eventId={selectedEventId}
        items={raw?.items}
        onClose={() => setSelectedEventId(null)}
      />
    </>
  )
}
