import { Cron } from 'croner'
import { context, ROOT_CONTEXT, SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { userBook } from '../db/schema.js'
import { hardcover, type HardcoverUserBook } from '../clients/hardcover.js'
import { upsertBook } from '../lib/book-store.js'
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

async function upsertBooks(rows: HardcoverUserBook[]): Promise<void> {
  if (rows.length === 0) return

  const now = new Date().toISOString()

  for (const row of rows) {
    await upsertBook(row, now)
  }
}

async function upsertUserBooks(rows: HardcoverUserBook[]): Promise<void> {
  if (rows.length === 0) return

  const now = new Date().toISOString()

  for (const row of rows) {
    await db
      .insert(userBook)
      .values({
        hardcover_user_book_id: row.hardcoverUserBookId,
        hardcover_book_id: row.hardcoverBookId,
        status_id: row.statusId,
        rating: row.rating,
        review_raw: row.reviewRaw,
        has_review: row.hasReview ? 1 : 0,
        first_started_reading_date: row.firstStartedReadingDate,
        first_read_date: row.firstReadDate,
        last_read_date: row.lastReadDate,
        date_added: row.dateAdded,
        edition_id: row.editionId,
        hardcover_updated_at: row.hardcoverUpdatedAt,
        synced_at: now,
      })
      .onConflictDoUpdate({
        target: userBook.hardcover_user_book_id,
        set: {
          hardcover_book_id: sql`excluded.hardcover_book_id`,
          status_id: sql`excluded.status_id`,
          rating: sql`excluded.rating`,
          review_raw: sql`excluded.review_raw`,
          has_review: sql`excluded.has_review`,
          first_started_reading_date: sql`excluded.first_started_reading_date`,
          first_read_date: sql`excluded.first_read_date`,
          last_read_date: sql`excluded.last_read_date`,
          date_added: sql`excluded.date_added`,
          edition_id: sql`excluded.edition_id`,
          hardcover_updated_at: sql`excluded.hardcover_updated_at`,
          synced_at: sql`excluded.synced_at`,
        },
      })
  }
}

export async function runHardcoverSync(): Promise<{ upserted: number; errors: number }> {
  if (inProgress) {
    // eslint-disable-next-line no-console
    console.log('[hardcover-sync] already in progress — skipping')
    return { upserted: 0, errors: 0 }
  }
  inProgress = true

  // eslint-disable-next-line no-console
  console.log('[hardcover-sync] starting')
  let errors = 0
  let upserted = 0

  try {
    const rows = await hardcover.myShelf()
    upserted = rows.length

    await upsertBooks(rows)
    await upsertUserBooks(rows)

    // eslint-disable-next-line no-console
    console.log(`[hardcover-sync] done: upserted=${upserted}`)
  } catch (e) {
    errors += 1
    // eslint-disable-next-line no-console
    console.error('[hardcover-sync] failed:', e)
  } finally {
    inProgress = false
  }

  return { upserted, errors }
}

export function registerHardcoverSyncCron(): void {
  if (!env.HARDCOVER_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn('[hardcover-sync] HARDCOVER_API_KEY not set — cron disabled')
    return
  }

  // Daily at 05:00 UTC — low-traffic hour, well clear of midnight crons.
  new Cron('0 5 * * *', () => {
    void tracedTick('cron.hardcover-sync.scheduled', { 'cron.schedule': '0 5 * * *' }, () =>
      runHardcoverSync(),
    )
  })

  // eslint-disable-next-line no-console
  console.log('[hardcover-sync] cron registered (daily at 05:00 UTC)')
}
