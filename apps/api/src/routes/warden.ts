import { Elysia } from 'elysia'
import { z } from 'zod'
import { and, eq, lt, or } from 'drizzle-orm'
import { db } from '../db/index.js'
import { wardenAction, wardenSnapshot } from '../db/schema.js'
import {
  exceedsSnapshotBytes,
  insertAndPruneSnapshot,
  latestSnapshotRow,
  MAX_SNAPSHOT_BYTES,
  pgIso,
  toIso,
} from '../lib/snapshot-store.js'

// Warden control-plane board — warden (the mini's deterministic loop over its
// own SQLite ledger) pushes one JSON snapshot after every loop tick: health,
// the six funnel metrics, the board (counts + open items), the dispatch
// budget, per-item timelines, and recorded intents. Argo derives nothing —
// the snapshot is stored as raw jsonb, validated LOOSELY (`looseObject`
// throughout, only `machine`/`generatedAt` checked strictly) so a new warden
// field never 422s the ingest, and served back verbatim. Retention mirrors
// `/agents/overview`: the latest snapshot per machine plus a rolling 7-day
// history, pruned on every ingest.

/** Accepts warden's epoch-ms `generatedAt` as well as an ISO string. */
const TimestampInput = z
  .union([z.number(), z.string()])
  .describe('Epoch milliseconds or an ISO 8601 timestamp')

/**
 * One of the six funnel metrics. Five are a leaf `{value, unavailable}` pair (`value: null`
 * always pairing with a non-empty `unavailable` reason); the sixth, `reverts_and_reopens`, is a
 * composite with no top-level leaf — its children are themselves `{value, unavailable}` pairs.
 * Validated loosely on shape alone so neither variant 422s the ingest; the dashboard's
 * `deriveFunnel` sorts leaf vs composite out.
 */
const FunnelMetricSchema = z.looseObject({})

const HealthSchema = z.looseObject({
  ok: z.boolean(),
  schema_version: z.number().optional(),
  schema_version_expected: z.number().optional(),
  db_path: z.string().optional(),
  db_mtime: z.string().nullable().optional(),
  pollers: z.record(z.string(), z.looseObject({})).optional(),
  checked_at: z.string().optional(),
})

const MetricsSchema = z.looseObject({
  generated_at: z.string().optional(),
  window_days: z.number().optional(),
  history_since: z.string().nullable().optional(),
  verdicts_recorded_disposition: FunnelMetricSchema.optional(),
  verified_fixes_vs_silence: FunnelMetricSchema.optional(),
  median_needs_human_to_decision_hours: FunnelMetricSchema.optional(),
  verified_unattended_fixes_per_week: FunnelMetricSchema.optional(),
  poller_ages: FunnelMetricSchema.optional(),
  reverts_and_reopens: FunnelMetricSchema.optional(),
})

// The closed verb list an owner action against a board item may carry — mirrored from warden's own
// `ARGO_ACTION_VERBS`; keep both in sync if either changes. Hoisted above `BoardItemSchema` so the
// board payload's own `availableActions` field can reuse it.
const WARDEN_ACTION_VERBS = ['implement', 'merge', 'dismiss', 'reinvestigate', 'note'] as const

const BoardItemSchema = z.looseObject({
  event_id: z.number(),
  origin: z.string().nullable().optional(),
  repo: z.string().nullable().optional(),
  state: z.string(),
  state_deadline: z.string().nullable().optional(),
  max_tier: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  pr_url: z.string().nullable().optional(),
  dispatch_job: z.string().nullable().optional(),
  implement_job: z.string().nullable().optional(),
  validation_job: z.string().nullable().optional(),
  occurrences: z.number().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  origin_channel: z.string().nullable().optional(),
  origin_thread_ts: z.string().nullable().optional(),
  // A plain `z.string()`, not `z.enum(WARDEN_ACTION_VERBS)` — warden and Argo are deployed
  // separately with this vocabulary manually mirrored between them (see the comment above), and a
  // hard enum here would 422 the ENTIRE snapshot (health, metrics, budget, board, intents) over one
  // item carrying a verb the two repos haven't synced on yet. The dashboard already only renders
  // buttons for verbs it recognizes (`VERB_LABEL`).
  availableActions: z.array(z.string()).optional(),
  issue: z
    .looseObject({
      repo: z.string(),
      number: z.number(),
      url: z.string(),
      // Less certain to always be present than repo/number/url — a deleted GitHub account, for
      // instance, can leave `author` unresolvable — so these two stay optional rather than 422ing
      // the snapshot over a single item's missing field.
      author: z.string().optional(),
      trusted: z.boolean().optional(),
      labels: z.array(z.string()).optional(),
    })
    .nullable()
    .optional(),
})

const BoardSchema = z.looseObject({
  generated_at: z.string().optional(),
  schema_version: z.number().optional(),
  counts: z.record(z.string(), z.number()).optional(),
  items: z.array(BoardItemSchema).optional(),
  terminal_24h: z.number().optional(),
  truncated: z.boolean().optional(),
})

const BudgetSchema = z.looseObject({
  usedToday: z.number().optional(),
  max: z.number().optional(),
  remaining: z.number().optional(),
  implementToday: z.number().optional(),
  implementMax: z.number().optional(),
  implementRemaining: z.number().optional(),
  warnings: z.array(z.string()).optional(),
})

/** One item's per-event timeline — item/event rows, dispatches, operations, approvals, transitions. */
const ItemTimelineSchema = z.looseObject({
  item: z.looseObject({}).optional(),
  event: z.looseObject({}).optional(),
  dispatches: z.array(z.looseObject({})).optional(),
  operations: z.array(z.looseObject({})).optional(),
  approvals: z.array(z.looseObject({})).optional(),
  transitions: z.array(z.looseObject({})).optional(),
})

const IntentEntrySchema = z.looseObject({
  file: z.string().optional(),
  kind: z.string().optional(),
  created_at: z.string().optional(),
  source: z.string().optional(),
  decision: z.string().optional(),
  status: z.string().optional(),
})

const IntentsSchema = z.looseObject({
  pending: z.number().optional(),
  rejected: z.number().optional(),
  entries: z.array(IntentEntrySchema).optional(),
})

/** The stored snapshot — warden's board payload; every field past `generatedAt` is optional. */
const SnapshotSchema = z.looseObject({
  generatedAt: z.union([z.number(), z.string()]),
  health: HealthSchema.optional(),
  metrics: MetricsSchema.optional(),
  board: BoardSchema.optional(),
  budget: BudgetSchema.optional(),
  items: z.record(z.string(), ItemTimelineSchema).optional(),
  itemsTruncated: z.boolean().optional(),
  intents: IntentsSchema.optional(),
})

const WardenIngestSchema = SnapshotSchema.extend({
  machine: z.string().min(1).max(64).describe('Producer host, e.g. "mini"'),
  generatedAt: TimestampInput,
})

const WardenColumns = {
  id: wardenSnapshot.id,
  machine: wardenSnapshot.machine,
  received_at: wardenSnapshot.received_at,
}

const WardenRecordSchema = z.object({
  id: z.number().int(),
  machine: z.string(),
  generatedAt: z.string().describe('ISO 8601'),
  receivedAt: z.string().describe('ISO 8601'),
  ageMs: z.number().describe('Milliseconds since receivedAt'),
  raw: SnapshotSchema,
})

function toWardenRecord(row: typeof wardenSnapshot.$inferSelect) {
  const receivedAt = pgIso(row.received_at)
  return {
    id: row.id,
    machine: row.machine,
    generatedAt: pgIso(row.generated_at),
    receivedAt,
    ageMs: Math.max(0, Date.now() - Date.parse(receivedAt)),
    raw: row.raw as z.infer<typeof SnapshotSchema>,
  }
}

// ── Owner action queue ───────────────────────────────────────────────────
//
// The dashboard queues an action against a board item; warden's loop polls
// for its machine's pending rows and reports the outcome. Warden owns every
// verb-level and state-gate decision server-side (`apply_argo_actions()`) —
// this queue only carries the request and its eventual outcome. `WARDEN_ACTION_VERBS` itself is
// declared above `BoardItemSchema`, which also reuses it.
const WARDEN_ACK_STATUSES = ['applied', 'rejected', 'failed'] as const
// 'pulled' is the internal in-flight marker GET /warden/actions atomically
// claims a row into — see the schema.ts comment. No route response ever
// returns it, but it's a real column value, so every place that reads
// `status` back off a row (the enum below, toActionRecord's guard) has to
// account for it.
const WARDEN_ACTION_STATUSES = ['pending', 'pulled', ...WARDEN_ACK_STATUSES] as const

// A dismiss reason or a `{pr_url}` result is a few dozen bytes; this is
// generous headroom, not a real budget — it exists only so the shared
// bearer token can't be used to grow this table unbounded the way an
// unrelated snapshot cap already guards `warden_snapshots`.
const MAX_ACTION_JSON_BYTES = 100_000

function exceedsActionJsonBytes(value: unknown): boolean {
  return value !== undefined && JSON.stringify(value).length > MAX_ACTION_JSON_BYTES
}

// PostgreSQL UPDATE...RETURNING is per-row atomic: a second concurrent
// UPDATE with the same WHERE re-checks it against each row's committed
// state, so it can never also match a row the first UPDATE already flipped
// to 'pulled'. Reclaims a pulled row after this lease elapses with no ack —
// warden polls roughly every 10 minutes, so a claim older than that is
// either a crashed tick or one that will never ack.
const PULL_CLAIM_LEASE_MS = 10 * 60 * 1000

const EnqueueActionSchema = z.object({
  machine: z
    .string()
    .min(1)
    .max(64)
    .describe('The warden host this action is queued for, e.g. "mini"'),
  verb: z
    .string()
    .min(1)
    .describe(`One of: ${WARDEN_ACTION_VERBS.join(', ')}`),
  payload: z.record(z.string(), z.unknown()).optional(),
})

const ActionRecordSchema = z.object({
  id: z.number().int(),
  eventId: z.number().int(),
  machine: z.string(),
  verb: z.string(),
  status: z.enum(WARDEN_ACTION_STATUSES),
  createdAt: z.string().describe('ISO 8601'),
})

function toActionRecord(row: typeof wardenAction.$inferSelect) {
  if (!(WARDEN_ACTION_STATUSES as readonly string[]).includes(row.status)) {
    throw new Error(`warden_actions row ${row.id} has an unrecognized status: ${row.status}`)
  }
  return {
    id: row.id,
    eventId: row.event_id,
    machine: row.machine,
    verb: row.verb,
    status: row.status as (typeof WARDEN_ACTION_STATUSES)[number],
    createdAt: pgIso(row.created_at),
  }
}

// The shape warden's `fetch_actions()` parses with plain dict `.get()` calls
// (scripts/clients/argo.py) — `event_id`/`payload` stay snake_case here even
// though every other Argo response is camelCase, because this one is a
// wire contract with warden's Python client, not with the dashboard.
const PulledActionSchema = z.object({
  id: z.number().int(),
  event_id: z.number().int(),
  verb: z.string(),
  payload: z.record(z.string(), z.unknown()).nullable(),
})

const AckActionSchema = z.object({
  status: z.enum(WARDEN_ACK_STATUSES),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
})

export const wardenRoutes = new Elysia({ prefix: '/warden' })
  .post(
    '/snapshot',
    async ({ body, status }) => {
      const generatedAt = toIso(body.generatedAt)
      if (!generatedAt) return status(400, 'generatedAt is not a valid timestamp')

      const { machine, ...snapshot } = body
      if (exceedsSnapshotBytes(snapshot)) {
        return status(413, `Snapshot exceeds ${MAX_SNAPSHOT_BYTES} bytes`)
      }
      const inserted = await insertAndPruneSnapshot(wardenSnapshot, WardenColumns, {
        machine,
        generated_at: generatedAt,
        raw: snapshot,
      })
      return status(201, inserted)
    },
    {
      body: WardenIngestSchema,
      response: {
        201: z.object({ id: z.number().int(), receivedAt: z.string() }),
        400: z.string(),
        413: z.string(),
      },
      detail: {
        tags: ['Warden'],
        summary: 'Ingest a Warden control-plane snapshot',
        description:
          'Stores one Warden loop-tick snapshot (health, the six funnel metrics, the board counts + open items, the dispatch budget, per-item timelines, recorded intents) tagged with the producing `machine`. Pushed by the mini roughly every 10 minutes — Argo on the VPS cannot reach the ledger directly. Unknown fields are kept verbatim — the snapshot is stored as raw JSON, and a metric leaf whose `value` is null always carries a non-empty `unavailable` reason (never render it as 0). Every ingest prunes snapshots older than 7 days, keeping the newest per machine. Snapshots over 1 MB are rejected with 413. Read it back with GET /warden/snapshot.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/snapshot',
    async ({ query, status }) => {
      const row = await latestSnapshotRow<typeof wardenSnapshot.$inferSelect>(
        wardenSnapshot,
        WardenColumns,
        query.machine,
      )
      if (!row) return status(404, 'No Warden snapshot received yet')
      return toWardenRecord(row)
    },
    {
      query: z.object({
        machine: z.string().optional().describe('Restrict to one producer host'),
      }),
      response: { 200: WardenRecordSchema, 404: z.string() },
      detail: {
        tags: ['Warden'],
        summary: 'Latest Warden control-plane snapshot',
        description:
          'Returns the most recently received Warden snapshot (404 before the first ingest, or for a `?machine=` that never pushed). Pass ?machine= to pin one host when several push. `ageMs` is milliseconds since `receivedAt`, for a stale-feed banner. The snapshot carries `health` (loop/poller liveness), `metrics` (the six funnel numbers), `board` (counts + open items), `budget` (dispatch spend today), `items` (per-event timelines, keyed by event id) and `intents` (recorded, unauthorized wishes).',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '/items/:eventId/actions',
    async ({ params, body, status }) => {
      if (!(WARDEN_ACTION_VERBS as readonly string[]).includes(body.verb)) {
        return status(400, `unknown verb: ${body.verb}`)
      }
      if (exceedsActionJsonBytes(body.payload)) {
        return status(413, `payload exceeds ${MAX_ACTION_JSON_BYTES} bytes`)
      }
      const [row] = await db
        .insert(wardenAction)
        .values({
          machine: body.machine,
          event_id: params.eventId,
          verb: body.verb,
          payload: body.payload ?? null,
        })
        .returning()
      return status(201, toActionRecord(row!))
    },
    {
      params: z.object({ eventId: z.coerce.number().int() }),
      body: EnqueueActionSchema,
      response: { 201: ActionRecordSchema, 400: z.string(), 413: z.string() },
      detail: {
        tags: ['Warden'],
        summary: 'Queue an owner action against a Warden board item',
        description:
          "Queues implement/merge/dismiss/reinvestigate/note against the board item {eventId} for the owner's Warden machine. This is a request only — warden's loop (loopback-only, cannot be pushed to) pulls it via GET /warden/actions and owns every verb-level and state-gate decision; nothing here mutates the ledger. Returns 201 with the queued row (status always starts `pending`); an unrecognized verb is rejected with 400 before it ever reaches the queue, an oversized payload with 413. Track the outcome via the next GET /warden/snapshot, whose board items carry `availableActions`.",
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/actions',
    async ({ query, status: statusFn }) => {
      const wantedStatus = query.status ?? 'pending'
      // Pulling 'pending' is warden's own poll — atomically claim it (flip to
      // 'pulled') in the same statement that selects it, so two overlapping
      // polls can never both fetch the same row. Any other ?status= is a
      // plain read with no side effect. See PULL_CLAIM_LEASE_MS's docstring
      // for why a stale 'pulled' row is reclaimed rather than lost forever.
      const rows =
        wantedStatus === 'pending'
          ? await db
              .update(wardenAction)
              .set({ status: 'pulled', pulled_at: new Date().toISOString() })
              .where(
                and(
                  eq(wardenAction.machine, query.machine),
                  or(
                    eq(wardenAction.status, 'pending'),
                    and(
                      eq(wardenAction.status, 'pulled'),
                      lt(
                        wardenAction.pulled_at,
                        new Date(Date.now() - PULL_CLAIM_LEASE_MS).toISOString(),
                      ),
                    ),
                  ),
                ),
              )
              .returning()
          : await db
              .select()
              .from(wardenAction)
              .where(
                and(eq(wardenAction.machine, query.machine), eq(wardenAction.status, wantedStatus)),
              )
      const sorted = rows.toSorted((a, b) => a.created_at.localeCompare(b.created_at))
      return statusFn(
        200,
        sorted.map((row) => ({
          id: row.id,
          event_id: row.event_id,
          verb: row.verb,
          payload: row.payload,
        })),
      )
    },
    {
      query: z.object({
        machine: z.string().min(1).max(64).describe('The warden host pulling its own queue'),
        status: z.enum(WARDEN_ACTION_STATUSES).optional().describe('Defaults to "pending"'),
      }),
      response: { 200: z.array(PulledActionSchema) },
      detail: {
        tags: ['Warden'],
        summary: "Pull one machine's queued owner actions",
        description:
          "Called by warden's own loop, never the dashboard — the one endpoint whose response shape (`id`/`event_id`/`payload` snake_case) mirrors clients/argo.py's `fetch_actions()` parser rather than the rest of this API's camelCase convention. Returns queued rows for `?machine=`, filtered to `?status=` (default `pending`), oldest first. A `pending` pull atomically claims the rows it returns (flips them to an internal `pulled` state) so a second overlapping pull never receives the same row; an abandoned claim is reclaimed after 10 minutes. Report each one back via POST /warden/actions/{id}/ack once applied.",
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '/actions/:id/ack',
    async ({ params, body, status }) => {
      if (exceedsActionJsonBytes(body.result)) {
        return status(413, `result exceeds ${MAX_ACTION_JSON_BYTES} bytes`)
      }
      const [row] = await db
        .update(wardenAction)
        .set({
          status: body.status,
          result: body.result ?? null,
          error: body.error ?? null,
          acked_at: new Date().toISOString(),
        })
        .where(eq(wardenAction.id, params.id))
        .returning()
      if (!row) return status(404, 'No queued action with this id')
      return toActionRecord(row)
    },
    {
      params: z.object({ id: z.coerce.number().int() }),
      body: AckActionSchema,
      response: { 200: ActionRecordSchema, 404: z.string(), 413: z.string() },
      detail: {
        tags: ['Warden'],
        summary: 'Report the outcome of one queued owner action',
        description:
          "Called by warden after it applies (or rejects) a queued action — `status` is the action's own outcome (applied/rejected/failed), never an HTTP status. Idempotent: acking an already-acked id overwrites its status/result/error/ackedAt rather than erroring, since a redelivered ack (the first POST's response was lost) must resolve the same way twice. 404 only for an id that was never queued.",
        security: [{ BearerAuth: [] }],
      },
    },
  )
