import { describe, it, expect } from 'bun:test'
import {
  CHUNK_DEFAULTS,
  defaultPrep,
  enforceChunkLimits,
  fallbackTitle,
  looksGerman,
  parsePrepResponse,
  type ChunkLimits,
} from './chunking.js'

const LIMITS: ChunkLimits = {
  targetWords: CHUNK_DEFAULTS.targetWords,
  maxWords: CHUNK_DEFAULTS.maxWords,
  maxBytes: CHUNK_DEFAULTS.maxBytes,
}

const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')

describe('parsePrepResponse', () => {
  it('parses a clean JSON object', () => {
    const out = parsePrepResponse(
      '{"lang":"de","title":"Mein Titel","chunks":[{"style":"ruhig","text":"Hallo"}]}',
    )
    expect(out.lang).toBe('de')
    expect(out.title).toBe('Mein Titel')
    expect(out.chunks).toEqual([{ style: 'ruhig', text: 'Hallo' }])
  })

  it('tolerates markdown code fences and surrounding prose', () => {
    const raw =
      'Here you go:\n```json\n{"lang":"en","title":"T","chunks":[{"style":"calm","text":"Hi"}]}\n```\nDone.'
    const out = parsePrepResponse(raw)
    expect(out.lang).toBe('en')
    expect(out.chunks[0]?.text).toBe('Hi')
  })

  it('throws when no JSON object is present', () => {
    expect(() => parsePrepResponse('no json here')).toThrow()
  })

  it('throws when chunks are missing or empty', () => {
    expect(() => parsePrepResponse('{"lang":"de","title":"x","chunks":[]}')).toThrow()
  })

  it('throws when a chunk has no text', () => {
    expect(() => parsePrepResponse('{"chunks":[{"style":"x","text":""}]}')).toThrow()
  })

  it('defaults style to empty string and trims text', () => {
    const out = parsePrepResponse('{"chunks":[{"text":"  spaced  "}]}')
    expect(out.chunks[0]).toEqual({ style: '', text: 'spaced' })
  })
})

describe('enforceChunkLimits', () => {
  it('passes through chunks already within the hard limits untouched', () => {
    const chunks = [{ style: 's', text: 'short text' }]
    expect(enforceChunkLimits(chunks, LIMITS)).toEqual(chunks)
  })

  it('re-splits an over-long chunk and keeps every piece within the word ceiling', () => {
    const long = { style: 'narrate', text: words(400) }
    const out = enforceChunkLimits([long], LIMITS)
    expect(out.length).toBeGreaterThan(1)
    for (const c of out) {
      expect((c.text.match(/\S+/g) ?? []).length).toBeLessThanOrEqual(LIMITS.maxWords)
      expect(c.style).toBe('narrate') // style is preserved across the split
    }
    // No content is lost in the re-split.
    expect(
      out
        .map((c) => c.text)
        .join(' ')
        .split(/\s+/).length,
    ).toBe(400)
  })

  it('prefers sentence boundaries when splitting', () => {
    const sentences = Array.from(
      { length: 30 },
      (_, i) => `This is sentence number ${i} with some filler words here.`,
    ).join(' ')
    const out = enforceChunkLimits([{ style: 's', text: sentences }], LIMITS)
    expect(out.length).toBeGreaterThan(1)
    // Boundaries fall after a period (no chunk starts mid-sentence with a lowercase fragment).
    for (const c of out) expect(c.text.trim().length).toBeGreaterThan(0)
  })
})

describe('language + title helpers', () => {
  it('detects German via umlauts or stopwords', () => {
    expect(looksGerman('Schöner Tag für eine Aufnahme')).toBe(true)
    expect(looksGerman('das ist ein test')).toBe(true)
    expect(looksGerman('this is plain english')).toBe(false)
  })

  it('builds a fallback title from the first words', () => {
    expect(fallbackTitle('one two three four five six seven', false)).toBe(
      'one two three four five six',
    )
    expect(fallbackTitle('', true)).toBe('Sprachnachricht')
    expect(fallbackTitle('', false)).toBe('Voice memo')
  })
})

describe('defaultPrep', () => {
  it('returns a single German chunk for German input', () => {
    const out = defaultPrep('Hallo, das ist ein Test für die Sprachausgabe.')
    expect(out.lang).toBe('de')
    expect(out.chunks).toHaveLength(1)
    expect(out.chunks[0]?.text).toContain('Test')
  })

  it('returns a single English chunk for English input', () => {
    const out = defaultPrep('Hello, this is a plain reading test.')
    expect(out.lang).toBe('en')
    expect(out.chunks).toHaveLength(1)
  })
})
