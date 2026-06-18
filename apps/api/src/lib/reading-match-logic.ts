// Pure decision logic extracted from reading-match.ts — no DB, no network, no LLM.
// All exports are deterministic and side-effect-free; safe to import in unit tests.

import type { HardcoverSearchHit } from '../clients/hardcover.js'

// ── Normalisation helpers ────────────────────────────────────────────────────

export function normalizeTitle(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[:(].*/s, '') // drop subtitle / series marker
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function tokens(s: string): string[] {
  return normalizeTitle(s).split(/\s+/).filter(Boolean)
}

export function authorOverlap(statAuthor: string | null, candidateAuthors: string[]): boolean {
  if (!statAuthor) return true // thin metadata — don't penalize
  const statTokens = tokens(statAuthor)
  for (const ca of candidateAuthors) {
    const caTokens = tokens(ca)
    if (statTokens.some((t) => caTokens.includes(t))) return true
  }
  return false
}

/** True if any normalized token from any author in `a` appears in any author in `b`. */
export function authorsShareToken(a: string[], b: string[]): boolean {
  for (const authorA of a) {
    const tokensA = tokens(authorA)
    for (const authorB of b) {
      const tokensB = tokens(authorB)
      if (tokensA.some((t) => tokensB.includes(t))) return true
    }
  }
  return false
}

/** Completeness score: cover + release year + genres presence (0–3). */
export function completeness(h: HardcoverSearchHit): number {
  return (h.coverUrl ? 1 : 0) + (h.releaseYear ? 1 : 0) + (h.genres.length > 0 ? 1 : 0)
}

// ── Pure derived logic ───────────────────────────────────────────────────────

/**
 * Parse the raw string returned by the LLM into a verdict object.
 * Strips markdown code fences, extracts the first `{...}` object, validates
 * index range, and defaults confidence to 'low' when missing/invalid.
 * Returns null on any parse failure or out-of-range index.
 */
export function parseLLMVerdict(
  raw: string,
  candidateCount: number,
): { index: number; confidence: 'high' | 'medium' | 'low' } | null {
  try {
    const stripped = raw.replace(/```[a-z]*\n?/gi, '').trim()
    const match = stripped.match(/\{[^}]*\}/)
    if (!match) return null

    const parsed = JSON.parse(match[0]) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null

    const obj = parsed as Record<string, unknown>

    // Validate index: must be an integer within [0, candidateCount - 1].
    const rawIndex = obj['index']
    if (rawIndex === null || rawIndex === undefined) return null
    const idx = Number(rawIndex)
    if (!Number.isInteger(idx) || idx < 0 || idx >= candidateCount) return null

    // Validate confidence: default to 'low' if missing/invalid.
    const rawConf = obj['confidence']
    const confidence: 'high' | 'medium' | 'low' =
      rawConf === 'high' || rawConf === 'medium' || rawConf === 'low' ? rawConf : 'low'

    return { index: idx, confidence }
  } catch {
    return null
  }
}

/**
 * String-only auto-confirm predicate (precondition: hits.length > 0).
 * Returns true when the top hit is an exact-normalized-title match with
 * non-empty author overlap and no rival record of a different book.
 */
export function stringAutoConfirms(
  reading: { title: string; author: string | null },
  hits: HardcoverSearchHit[],
): boolean {
  const best = hits[0]!
  const titleExact = normalizeTitle(best.title) === normalizeTitle(reading.title)
  const authorPresent = Boolean(reading.author?.trim())
  // A same-title runner-up only signals real ambiguity when it's a DIFFERENT
  // book (different author). Duplicate editions of the same work (same title +
  // overlapping author) must NOT block auto-confirm.
  const hasRivalDifferentBook = hits
    .slice(1)
    .some(
      (h) =>
        normalizeTitle(h.title) === normalizeTitle(best.title) &&
        !authorOverlap(reading.author, h.authors),
    )
  return (
    titleExact &&
    authorPresent &&
    authorOverlap(reading.author, best.authors) &&
    !hasRivalDifferentBook
  )
}

/**
 * Pick the richest duplicate of `chosen` from the candidate cluster.
 * Hardcover often has several fragmented records for the same work; the
 * richest member (cover + year + genres) makes the best candidate.
 */
export function pickRichest(
  hits: HardcoverSearchHit[],
  chosen: HardcoverSearchHit,
): HardcoverSearchHit {
  const cluster = hits.filter(
    (h) =>
      normalizeTitle(h.title) === normalizeTitle(chosen.title) &&
      authorsShareToken(h.authors, chosen.authors),
  )
  return cluster.reduce(
    (bestSoFar, h) => (completeness(h) > completeness(bestSoFar) ? h : bestSoFar),
    chosen,
  )
}

/**
 * Resolve which hit to pick and whether to auto-confirm, using the string path
 * first and falling back to an LLM verdict (precondition: hits.length > 0).
 */
export function decideMatch(
  reading: { title: string; author: string | null },
  hits: HardcoverSearchHit[],
  verdict: { index: number; confidence: 'high' | 'medium' | 'low' } | null,
): { pick: HardcoverSearchHit; confirmed: number } {
  let chosen: HardcoverSearchHit
  let confirmed: number // 0 | 1

  if (stringAutoConfirms(reading, hits)) {
    chosen = hits[0]!
    confirmed = 1
  } else if (verdict !== null) {
    chosen = hits[verdict.index]! // index validated in-range by parseLLMVerdict
    confirmed = verdict.confidence === 'high' ? 1 : 0 // 0 | 1
  } else {
    chosen = hits[0]!
    confirmed = 0 // 0 | 1
  }

  const pick = pickRichest(hits, chosen)
  return { pick, confirmed }
}
