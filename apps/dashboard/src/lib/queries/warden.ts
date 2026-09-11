import { queryOptions } from '@tanstack/react-query'
import { EdenFetchError } from '@elysiajs/eden'
import { api } from '../eden'
import { unwrap } from 'basalt-ui'

// Warden control-plane board — the snapshot Warden (the mini's deterministic loop over its own
// SQLite ledger) pushes after every tick (see apps/api/src/routes/warden.ts). The feed is a push
// from the mini, so the page polls Argo on a one-minute cadence rather than the producer.

const POLL_MS = 60_000

function isNotFoundError(error: unknown): boolean {
  return error instanceof EdenFetchError && error.status === 404
}

/** 404 means "nothing pushed yet" — a normal, expected state before the first loop tick reaches
 * Argo, not a query error. Mirrors `hermes.ts`'s `isNotFoundError` handling. */
async function fetchSnapshot() {
  const result = await api.warden.snapshot.get({ query: {} })
  if (result.error && isNotFoundError(result.error)) return null
  return unwrap(result)
}

export type WardenSnapshotRecord = NonNullable<Awaited<ReturnType<typeof fetchSnapshot>>>
export type WardenRaw = WardenSnapshotRecord['raw']
export type WardenHealth = NonNullable<WardenRaw['health']>
export type WardenMetrics = NonNullable<WardenRaw['metrics']>
export type WardenFunnelMetric = NonNullable<WardenMetrics['verdicts_recorded_disposition']>
export type WardenBoard = NonNullable<WardenRaw['board']>
export type WardenBoardItem = NonNullable<WardenBoard['items']>[number]
export type WardenBudget = NonNullable<WardenRaw['budget']>
export type WardenItems = NonNullable<WardenRaw['items']>
export type WardenItemTimeline = WardenItems[string]
export type WardenIntents = NonNullable<WardenRaw['intents']>

export type WardenSnapshotResult = Awaited<ReturnType<typeof fetchSnapshot>>

export const wardenQueries = {
  all: () => ['warden'] as const,
  snapshot: () =>
    queryOptions({
      queryKey: [...wardenQueries.all(), 'snapshot'] as const,
      queryFn: fetchSnapshot,
      refetchInterval: POLL_MS,
    }),
}
