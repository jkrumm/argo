import { and, desc, eq, lt, notInArray, sql } from 'drizzle-orm'
import type { AnyPgTable, PgColumn, PgTransaction } from 'drizzle-orm/pg-core'
import { db } from '../db/index.js'

// Shared push/pull contract for a "raw JSON snapshot per machine" table.
// `agent_overview_snapshots` and `warden_snapshots` are both shaped
// { id, machine, generated_at, received_at, raw } and both keep the latest
// row per machine plus a rolling 7-day history, pruned on every ingest — this
// module is the one place that owns the prune query, the byte cap and the
// epoch-ms-or-ISO timestamp parsing so the two routes can't drift apart.

export const HISTORY_DAYS = 7
// The global maxRequestBodySize (50 MB, index.ts) is the only other bound.
export const MAX_SNAPSHOT_BYTES = 1_000_000
// `Date` cannot represent |ms| beyond this; `toISOString()` throws past it.
const MAX_EPOCH_MS = 8.64e15

/** Accepts a producer's epoch-ms `generatedAt` as well as an ISO string. */
export function toIso(value: number | string): string | null {
  const ms = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(ms) || Math.abs(ms) > MAX_EPOCH_MS) return null
  return new Date(ms).toISOString()
}

/** Drizzle's `mode: 'string'` hands back Postgres text (`2026-09-11 00:18:18.791+00`); the API promises ISO 8601. */
export function pgIso(value: string): string {
  return new Date(value).toISOString()
}

/** True once the stringified snapshot exceeds the cap. */
export function exceedsSnapshotBytes(snapshot: unknown): boolean {
  return JSON.stringify(snapshot).length > MAX_SNAPSHOT_BYTES
}

type SnapshotColumns = { id: PgColumn; machine: PgColumn; received_at: PgColumn }

/**
 * Deletes rows older than `HISTORY_DAYS`, except the newest row per machine —
 * called inside the same transaction as the insert so a machine's very first
 * snapshot is never at risk of being pruned by a concurrent request.
 */
async function prunePastHistory(
  tx: PgTransaction<never, never, never>,
  table: AnyPgTable,
  columns: SnapshotColumns,
): Promise<void> {
  const cutoff = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const newestPerMachine = tx
    .select({ id: sql`max(${columns.id})` })
    .from(table)
    .groupBy(columns.machine)
  await tx
    .delete(table)
    .where(and(lt(columns.received_at, cutoff), notInArray(columns.id, newestPerMachine as never)))
}

/**
 * Inserts one snapshot row and prunes history in the same transaction, then
 * returns the id/receivedAt pair every ingest route responds with.
 */
export async function insertAndPruneSnapshot(
  table: AnyPgTable,
  columns: SnapshotColumns,
  values: { machine: string; generated_at: string; raw: unknown },
): Promise<{ id: number; receivedAt: string }> {
  return db.transaction(async (tx) => {
    const [row] = await (tx as unknown as PgTransaction<never, never, never>)
      .insert(table)
      .values(values as never)
      .returning({ id: columns.id, received_at: columns.received_at })
    await prunePastHistory(tx as unknown as PgTransaction<never, never, never>, table, columns)
    return { id: row!['id'] as number, receivedAt: pgIso(row!['received_at'] as string) }
  })
}

/** The most recently received snapshot row, optionally pinned to one `machine`. */
export async function latestSnapshotRow<Row>(
  table: AnyPgTable,
  columns: SnapshotColumns,
  machine: string | undefined,
): Promise<Row | undefined> {
  const [row] = await db
    .select()
    .from(table)
    .where(machine ? eq(columns.machine, machine) : undefined)
    .orderBy(desc(columns.received_at))
    .limit(1)
  return row as Row | undefined
}
