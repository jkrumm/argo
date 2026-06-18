// Matcher: scans reading_stat rows that have no book_sync_map entry and attempts
// to find a Hardcover book candidate via the search API. High-confidence matches
// are auto-confirmed; ambiguous ones are left for manual review.

import { isNull, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { book, bookSyncMap, readingStat } from '../db/schema.js'
import { hardcover, type HardcoverSearchHit } from '../clients/hardcover.js'
import { aiComplete } from '../routes/ai.js'
import { env } from '../env.js'

// ── Normalisation helpers (module-local) ─────────────────────────────────────

function normalizeTitle(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[:(].*/s, '') // drop subtitle / series marker
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokens(s: string): string[] {
  return normalizeTitle(s).split(/\s+/).filter(Boolean)
}

function authorOverlap(statAuthor: string | null, candidateAuthors: string[]): boolean {
  if (!statAuthor) return true // thin metadata — don't penalize
  const statTokens = tokens(statAuthor)
  for (const ca of candidateAuthors) {
    const caTokens = tokens(ca)
    if (statTokens.some((t) => caTokens.includes(t))) return true
  }
  return false
}

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

    // Strip markdown fences and extract first {...} object.
    const stripped = raw.replace(/```[a-z]*\n?/gi, '').trim()
    const match = stripped.match(/\{[^}]*\}/)
    if (!match) return null

    const parsed = JSON.parse(match[0]) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null

    const obj = parsed as Record<string, unknown>

    // Validate index: must be an integer within [0, candidates.length - 1].
    const rawIndex = obj['index']
    if (rawIndex === null || rawIndex === undefined) return null
    const idx = Number(rawIndex)
    if (!Number.isInteger(idx) || idx < 0 || idx >= candidates.length) return null

    // Validate confidence: default to 'low' if missing/invalid.
    const rawConf = obj['confidence']
    const confidence: 'high' | 'medium' | 'low' =
      rawConf === 'high' || rawConf === 'medium' || rawConf === 'low' ? rawConf : 'low'

    return { index: idx, confidence }
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

      // hits.length > 0 is guaranteed by the check above; assert non-undefined.
      const best = hits[0]!

      // High-confidence string auto-confirm: exact normalised title + NON-EMPTY
      // author overlap + no genuinely-ambiguous rival.
      // Empty/whitespace author must NOT auto-confirm — fall through to LLM pass.
      const titleExact = normalizeTitle(best.title) === normalizeTitle(row.title)
      const authorPresent = Boolean(row.author?.trim())
      // A same-title runner-up only signals real ambiguity when it's a DIFFERENT
      // book (different author). Duplicate editions of the same work (same title +
      // overlapping author) must NOT block auto-confirm — Hardcover often carries
      // several edition records for one book.
      const hasRivalDifferentBook = hits
        .slice(1)
        .some(
          (h) =>
            normalizeTitle(h.title) === normalizeTitle(best.title) &&
            !authorOverlap(row.author, h.authors),
        )
      const stringAutoConfirm =
        titleExact &&
        authorPresent &&
        authorOverlap(row.author, best.authors) &&
        !hasRivalDifferentBook

      // Resolve pick + confirmed via string path or LLM disambiguation.
      let pick: HardcoverSearchHit
      let confirmed: number // 0 | 1

      if (stringAutoConfirm) {
        // Clean string match — no LLM call needed.
        pick = best
        confirmed = 1
      } else {
        // Attempt LLM disambiguation for dirty/thin metadata.
        const verdict = await disambiguateWithLLM({ title: row.title, author: row.author }, hits)
        if (verdict !== null) {
          pick = hits[verdict.index]! // index validated in-range by disambiguateWithLLM
          confirmed = verdict.confidence === 'high' ? 1 : 0 // 0 | 1
        } else {
          // No verdict — store the search's top hit as a weak candidate for
          // manual review via the confirm-UI.
          pick = best
          confirmed = 0 // 0 | 1
        }
      }

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
