import { Elysia } from 'elysia'
import { z } from 'zod'
import { wardenSnapshot } from '../db/schema.js'
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
