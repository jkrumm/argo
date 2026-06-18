import { Cron } from 'croner'
import { context, ROOT_CONTEXT, SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { and as drizzleAnd, eq as drizzleEq, isNotNull as drizzleIsNotNull } from 'drizzle-orm'
import { db } from '../db/index.js'
import { bookSyncMap, readingStat, userBook } from '../db/schema.js'
import {
  hardcover,
  type UserBookCreateInput,
  type UserBookUpdateInput,
} from '../clients/hardcover.js'
import { runReadingMatch } from '../lib/reading-match.js'
import { env } from '../env.js'
import { tracer } from '../telemetry.js'

let inProgress = false

/**
 * Wrap a cron tick in a fresh root span. Detaches from any ambient context
 * via ROOT_CONTEXT so each tick stands alone in the trace tree.
 */
async function tracedTick(
  name: string,
  attributes: Record<string, string>,
  fn: () => Promise<unknown>,
): Promise<void> {
  await context.with(ROOT_CONTEXT, () =>
    tracer.startActiveSpan(name, { kind: SpanKind.INTERNAL, attributes }, async (span) => {
      try {
        await fn()
        span.setStatus({ code: SpanStatusCode.OK })
      } catch (err) {
        span.recordException(err as Error)
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
        throw err
      } finally {
        span.end()
      }
    }),
  )
}

export async function runHardcoverReconcile(): Promise<{
  matched: number
  reconciled: number
  errors: number
}> {
  if (inProgress) {
    // eslint-disable-next-line no-console
    console.log('[hardcover-reconcile] already in progress — skipping')
    return { matched: 0, reconciled: 0, errors: 0 }
  }
  inProgress = true

  // eslint-disable-next-line no-console
  console.log('[hardcover-reconcile] starting')

  let errors = 0
  let reconciled = 0
  let matched = 0

  try {
    // Step 0: run the match scan first so the shelf mirror is fresh.
    const matchResult = await runReadingMatch()
    matched = matchResult.matched
    // eslint-disable-next-line no-console
    console.log(
      `[hardcover-reconcile] match scan done: scanned=${matchResult.scanned} matched=${matchResult.matched} autoConfirmed=${matchResult.autoConfirmed} enriched=${matchResult.enriched}`,
    )

    // Step 1: find confirmed maps joined with their stat and current shelf entry.
    const rows = await db
      .select({
        book_key: bookSyncMap.book_key,
        hardcover_book_id: bookSyncMap.hardcover_book_id,
        hardcover_edition_id: bookSyncMap.hardcover_edition_id,
        // reading telemetry
        total_read_seconds: readingStat.total_read_seconds,
        sessions: readingStat.sessions,
        current_percent: readingStat.current_percent,
        last_read_at: readingStat.last_read_at,
        // existing shelf entry (if any)
        hardcover_user_book_id: userBook.hardcover_user_book_id,
        current_status_id: userBook.status_id,
      })
      .from(bookSyncMap)
      .innerJoin(readingStat, drizzleEq(bookSyncMap.book_key, readingStat.book_key))
      .leftJoin(userBook, drizzleEq(bookSyncMap.hardcover_book_id, userBook.hardcover_book_id))
      .where(
        drizzleAnd(
          drizzleEq(bookSyncMap.confirmed, 1),
          drizzleIsNotNull(bookSyncMap.hardcover_book_id),
        ),
      )

    for (const row of rows) {
      const hardcoverBookId = row.hardcover_book_id
      if (hardcoverBookId === null) continue

      // Compute desired status.
      let desiredStatus: number
      if ((row.current_percent ?? 0) >= 95) {
        desiredStatus = 3 // Read
      } else if ((row.total_read_seconds ?? 0) > 0 || (row.sessions ?? 0) > 0) {
        desiredStatus = 2 // Currently Reading
      } else {
        continue // no activity yet
      }

      const currentStatus = row.current_status_id ?? 0

      // Never downgrade: if Hardcover already reflects the same or a higher status, skip.
      if (desiredStatus <= currentStatus) continue

      const date = ((row.last_read_at as string | null) ?? new Date().toISOString()).slice(0, 10)

      try {
        if (row.hardcover_user_book_id !== null) {
          // Update existing user_book on Hardcover.
          const object: UserBookUpdateInput = {
            status_id: desiredStatus,
            first_started_reading_date: date,
          }
          if (desiredStatus === 3) object.last_read_date = date

          await hardcover.updateUserBook(row.hardcover_user_book_id, object)

          // Write-through to local DB so GET /reading reflects it immediately.
          await db
            .update(userBook)
            .set({
              status_id: desiredStatus,
              first_started_reading_date: date,
              ...(desiredStatus === 3 ? { last_read_date: date } : {}),
            })
            .where(drizzleEq(userBook.hardcover_user_book_id, row.hardcover_user_book_id))
        } else {
          // Not on shelf yet — insert.
          const create: UserBookCreateInput = {
            book_id: hardcoverBookId,
            status_id: desiredStatus,
            first_started_reading_date: date,
          }
          if (row.hardcover_edition_id !== null) create.edition_id = row.hardcover_edition_id
          if (desiredStatus === 3) create.last_read_date = date

          const newId = await hardcover.insertUserBook(create)

          // Write-through: insert into local user_book table.
          await db
            .insert(userBook)
            .values({
              hardcover_user_book_id: newId,
              hardcover_book_id: hardcoverBookId,
              status_id: desiredStatus,
              first_started_reading_date: date,
              has_review: 0, // 0 | 1
              ...(desiredStatus === 3 ? { last_read_date: date } : {}),
            })
            .onConflictDoNothing()
        }

        reconciled++
      } catch (err) {
        errors++
        // eslint-disable-next-line no-console
        console.error(`[hardcover-reconcile] error for book_key=${row.book_key}:`, err)
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `[hardcover-reconcile] done: matched=${matched} reconciled=${reconciled} errors=${errors}`,
    )
  } catch (e) {
    errors++
    // eslint-disable-next-line no-console
    console.error('[hardcover-reconcile] fatal error:', e)
  } finally {
    inProgress = false
  }

  return { matched, reconciled, errors }
}

export function registerHardcoverReconcileCron(): void {
  if (!env.HARDCOVER_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn('[hardcover-reconcile] HARDCOVER_API_KEY not set — cron disabled')
    return
  }

  // Daily at 05:30 UTC — after the 05:00 shelf sync so the mirror is fresh.
  new Cron('30 5 * * *', () => {
    void tracedTick('cron.hardcover-reconcile.scheduled', { 'cron.schedule': '30 5 * * *' }, () =>
      runHardcoverReconcile(),
    )
  })

  // eslint-disable-next-line no-console
  console.log('[hardcover-reconcile] cron registered (daily at 05:30 UTC)')
}
