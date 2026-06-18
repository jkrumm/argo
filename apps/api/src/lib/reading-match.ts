// Matcher: scans reading_stat rows that have no book_sync_map entry and attempts
// to find a Hardcover book candidate via the search API. High-confidence matches
// are auto-confirmed; ambiguous ones are left for manual review.

import { isNull, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { book, bookSyncMap, readingStat } from '../db/schema.js'
import { hardcover, type HardcoverSearchHit } from '../clients/hardcover.js'
import { aiComplete } from '../routes/ai.js'
import { env } from '../env.js'
import { parseLLMVerdict, decideMatch, stringAutoConfirms } from './reading-match-logic.js'

// ── LLM disambiguation (module-local, fail-soft) ─────────────────────────────

/**
 * Ask the LLM to pick the best match from a candidate list for a reading record
 * whose metadata may be messy, filename-like, or garbled. Returns a 0-based
 * index + confidence, or null when the LLM is unavailable, produces bad JSON,
 * or finds no suitable candidate. Never throws.
 */
async function disambiguateWithLLM(
  reading: { title: string; author: string | null },
  candidates: HardcoverSearchHit[],
): Promise<{ index: number; confidence: 'high' | 'medium' | 'low' } | null> {
  if (!env.DEEPSEEK_BASE_URL) return null
  if (candidates.length === 0) return null

  try {
    const candidateList = candidates
      .map((c, i) => {
        const parts: string[] = [`${i}. "${c.title}"`]
        if (c.subtitle) parts.push(`(${c.subtitle})`)
        parts.push(`— ${c.authors.length > 0 ? c.authors.join(', ') : 'unknown author'}`)
        if (c.releaseYear) parts.push(`[${c.releaseYear}]`)
        return parts.join(' ')
      })
      .join('\n')

    const authorLine = reading.author ? `Author: ${reading.author}` : 'Author: (none)'
    const prompt =
      `Reading record:\n` +
      `Title: ${reading.title}\n` +
      `${authorLine}\n\n` +
      `Note: the title and author above come from reading telemetry and may be ` +
      `messy, filename-like, garbled, or truncated.\n\n` +
      `Candidates (0-based index):\n${candidateList}\n\n` +
      `Which candidate is the SAME book as the reading record? Account for ` +
      `translations, subtitle differences, and messy input.\n\n` +
      `Respond with ONLY this JSON (no prose, no fences): ` +
      `{"index": <0-based index or null if no match>, "confidence": "high"|"medium"|"low"}\n` +
      `high = confident same book; medium = probable; low = unsure.`

    const system =
      `You are a book-matching judge. Your only job is to match a reading record ` +
      `to the correct book from a candidate list. Respond with ONLY compact JSON ` +
      `as instructed — no explanations, no markdown code fences.`

    const raw = await aiComplete(prompt, {
      system,
      temperature: 0,
      maxTokens: 80,
      sub_tool: 'reading-match',
    })

    return parseLLMVerdict(raw, candidates.length)
  } catch {
    return null
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runReadingMatch(): Promise<{
  scanned: number
  matched: number
  autoConfirmed: number
}> {
  // Find reading_stat rows that have no corresponding book_sync_map row yet.
  const unmapped = await db
    .select({
      book_key: readingStat.book_key,
      title: readingStat.title,
      author: readingStat.author,
    })
    .from(readingStat)
    .leftJoin(bookSyncMap, sql`${readingStat.book_key} = ${bookSyncMap.book_key}`)
    .where(isNull(bookSyncMap.book_key))

  let scanned = 0
  let matched = 0
  let autoConfirmed = 0

  for (const row of unmapped) {
    scanned++

    if (!row.title) {
      // No title — mark scanned with no candidate so we skip it next time.
      await db
        .insert(bookSyncMap)
        .values({
          book_key: row.book_key,
          hardcover_book_id: null,
          confirmed: 0, // 0 | 1
        })
        .onConflictDoNothing()
      continue
    }

    try {
      const hits = await hardcover.searchBook({ title: row.title, author: row.author })

      if (hits.length === 0) {
        await db
          .insert(bookSyncMap)
          .values({
            book_key: row.book_key,
            hardcover_book_id: null,
            confirmed: 0, // 0 | 1
          })
          .onConflictDoNothing()
        continue
      }

      // hits.length > 0 is guaranteed by the check above.
      // Gate LLM call: only call when the string path fails (token-frugal).
      const verdict = stringAutoConfirms({ title: row.title, author: row.author }, hits)
        ? null
        : await disambiguateWithLLM({ title: row.title, author: row.author }, hits)
      const { pick, confirmed } = decideMatch(
        { title: row.title, author: row.author },
        hits,
        verdict,
      )

      // Upsert the candidate book so confirm-UI and stats join have metadata.
      const now = new Date().toISOString()
      await db
        .insert(book)
        .values({
          hardcover_book_id: pick.hardcoverBookId,
          title: pick.title,
          subtitle: pick.subtitle,
          authors: pick.authors,
          genres: pick.genres,
          release_year: pick.releaseYear,
          cover_url: pick.coverUrl,
          community_rating: pick.communityRating,
          ratings_count: pick.ratingsCount,
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
            community_rating: sql`excluded.community_rating`,
            ratings_count: sql`excluded.ratings_count`,
            synced_at: sql`excluded.synced_at`,
          },
        })

      await db
        .insert(bookSyncMap)
        .values({
          book_key: row.book_key,
          hardcover_book_id: pick.hardcoverBookId,
          hardcover_edition_id: null,
          confirmed,
        })
        .onConflictDoNothing()

      matched++
      if (confirmed === 1) autoConfirmed++
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[reading-match] error for book_key=${row.book_key}:`, err)
    }
  }

  return { scanned, matched, autoConfirmed }
}
