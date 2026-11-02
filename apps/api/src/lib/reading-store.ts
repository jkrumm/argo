import { and, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { book, bookSyncMap, readingStat, userBook } from '../db/schema.js'
import { env } from '../env.js'
import { runCommand, splitCommand } from '../clients/command.js'
import {
  createCoalescer,
  createSingleFlight,
  createThrottle,
  parsePulledStats,
  type StatInput,
} from './reading-link.js'

// ── Status id → label map ─────────────────────────────────────────────────────

const STATUS_LABELS: Record<number, string> = {
  1: 'Want to Read',
  2: 'Currently Reading',
  3: 'Read',
  4: 'Paused',
  5: 'Did Not Finish',
  6: 'Ignored',
}

// ── Shelf ─────────────────────────────────────────────────────────────────────

/** The exact body `GET /reading` returns; also what the shelf sink command receives on stdin. */
export async function buildReadingShelf() {
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
      slug: book.slug,
      authors: book.authors,
      genres: book.genres,
      pages: book.pages,
      releaseYear: book.release_year,
      coverUrl: book.cover_url,
      communityRating: book.community_rating,
      ratingsCount: book.ratings_count,
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
    slug: r.slug ?? null,
    authors: (r.authors as string[] | null) ?? [],
    genres: (r.genres as string[] | null) ?? [],
    pages: r.pages ?? null,
    releaseYear: r.releaseYear ?? null,
    coverUrl: r.coverUrl ?? null,
    communityRating: r.communityRating ?? null,
    ratingsCount: r.ratingsCount ?? null,
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
      ? Math.round((ratedRows.reduce((sum, s) => sum + (s.rating ?? 0), 0) / ratedCount) * 100) /
        100
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
}

// ── Stats upsert (shared by POST /reading/stats and the pull) ─────────────────

export async function upsertReadingStats(stats: StatInput[]): Promise<number> {
  if (stats.length === 0) return 0
  const now = new Date().toISOString()

  await db
    .insert(readingStat)
    .values(
      stats.map((s) => ({
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

  return stats.length
}

// ── Homelab link: pull stats, push shelf ──────────────────────────────────────

const PULL_TIMEOUT_MS = 8_000
const PUSH_TIMEOUT_MS = 20_000
const PULL_MIN_INTERVAL_MS = 5 * 60_000

/** Run the configured stats command and upsert its output. Never throws; true when rows were stored. */
export async function pullReadingStats(): Promise<boolean> {
  const argv = splitCommand(env.READING_STATS_SOURCE_CMD)
  if (argv.length === 0) return false

  try {
    const stdout = await runCommand(argv, { timeoutMs: PULL_TIMEOUT_MS })
    await upsertReadingStats(parsePulledStats(stdout))
    return true
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[reading] stats pull failed:', e instanceof Error ? e.message : e)
    return false
  }
}

async function pushOnce(): Promise<void> {
  const argv = splitCommand(env.READING_SHELF_SINK_CMD)
  if (argv.length === 0) return

  try {
    const shelf = await buildReadingShelf()
    await runCommand(argv, { stdin: JSON.stringify(shelf), timeoutMs: PUSH_TIMEOUT_MS })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[reading] shelf push failed:', e instanceof Error ? e.message : e)
  }
}

/**
 * Pipe the current shelf into the configured sink command. Fire-and-forget, never throws.
 * One push at a time; requests during a push coalesce into one trailing push that rebuilds the shelf.
 */
export const pushReadingShelf = createCoalescer(pushOnce)

/** Single-flight pull shared by the page-open path and the sync cron, so they never overlap. */
export const pullReadingStatsShared = createSingleFlight(pullReadingStats)

const throttledPull = createThrottle(pullReadingStatsShared, PULL_MIN_INTERVAL_MS)

/** Page-open hook: throttled pull (bounded by the command timeout), then a background push if it ran. */
export async function pullStatsForPageOpen(): Promise<void> {
  if (await throttledPull()) void pushReadingShelf()
}
