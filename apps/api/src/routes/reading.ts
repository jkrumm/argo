import { Elysia } from 'elysia'
import { z } from 'zod'
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { book, bookSyncMap, readingStat, userBook } from '../db/schema.js'
import { runHardcoverSync } from '../cron/hardcover-sync.js'
import { runHardcoverReconcile } from '../cron/hardcover-reconcile.js'
import { hardcover } from '../clients/hardcover.js'

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
  stats: z
    .object({
      totalReadSeconds: z.number().int(),
      pagesRead: z.number().int(),
      currentPercent: z.number(),
      sessions: z.number().int(),
      lastReadAt: z.string().nullable(),
    })
    .nullable()
    .describe(
      'Reading-stat telemetry joined via book_sync_map (confirmed matches only); null when unmatched',
    ),
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

      // Fetch confirmed stats joined via book_sync_map.
      const statsRows = await db
        .select({
          hardcover_book_id: bookSyncMap.hardcover_book_id,
          total_read_seconds: readingStat.total_read_seconds,
          pages_read: readingStat.pages_read,
          current_percent: readingStat.current_percent,
          sessions: readingStat.sessions,
          last_read_at: readingStat.last_read_at,
        })
        .from(bookSyncMap)
        .innerJoin(readingStat, eq(bookSyncMap.book_key, readingStat.book_key))
        .where(and(eq(bookSyncMap.confirmed, 1), isNotNull(bookSyncMap.hardcover_book_id)))

      const statsMap = new Map<
        number,
        {
          totalReadSeconds: number
          pagesRead: number
          currentPercent: number
          sessions: number
          lastReadAt: string | null
        }
      >()
      for (const s of statsRows) {
        if (s.hardcover_book_id !== null) {
          statsMap.set(s.hardcover_book_id, {
            totalReadSeconds: s.total_read_seconds,
            pagesRead: s.pages_read,
            currentPercent: s.current_percent,
            sessions: s.sessions,
            lastReadAt: (s.last_read_at as string | null) ?? null,
          })
        }
      }

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
        stats: statsMap.get(r.hardcoverBookId) ?? null,
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
          'Returns the full Hardcover.app shelf joined to book metadata, ordered by most-recently-updated. Includes a summary block with counts by status and average rating. The `stats` field on each shelf item is populated from reading-stat telemetry via confirmed book_sync_map matches; null when no confirmed match exists.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/unmatched',
    async () => {
      const rows = await db
        .select({
          bookKey: bookSyncMap.book_key,
          readingTitle: readingStat.title,
          readingAuthor: readingStat.author,
          currentPercent: readingStat.current_percent,
          lastReadAt: readingStat.last_read_at,
          candidateBookId: bookSyncMap.hardcover_book_id,
          candidateTitle: book.title,
          candidateAuthors: book.authors,
          candidateCoverUrl: book.cover_url,
        })
        .from(bookSyncMap)
        .innerJoin(readingStat, eq(bookSyncMap.book_key, readingStat.book_key))
        .leftJoin(book, eq(bookSyncMap.hardcover_book_id, book.hardcover_book_id))
        .where(eq(bookSyncMap.confirmed, 0))
        .orderBy(desc(readingStat.last_read_at))

      return {
        unmatched: rows.map((r) => ({
          bookKey: r.bookKey,
          readingTitle: r.readingTitle ?? null,
          readingAuthor: r.readingAuthor ?? null,
          currentPercent: r.currentPercent,
          candidateBookId: r.candidateBookId ?? null,
          candidateTitle: r.candidateTitle ?? null,
          candidateAuthors: (r.candidateAuthors as string[] | null) ?? [],
          candidateCoverUrl: r.candidateCoverUrl ?? null,
        })),
      }
    },
    {
      response: {
        200: z.object({
          unmatched: z.array(
            z.object({
              bookKey: z.string(),
              readingTitle: z.string().nullable(),
              readingAuthor: z.string().nullable(),
              currentPercent: z.number(),
              candidateBookId: z.number().int().nullable(),
              candidateTitle: z.string().nullable(),
              candidateAuthors: z.array(z.string()),
              candidateCoverUrl: z.string().nullable(),
            }),
          ),
        }),
      },
      detail: {
        tags: ['Reading'],
        summary: 'List unconfirmed book matches',
        description:
          'Returns reading-stat rows whose book_sync_map entry has confirmed=0 — books the matcher found a Hardcover candidate for but could not auto-confirm, plus books with no candidate at all. Includes the telemetry title/author and the candidate book metadata. Use `POST /reading/match` to confirm a specific entry. Ordered by most-recently-read first.',
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
  .post(
    '/match',
    async ({ body, set }) => {
      const existing = await db
        .select({
          book_key: bookSyncMap.book_key,
          hardcover_book_id: bookSyncMap.hardcover_book_id,
        })
        .from(bookSyncMap)
        .where(eq(bookSyncMap.book_key, body.bookKey))
        .limit(1)

      const row = existing[0]

      if (!row || row.hardcover_book_id === null) {
        set.status = 404
        return {
          confirmed: false,
          bookKey: body.bookKey,
          error: 'No candidate found for this bookKey',
        }
      }

      await db
        .update(bookSyncMap)
        .set({
          confirmed: 1, // 0 | 1
          updated_at: new Date().toISOString(),
        })
        .where(eq(bookSyncMap.book_key, body.bookKey))

      return { confirmed: true, bookKey: body.bookKey }
    },
    {
      body: z.object({ bookKey: z.string() }),
      response: {
        200: z.object({ confirmed: z.boolean(), bookKey: z.string() }),
        404: z.object({ confirmed: z.boolean(), bookKey: z.string(), error: z.string() }),
      },
      detail: {
        tags: ['Reading'],
        summary: 'Confirm a book match',
        description:
          'Sets confirmed=1 on the book_sync_map row for the given bookKey, promoting the candidate Hardcover book to a confirmed match. The next reconcile run (or `POST /reading/reconcile`) will then write status/date back to Hardcover. Returns 404 if the bookKey has no map entry or no candidate was found by the matcher.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post('/reconcile', async () => runHardcoverReconcile(), {
    response: {
      200: z.object({
        matched: z.number().int().describe('New book_sync_map rows created by the match scan'),
        reconciled: z.number().int().describe('Hardcover user_book entries written or updated'),
        errors: z.number().int().describe('Per-row errors encountered (fail-soft)'),
      }),
    },
    detail: {
      tags: ['Reading'],
      summary: 'Run the reading reconcile (match scan + Hardcover status/date write-back)',
      description:
        'Runs the full reconcile pipeline on demand: (1) scans reading_stat rows without a book_sync_map entry and searches Hardcover for candidates; (2) for all confirmed matches, writes the appropriate reading status (Currently Reading or Read) and first_started_reading_date back to Hardcover, then write-through to the local user_book table. Idempotent — never downgrades an existing status. Returns counts of matched, reconciled, and errored rows.',
      security: [{ BearerAuth: [] }],
    },
  })
  .post(
    '/want-to-read',
    async ({ body, set }) => {
      const hits = await hardcover.searchBook({
        title: body.title,
        author: body.author ?? null,
      })

      if (hits.length === 0) {
        set.status = 404
        return { added: false, hardcoverBookId: null, title: null }
      }

      // hits.length > 0 is guaranteed above; assert non-undefined.
      const top = hits[0]!

      await hardcover.insertUserBook({ book_id: top.hardcoverBookId, status_id: 1 })

      // Upsert book metadata so it appears on shelf after next sync.
      const now = new Date().toISOString()
      await db
        .insert(book)
        .values({
          hardcover_book_id: top.hardcoverBookId,
          title: top.title,
          subtitle: top.subtitle,
          authors: top.authors,
          genres: top.genres,
          release_year: top.releaseYear,
          cover_url: top.coverUrl,
          synced_at: now,
        })
        .onConflictDoUpdate({
          target: book.hardcover_book_id,
          set: {
            title: sql`excluded.title`,
            subtitle: sql`excluded.subtitle`,
            authors: sql`excluded.authors`,
            genres: sql`excluded.genres`,
            release_year: sql`excluded.release_year`,
            cover_url: sql`excluded.cover_url`,
            synced_at: sql`excluded.synced_at`,
          },
        })

      return { added: true, hardcoverBookId: top.hardcoverBookId, title: top.title }
    },
    {
      body: z.object({
        title: z.string().min(1),
        author: z.string().optional(),
      }),
      response: {
        200: z.object({
          added: z.boolean(),
          hardcoverBookId: z.number().int().nullable(),
          title: z.string().nullable(),
        }),
        404: z.object({
          added: z.boolean(),
          hardcoverBookId: z.number().int().nullable(),
          title: z.string().nullable(),
        }),
      },
      detail: {
        tags: ['Reading'],
        summary: 'Add a book to the Want to Read shelf',
        description:
          "Searches Hardcover for the given title (and optional author), then adds the top hit to the authenticated user's Want to Read shelf (status_id=1) via `insert_user_book`. Also upserts the book metadata locally so it appears on `GET /reading` after the next shelf sync. Returns 404 if no Hardcover match is found.",
        security: [{ BearerAuth: [] }],
      },
    },
  )
