import { Elysia } from 'elysia'
import { z } from 'zod'
import { desc, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { book, userBook, readingStat } from '../db/schema.js'
import { runHardcoverSync } from '../cron/hardcover-sync.js'

// ── Status id → label map ─────────────────────────────────────────────────────

const STATUS_LABELS: Record<number, string> = {
  1: 'Want to Read',
  2: 'Currently Reading',
  3: 'Read',
  4: 'Paused',
  5: 'Did Not Finish',
  6: 'Ignored',
}

// ── Shared Zod schemas ────────────────────────────────────────────────────────

const ShelfItemSchema = z.object({
  hardcoverBookId: z.number().int(),
  title: z.string(),
  subtitle: z.string().nullable(),
  authors: z.array(z.string()),
  genres: z.array(z.string()),
  pages: z.number().int().nullable(),
  releaseYear: z.number().int().nullable(),
  coverUrl: z.string().nullable(),
  statusId: z.number().int(),
  status: z.string().describe('Human-readable status label'),
  rating: z.number().nullable(),
  hasReview: z.boolean(),
  startedDate: z.string().nullable().describe('first_started_reading_date from Hardcover'),
  readDate: z.string().nullable().describe('first_read_date from Hardcover'),
  lastReadDate: z.string().nullable(),
  dateAdded: z.string().nullable(),
  stats: z.null().describe('Reserved for Phase B reading-stat enrichment'),
})

const SummarySchema = z.object({
  total: z.number().int(),
  wantToRead: z.number().int(),
  currentlyReading: z.number().int(),
  read: z.number().int(),
  paused: z.number().int(),
  dnf: z.number().int(),
  ratedCount: z.number().int(),
  avgRating: z.number().nullable().describe('Mean of non-null ratings, rounded to 2 dp'),
})

const StatInputSchema = z.object({
  bookKey: z
    .string()
    .describe('Unique key for the book in the source system (e.g. file path or UUID)'),
  title: z.string().optional().nullable().default(null),
  author: z.string().optional().nullable().default(null),
  totalReadSeconds: z.number().int().default(0),
  pagesRead: z.number().int().default(0),
  currentPercent: z.number().min(0).max(100).default(0),
  sessions: z.number().int().default(0),
  lastReadAt: z.string().optional().nullable().default(null).describe('ISO 8601 timestamp'),
  raw: z.unknown().optional().nullable().default(null).describe('Original payload from the source'),
})

// ── Route handlers ────────────────────────────────────────────────────────────

export const readingRoutes = new Elysia({ prefix: '/reading' })
  .get(
    '',
    async () => {
      const rows = await db
        .select({
          // user_book fields
          hardcoverUserBookId: userBook.hardcover_user_book_id,
          hardcoverBookId: userBook.hardcover_book_id,
          statusId: userBook.status_id,
          rating: userBook.rating,
          hasReview: userBook.has_review,
          startedDate: userBook.first_started_reading_date,
          readDate: userBook.first_read_date,
          lastReadDate: userBook.last_read_date,
          dateAdded: userBook.date_added,
          hardcoverUpdatedAt: userBook.hardcover_updated_at,
          // book fields
          title: book.title,
          subtitle: book.subtitle,
          authors: book.authors,
          genres: book.genres,
          pages: book.pages,
          releaseYear: book.release_year,
          coverUrl: book.cover_url,
        })
        .from(userBook)
        .leftJoin(book, sql`${userBook.hardcover_book_id} = ${book.hardcover_book_id}`)
        .orderBy(desc(userBook.hardcover_updated_at))

      // Build shelf items
      const shelf = rows.map((r) => ({
        hardcoverBookId: r.hardcoverBookId,
        title: r.title ?? '',
        subtitle: r.subtitle ?? null,
        authors: (r.authors as string[] | null) ?? [],
        genres: (r.genres as string[] | null) ?? [],
        pages: r.pages ?? null,
        releaseYear: r.releaseYear ?? null,
        coverUrl: r.coverUrl ?? null,
        statusId: r.statusId,
        status: STATUS_LABELS[r.statusId] ?? 'Unknown',
        rating: r.rating ?? null,
        hasReview: r.hasReview === 1,
        startedDate: r.startedDate ?? null,
        readDate: r.readDate ?? null,
        lastReadDate: r.lastReadDate ?? null,
        dateAdded: r.dateAdded ?? null,
        stats: null,
      }))

      // Compute summary
      const total = shelf.length
      const wantToRead = shelf.filter((s) => s.statusId === 1).length
      const currentlyReading = shelf.filter((s) => s.statusId === 2).length
      const read = shelf.filter((s) => s.statusId === 3).length
      const paused = shelf.filter((s) => s.statusId === 4).length
      const dnf = shelf.filter((s) => s.statusId === 5).length

      const ratedRows = shelf.filter((s) => s.rating !== null)
      const ratedCount = ratedRows.length
      const avgRating =
        ratedCount > 0
          ? Math.round(
              (ratedRows.reduce((sum, s) => sum + (s.rating ?? 0), 0) / ratedCount) * 100,
            ) / 100
          : null

      return {
        summary: {
          total,
          wantToRead,
          currentlyReading,
          read,
          paused,
          dnf,
          ratedCount,
          avgRating,
        },
        shelf,
      }
    },
    {
      response: {
        200: z.object({
          summary: SummarySchema,
          shelf: z.array(ShelfItemSchema),
        }),
      },
      detail: {
        tags: ['Reading'],
        summary: 'Hardcover shelf with summary',
        description:
          'Returns the full Hardcover.app shelf joined to book metadata, ordered by most-recently-updated. Includes a summary block with counts by status and average rating. The `stats` field on each shelf item is null in Phase A; it will be populated with reading-time data from a homelab reading-stats job in a future phase.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '/stats',
    async ({ body }) => {
      const now = new Date().toISOString()

      await db
        .insert(readingStat)
        .values(
          body.stats.map((s) => ({
            book_key: s.bookKey,
            title: s.title ?? null,
            author: s.author ?? null,
            total_read_seconds: s.totalReadSeconds,
            pages_read: s.pagesRead,
            current_percent: s.currentPercent,
            sessions: s.sessions,
            last_read_at: s.lastReadAt ?? null,
            raw: s.raw ?? null,
            synced_at: now,
          })),
        )
        .onConflictDoUpdate({
          target: readingStat.book_key,
          set: {
            title: sql`excluded.title`,
            author: sql`excluded.author`,
            total_read_seconds: sql`excluded.total_read_seconds`,
            pages_read: sql`excluded.pages_read`,
            current_percent: sql`excluded.current_percent`,
            sessions: sql`excluded.sessions`,
            last_read_at: sql`excluded.last_read_at`,
            raw: sql`excluded.raw`,
            synced_at: sql`excluded.synced_at`,
          },
        })

      return { upserted: body.stats.length }
    },
    {
      body: z.object({
        stats: z.array(StatInputSchema).min(1).max(1000),
      }),
      response: {
        200: z.object({ upserted: z.number().int() }),
      },
      detail: {
        tags: ['Reading'],
        summary: 'Batch upsert reading stats',
        description:
          'Idempotent batch upsert of per-book reading telemetry from a homelab reading-stats job. Keyed on `bookKey` — a duplicate key overwrites all mutable fields. Accepts 1–1000 records per call. This endpoint is intentionally generic: it carries no knowledge of the specific source system or how books are identified on the homelab.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post('/sync', async () => runHardcoverSync(), {
    response: {
      200: z.object({
        upserted: z.number().int().describe('Shelf rows pulled from Hardcover and upserted'),
        errors: z.number().int().describe('Errors encountered during the sync run'),
      }),
    },
    detail: {
      tags: ['Reading'],
      summary: 'Trigger a Hardcover shelf sync',
      description:
        'Runs the Hardcover shelf pull on demand — the same job the daily cron runs — and upserts books and shelf rows into the read-model. Idempotent and guarded against concurrent runs (a run already in progress is skipped). Returns the number of shelf rows processed and any errors. Use this to reflect Hardcover changes immediately instead of waiting for the scheduled sync.',
      security: [{ BearerAuth: [] }],
    },
  })
