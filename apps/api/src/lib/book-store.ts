// Single owner of `book` row writes from full Hardcover metadata. Used by the
// shelf sync, the match path (after a full fetch), and the enrich backfill so a
// previously-sparse row is rewritten complete. Idempotent on hardcover_book_id.

import { sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { book } from '../db/schema.js'
import type { HardcoverBookDetail } from '../clients/hardcover.js'

export async function upsertBook(detail: HardcoverBookDetail, syncedAt: string): Promise<void> {
  await db
    .insert(book)
    .values({
      hardcover_book_id: detail.hardcoverBookId,
      title: detail.title,
      subtitle: detail.subtitle,
      slug: detail.slug,
      headline: detail.headline,
      authors: detail.authors,
      genres: detail.genres,
      pages: detail.pages,
      release_year: detail.releaseYear,
      description: detail.description,
      cover_url: detail.coverUrl,
      community_rating: detail.communityRating,
      ratings_count: detail.ratingsCount,
      synced_at: syncedAt,
    })
    .onConflictDoUpdate({
      target: book.hardcover_book_id,
      set: {
        title: sql`excluded.title`,
        subtitle: sql`excluded.subtitle`,
        slug: sql`excluded.slug`,
        headline: sql`excluded.headline`,
        authors: sql`excluded.authors`,
        genres: sql`excluded.genres`,
        pages: sql`excluded.pages`,
        release_year: sql`excluded.release_year`,
        description: sql`excluded.description`,
        cover_url: sql`excluded.cover_url`,
        community_rating: sql`excluded.community_rating`,
        ratings_count: sql`excluded.ratings_count`,
        synced_at: sql`excluded.synced_at`,
      },
    })
}
