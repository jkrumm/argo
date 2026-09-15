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
/**
 * What the owner can click for a board item — mirrors warden's own closed verb allowlist
 * (`apply_argo_actions()`) and the API's `WARDEN_ACTION_VERBS`. Hand-declared, NOT derived from
 * `WardenBoardItem['availableActions']`: that wire field is deliberately typed as a plain
 * `z.array(z.string())` (see `apps/api/src/routes/warden.ts`'s `BoardItemSchema` comment) so one
 * item carrying a verb warden and Argo haven't synced on yet never 422s the whole snapshot. Every
 * consumer of `item.availableActions` must filter through `KNOWN_ACTION_VERBS`/`isKnownActionVerb`
 * before treating a raw string as this type — an un-filtered value can be any string.
 */
export type WardenActionVerb = 'implement' | 'merge' | 'dismiss' | 'reinvestigate' | 'note'

export const KNOWN_ACTION_VERBS: readonly WardenActionVerb[] = [
  'implement',
  'merge',
  'dismiss',
  'reinvestigate',
  'note',
]

/** Narrows a raw `availableActions` entry (an unconstrained string on the wire) to the closed
 * `WardenActionVerb` union — drops anything warden and this dashboard haven't synced on yet,
 * rather than rendering a broken "undefined"-labelled button that would still submit it. */
export function isKnownActionVerb(verb: string): verb is WardenActionVerb {
  return (KNOWN_ACTION_VERBS as readonly string[]).includes(verb)
}
/** `null` for every item except `origin: "github_issue"` (`docs/api.md`'s "Argo push" section). */
export type WardenIssueInfo = NonNullable<WardenBoardItem['issue']>

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

// ── Owner action queue ───────────────────────────────────────────────────

export type EnqueueWardenActionParams = {
  /** The snapshot's own `machine` field — never hardcoded, warden may run on more than one host. */
  machine: string
  eventId: number
  verb: WardenActionVerb
  payload?: Record<string, unknown>
}

/** Queues an owner action against one board item (`POST /warden/items/:eventId/actions`). This is
 * a request only — warden's own loop pulls it and owns every verb-level and state-gate decision. */
export async function enqueueWardenAction({
  machine,
  eventId,
  verb,
  payload,
}: EnqueueWardenActionParams) {
  return unwrap(
    await api.warden
      .items({ eventId: String(eventId) })
      .actions.post({ machine, verb, ...(payload !== undefined && { payload }) }),
  )
}
