import { describe, it, expect } from 'bun:test'
import {
  normalizeTitle,
  authorOverlap,
  authorsShareToken,
  completeness,
  parseLLMVerdict,
  stringAutoConfirms,
  decideMatch,
} from './reading-match-logic.js'
import type { HardcoverSearchHit } from '../clients/hardcover.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function hit(
  hardcoverBookId: number,
  title: string,
  authors: string[],
  opts: Partial<Omit<HardcoverSearchHit, 'hardcoverBookId' | 'title' | 'authors'>> = {},
): HardcoverSearchHit {
  return {
    hardcoverBookId,
    title,
    authors,
    subtitle: opts.subtitle ?? null,
    releaseYear: opts.releaseYear ?? null,
    coverUrl: opts.coverUrl ?? null,
    genres: opts.genres ?? [],
    communityRating: opts.communityRating ?? null,
    ratingsCount: opts.ratingsCount ?? null,
  }
}

// ── normalizeTitle ────────────────────────────────────────────────────────────

describe('normalizeTitle', () => {
  it('lowercases input', () => {
    expect(normalizeTitle('Bad Karma')).toBe('bad karma')
  })

  it('strips diacritics', () => {
    expect(normalizeTitle('Café')).toBe('cafe')
  })

  it('drops subtitle after colon', () => {
    expect(normalizeTitle('Bad Karma: The True Story')).toBe('bad karma')
  })

  it('drops series marker after open paren', () => {
    expect(normalizeTitle('Bad Karma (Repairman Jack)')).toBe('bad karma')
  })

  it('collapses punctuation to spaces and trims', () => {
    expect(normalizeTitle('  Hello,  World!  ')).toBe('hello world')
  })

  it('handles mixed diacritics and colon', () => {
    expect(normalizeTitle('Café: A Story')).toBe('cafe')
  })
})

// ── authorOverlap ─────────────────────────────────────────────────────────────

describe('authorOverlap', () => {
  it('returns true when statAuthor is null (permissive)', () => {
    expect(authorOverlap(null, ['David Safier'])).toBe(true)
  })

  it('returns true when statAuthor is empty string (permissive)', () => {
    expect(authorOverlap('', ['David Safier'])).toBe(true)
  })

  it('returns true for exact single-author match', () => {
    expect(authorOverlap('Paul Wilson', ['Paul Wilson'])).toBe(true)
  })

  it('returns true when surnames match despite extra spaces in candidate', () => {
    expect(authorOverlap('Paul Wilson', ['Paul   Wilson'])).toBe(true)
  })

  it('returns false when authors are completely disjoint', () => {
    expect(authorOverlap('Paul Wilson', ['David Safier'])).toBe(false)
  })

  it('returns true when any candidate author overlaps', () => {
    expect(authorOverlap('Paul Wilson', ['David Safier', 'Paul Wilson'])).toBe(true)
  })

  it('matches on shared surname token', () => {
    expect(authorOverlap('J. Wilson', ['Paul Wilson'])).toBe(true)
  })
})

// ── authorsShareToken ─────────────────────────────────────────────────────────

describe('authorsShareToken', () => {
  it('returns true when author lists share a token', () => {
    expect(authorsShareToken(['Paul Wilson'], ['Paul Wilson'])).toBe(true)
  })

  it('returns false for completely disjoint lists', () => {
    expect(authorsShareToken(['Paul Wilson'], ['David Safier'])).toBe(false)
  })

  it('returns true when any pair of authors shares a token', () => {
    expect(authorsShareToken(['Paul Wilson', 'Jane Doe'], ['David Safier', 'John Wilson'])).toBe(
      true,
    )
  })
})

// ── completeness ─────────────────────────────────────────────────────────────

describe('completeness', () => {
  it('returns 0 for a bare hit with no enrichment', () => {
    const h = hit(1, 'Title', ['Author'])
    expect(completeness(h)).toBe(0)
  })

  it('adds 1 for coverUrl', () => {
    const h = hit(1, 'Title', ['Author'], { coverUrl: 'https://img/x.jpg' })
    expect(completeness(h)).toBe(1)
  })

  it('adds 1 for releaseYear', () => {
    const h = hit(1, 'Title', ['Author'], { releaseYear: 2020 })
    expect(completeness(h)).toBe(1)
  })

  it('adds 1 for non-empty genres', () => {
    const h = hit(1, 'Title', ['Author'], { genres: ['Fiction'] })
    expect(completeness(h)).toBe(1)
  })

  it('returns 3 when all enrichment fields are present', () => {
    const h = hit(1, 'Title', ['Author'], {
      coverUrl: 'https://img/x.jpg',
      releaseYear: 2020,
      genres: ['Fiction'],
    })
    expect(completeness(h)).toBe(3)
  })
})

// ── parseLLMVerdict ───────────────────────────────────────────────────────────

describe('parseLLMVerdict', () => {
  it('parses clean JSON with high confidence', () => {
    const result = parseLLMVerdict('{"index":1,"confidence":"high"}', 3)
    expect(result).toEqual({ index: 1, confidence: 'high' })
  })

  it('parses medium confidence', () => {
    const result = parseLLMVerdict('{"index":0,"confidence":"medium"}', 2)
    expect(result).toEqual({ index: 0, confidence: 'medium' })
  })

  it('parses JSON wrapped in markdown code fences', () => {
    const raw = '```json\n{"index":2,"confidence":"high"}\n```'
    const result = parseLLMVerdict(raw, 3)
    expect(result).toEqual({ index: 2, confidence: 'high' })
  })

  it('extracts JSON from prose-wrapped output', () => {
    const raw = 'The best match is {"index":1,"confidence":"medium"} based on the title.'
    const result = parseLLMVerdict(raw, 3)
    expect(result).toEqual({ index: 1, confidence: 'medium' })
  })

  it('returns null when index is null', () => {
    expect(parseLLMVerdict('{"index":null,"confidence":"high"}', 3)).toBeNull()
  })

  it('returns null when index is undefined (key absent)', () => {
    expect(parseLLMVerdict('{"confidence":"high"}', 3)).toBeNull()
  })

  it('returns null when index equals candidateCount (out of range)', () => {
    expect(parseLLMVerdict('{"index":3,"confidence":"high"}', 3)).toBeNull()
  })

  it('returns null when index is negative', () => {
    expect(parseLLMVerdict('{"index":-1,"confidence":"high"}', 3)).toBeNull()
  })

  it('returns null when index is a float (non-integer)', () => {
    expect(parseLLMVerdict('{"index":1.5,"confidence":"high"}', 3)).toBeNull()
  })

  it('defaults confidence to low when missing', () => {
    const result = parseLLMVerdict('{"index":0}', 2)
    expect(result).toEqual({ index: 0, confidence: 'low' })
  })

  it('defaults confidence to low when value is garbage', () => {
    const result = parseLLMVerdict('{"index":0,"confidence":"very sure"}', 2)
    expect(result).toEqual({ index: 0, confidence: 'low' })
  })

  it('returns null for non-JSON garbage input', () => {
    expect(parseLLMVerdict('no match found', 3)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseLLMVerdict('', 3)).toBeNull()
  })
})

// ── stringAutoConfirms ────────────────────────────────────────────────────────

describe('stringAutoConfirms', () => {
  it('returns true for exact title + matching author, single hit', () => {
    const hits = [hit(1, 'Bad Karma', ['Paul Wilson'])]
    expect(stringAutoConfirms({ title: 'Bad Karma', author: 'Paul Wilson' }, hits)).toBe(true)
  })

  it('returns false when author is empty (empty string)', () => {
    const hits = [hit(1, 'Bad Karma', ['Paul Wilson'])]
    expect(stringAutoConfirms({ title: 'Bad Karma', author: '' }, hits)).toBe(false)
  })

  it('returns false when author is whitespace-only', () => {
    const hits = [hit(1, 'Bad Karma', ['Paul Wilson'])]
    expect(stringAutoConfirms({ title: 'Bad Karma', author: '   ' }, hits)).toBe(false)
  })

  it('returns false when author is null', () => {
    const hits = [hit(1, 'Bad Karma', ['Paul Wilson'])]
    expect(stringAutoConfirms({ title: 'Bad Karma', author: null }, hits)).toBe(false)
  })

  it('returns false when title does not match', () => {
    const hits = [hit(1, 'Different Title', ['Paul Wilson'])]
    expect(stringAutoConfirms({ title: 'Bad Karma', author: 'Paul Wilson' }, hits)).toBe(false)
  })

  it('returns false when there is a rival hit with same normalized title but different author', () => {
    const hits = [hit(1, 'Bad Karma', ['Paul Wilson']), hit(2, 'Bad Karma', ['David Safier'])]
    expect(stringAutoConfirms({ title: 'Bad Karma', author: 'Paul Wilson' }, hits)).toBe(false)
  })

  it('returns true when rival has same title AND overlapping author (duplicate editions are fine)', () => {
    const hits = [hit(1, 'Bad Karma', ['Paul Wilson']), hit(2, 'Bad Karma', ['Paul Wilson'])]
    expect(stringAutoConfirms({ title: 'Bad Karma', author: 'Paul Wilson' }, hits)).toBe(true)
  })
})

// ── decideMatch ───────────────────────────────────────────────────────────────

describe('decideMatch', () => {
  it('string path: exact title + present overlapping author → confirmed 1, pick = that hit', () => {
    const hits = [hit(42, 'Bad Karma', ['Paul Wilson'])]
    const result = decideMatch({ title: 'Bad Karma', author: 'Paul Wilson' }, hits, null)
    expect(result.confirmed).toBe(1)
    expect(result.pick.hardcoverBookId).toBe(42)
  })

  // Bad Karma regression: duplicate editions must not block string auto-confirm;
  // pickRichest must select the edition with the most completeness fields.
  it('Bad Karma regression: duplicate editions → confirmed 1, pick = richest edition', () => {
    const hits = [
      hit(1053793, 'BAD KARMA: The True Story of a Mexico Trip from Hell', ['Paul Wilson']),
      hit(1930501, 'Bad Karma: The True Story of a Mexico Trip from Hell', ['Paul Wilson'], {
        coverUrl: 'https://img/x.jpg',
        releaseYear: 2014,
        genres: ['Travel'],
      }),
    ]
    const result = decideMatch({ title: 'Bad Karma', author: 'Paul Wilson' }, hits, null)
    expect(result.confirmed).toBe(1)
    expect(result.pick.hardcoverBookId).toBe(1930501)
  })

  it('rival different book → string does not auto-confirm; verdict null → confirmed 0', () => {
    const hits = [hit(1, 'Bad Karma', ['Paul Wilson']), hit(2, 'Bad Karma', ['David Safier'])]
    const result = decideMatch({ title: 'Bad Karma', author: 'Paul Wilson' }, hits, null)
    expect(result.confirmed).toBe(0)
    // pick should fall back to hits[0] (best) since no verdict
    expect(result.pick.hardcoverBookId).toBe(1)
  })

  it('empty author → no string auto-confirm; verdict null → confirmed 0', () => {
    const hits = [hit(1, 'Bad Karma', ['Paul Wilson'])]
    const result = decideMatch({ title: 'Bad Karma', author: '' }, hits, null)
    expect(result.confirmed).toBe(0)
  })

  it('whitespace-only author → no string auto-confirm; verdict null → confirmed 0', () => {
    const hits = [hit(1, 'Bad Karma', ['Paul Wilson'])]
    const result = decideMatch({ title: 'Bad Karma', author: '   ' }, hits, null)
    expect(result.confirmed).toBe(0)
  })

  it('LLM path: verdict index 2 high → confirmed 1, pick = richest of chosen cluster', () => {
    const hits = [
      hit(1, 'Title A', ['Author A']),
      hit(2, 'Title B', ['Author B']),
      hit(3, 'Title C', ['Author C']),
      hit(4, 'title c', ['Author C'], {
        coverUrl: 'https://img/c.jpg',
        releaseYear: 2020,
        genres: ['Fiction'],
      }),
    ]
    // String won't auto-confirm (title mismatch with reading)
    const verdict = { index: 2, confidence: 'high' as const }
    const result = decideMatch({ title: 'Messy Ttile C', author: 'Author C' }, hits, verdict)
    expect(result.confirmed).toBe(1)
    // pickRichest should prefer hit 4 (same cluster as hit 3, higher completeness)
    expect(result.pick.hardcoverBookId).toBe(4)
  })

  it('LLM path: verdict index 2 medium → confirmed 0', () => {
    const hits = [
      hit(1, 'Title A', ['Author A']),
      hit(2, 'Title B', ['Author B']),
      hit(3, 'Title C', ['Author C']),
    ]
    const verdict = { index: 2, confidence: 'medium' as const }
    const result = decideMatch({ title: 'Messy Ttile C', author: 'Author C' }, hits, verdict)
    expect(result.confirmed).toBe(0)
    expect(result.pick.hardcoverBookId).toBe(3)
  })

  it('LLM path: verdict index 2 low → confirmed 0', () => {
    const hits = [
      hit(1, 'Title A', ['Author A']),
      hit(2, 'Title B', ['Author B']),
      hit(3, 'Title C', ['Author C']),
    ]
    const verdict = { index: 2, confidence: 'low' as const }
    const result = decideMatch({ title: 'Messy Ttile C', author: 'Author C' }, hits, verdict)
    expect(result.confirmed).toBe(0)
    expect(result.pick.hardcoverBookId).toBe(3)
  })

  it('LLM path: verdict null author → falls back to hits[0] with confirmed 0', () => {
    const hits = [hit(1, 'Title A', ['Author A']), hit(2, 'Title B', ['Author B'])]
    const result = decideMatch({ title: 'garbled ttile', author: null }, hits, null)
    expect(result.confirmed).toBe(0)
    expect(result.pick.hardcoverBookId).toBe(1)
  })
})
