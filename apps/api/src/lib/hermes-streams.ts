import { and, eq, isNull } from 'drizzle-orm'
import type { db as db_ } from '../db/index.js'
import { hermesMessage, hermesThread } from '../db/schema.js'
import { log } from '../telemetry.js'

// Extracted from routes/hermes.ts (Phase A1) so the CAS + stream-liveness logic
// guarding POST /hermes/chat can be exercised in memory, without Postgres or an
// HTTP round trip. This logic guards against real, previously-shipped bugs — see
// docs/HERMES-CHAT-PRD.md and the doc comments on each function below, which
// encode the multi-process honesty argument and the register-before-CAS
// ordering. Move faithfully; do not redesign.

type Db = typeof db_

/**
 * Port over a thread's `active_stream_id` pointer. `casActiveStreamId` is a
 * compare-and-swap: it writes `next` only if the pointer currently equals
 * `expected` (an `expected: null` CAS must take the SQL `IS NULL` branch, not
 * `= NULL`), and reports whether the write happened.
 */
export type ThreadPointerStore = {
  readActiveStreamId(threadId: string): Promise<string | null>
  casActiveStreamId(args: {
    threadId: string
    expected: string | null
    next: string | null
  }): Promise<boolean>
}

/**
 * Port over turn-level idempotency — mirrors the partial unique index
 * `uq_hermes_message_thread_client_id` (schema.ts).
 */
export type TurnLedger = {
  hasClientMessage(threadId: string, clientMessageId: string): Promise<boolean>
}

/**
 * Port over the durable streaming backend — only the two members the liveness
 * logic below actually calls: the in-process registry check (`has`) and the
 * cross-process pub/sub resume probe (`resumeExistingStream`). See
 * `lib/resumable.ts`'s `HermesStreaming` for the full production interface;
 * this is the subset this module depends on.
 */
export type HermesStreaming = {
  has(streamId: string): boolean
  resumeExistingStream(streamId: string): Promise<ReadableStream<string> | null>
}

/**
 * Clear a thread's active-stream pointer, but only if it still points at
 * `streamId` — the AND-guard avoids clobbering a newer turn that already
 * superseded it. Used to reap a stale pointer left by a crashed/restarted
 * producer (whose `onFinish` cleanup never ran).
 */
export async function clearActiveStream(
  store: ThreadPointerStore,
  threadId: string,
  streamId: string,
): Promise<void> {
  await store.casActiveStreamId({ threadId, expected: streamId, next: null })
}

/**
 * True when a hermes_message row already exists for this (threadId,
 * clientMessageId) pair — i.e. this exact client-supplied turn id has already
 * been persisted at least once, by an earlier request's early-write or its
 * onFinish fallback. Mirrors the predicate of the partial unique index
 * `uq_hermes_message_thread_client_id` (schema.ts) exactly, so this can never
 * disagree with what `persistMessages`'s own `ON CONFLICT DO NOTHING` would
 * dedupe against.
 */
export async function turnAlreadyPersisted(
  ledger: TurnLedger,
  threadId: string,
  clientMessageId: string,
): Promise<boolean> {
  return ledger.hasClientMessage(threadId, clientMessageId)
}

/**
 * Resolve a `resumeExistingStream` call to "live" (a stream) or "dead" (null),
 * collapsing a rejection (crashed-producer ~1s ack timeout — see resumable.ts)
 * into dead too. Both the POST claim (`isStreamLive`, 409s on live) and the GET
 * resume handler (reaps a dead pointer) call this so the two can never
 * independently drift on what "dead" means — which is exactly how the pointer-
 * reaping defect this replaces was introduced in the first place.
 */
export async function resumeOrDead(
  streaming: HermesStreaming,
  streamId: string,
): Promise<ReadableStream<string> | null> {
  try {
    return await streaming.resumeExistingStream(streamId)
  } catch (error) {
    log.error('hermes resume failed (stale/timeout)', error)
    return null
  }
}

/**
 * Two-tier liveness probe. Tier 1 is the in-process registry (`has`) — true the
 * instant THIS process's `register()` has run for `streamId`, synchronously and
 * with no round trip. That closes the exact race this function used to lose: a
 * stream this process just claimed via `claimActiveStream` is registered BEFORE
 * the CAS write, so a second POST reading the freshly-written pointer always
 * finds `has()` already true — it can never observe "pointer set, not yet live".
 *
 * Tier 2 (only reached when tier 1 says no — this process never registered
 * `streamId`, e.g. it's stale or belongs to another replica) falls back to the
 * pub/sub probe: `resumeExistingStream` performs a real round trip against the
 * live producer (resumable-stream/dist/runtime.js `resumeStream` — a fresh,
 * randomly generated `listenerId` per call, so concurrent probes and a real
 * client resume never collide), so a resolved non-null stream means a producer
 * answered RIGHT NOW. We only need the yes/no, so the probe stream is cancelled
 * immediately; cancelling drops our listener channel without disturbing the
 * underlying resumable-stream broadcast (a genuine consumer of the same
 * streamId, e.g. the dashboard's actual resume GET, gets its own independent
 * listener and is unaffected). A stale/gone pointer — the case a change here
 * most easily breaks — still resolves to dead: `has()` is false (nothing
 * registered for it in this process) and the probe finds no producer either.
 */
export async function isStreamLive(streaming: HermesStreaming, streamId: string): Promise<boolean> {
  if (streaming.has(streamId)) return true
  const resumed = await resumeOrDead(streaming, streamId)
  if (!resumed) return false
  await resumed.cancel()
  return true
}

/**
 * Claim a thread's active-stream pointer via a liveness-gated compare-and-swap.
 * A genuinely live existing stream is left untouched (the caller 409s instead of
 * superseding it — see the standing ruling in the route). A dead or absent
 * pointer is atomically overwritten by `streamId`: the UPDATE's WHERE clause
 * pins the exact previously-observed value (or `IS NULL`), so if a second racing
 * POST already won between our read and this write, our UPDATE matches zero
 * rows and we lose cleanly instead of clobbering the winner's fresh pointer.
 *
 * Multi-process honesty: liveness is answered two-tier by `isStreamLive` — the
 * in-process registry first (authoritative for what THIS process itself just
 * registered, no round trip, no race — see its doc), then `resumeExistingStream`
 * as the only cross-process signal `HermesStreaming` exposes. A live producer in
 * another replica publishing over the same Valkey pub/sub answers that probe
 * correctly; an unreachable/slow replica collapses to "dead" via the ~1s ack
 * timeout in `resumeOrDead`. Argo runs single-instance (resumable.ts's own module
 * doc: durability does not survive a restart), so "producer crashed" is the far
 * likelier explanation for a stuck pointer than "producer is a live replica that
 * hasn't acked yet" — treating a timeout as dead is the honest choice for this
 * deployment, not merely the convenient one.
 */
export async function claimActiveStream(
  deps: { store: ThreadPointerStore; streaming: HermesStreaming },
  threadId: string,
  streamId: string,
): Promise<boolean> {
  const existingId = await deps.store.readActiveStreamId(threadId)
  if (existingId && (await isStreamLive(deps.streaming, existingId))) return false

  return deps.store.casActiveStreamId({ threadId, expected: existingId, next: streamId })
}

/** Production `ThreadPointerStore` backed by `hermes_thread.active_stream_id`. */
export function createDrizzleThreadPointerStore(db: Db): ThreadPointerStore {
  return {
    async readActiveStreamId(threadId) {
      const existing = await db.query.hermesThread.findFirst({
        where: eq(hermesThread.id, threadId),
        columns: { active_stream_id: true },
      })
      return existing?.active_stream_id ?? null
    },
    async casActiveStreamId({ threadId, expected, next }) {
      const claimCondition = expected
        ? eq(hermesThread.active_stream_id, expected)
        : isNull(hermesThread.active_stream_id)
      const claimed = await db
        .update(hermesThread)
        .set({ active_stream_id: next })
        .where(and(eq(hermesThread.id, threadId), claimCondition))
        .returning({ id: hermesThread.id })
      return claimed.length > 0
    },
  }
}

/** Production `TurnLedger` backed by `hermes_message`. */
export function createDrizzleTurnLedger(db: Db): TurnLedger {
  return {
    async hasClientMessage(threadId, clientMessageId) {
      const existing = await db.query.hermesMessage.findFirst({
        where: and(
          eq(hermesMessage.thread_id, threadId),
          eq(hermesMessage.client_message_id, clientMessageId),
        ),
        columns: { id: true },
      })
      return existing !== undefined
    },
  }
}
