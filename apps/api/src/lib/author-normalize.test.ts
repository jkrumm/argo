import { describe, it, expect } from 'bun:test'
import { normalizeAuthorName, normalizeAuthors } from './author-normalize.js'

describe('normalizeAuthorName', () => {
  it('collapses internal whitespace runs to a single space', () => {
    expect(normalizeAuthorName('Paul     Wilson')).toBe('Paul Wilson')
  })

  it('trims leading and trailing whitespace', () => {
    expect(normalizeAuthorName('  Ursula K. Le Guin  ')).toBe('Ursula K. Le Guin')
  })

  it('collapses tabs and newlines, not just spaces', () => {
    expect(normalizeAuthorName('Paul\t\nWilson')).toBe('Paul Wilson')
  })

  it('leaves an already-clean name unchanged', () => {
    expect(normalizeAuthorName('Brandon Sanderson')).toBe('Brandon Sanderson')
  })
})

describe('normalizeAuthors', () => {
  it('normalizes each entry', () => {
    expect(normalizeAuthors(['Paul     Wilson', '  Jane  Doe '])).toEqual([
      'Paul Wilson',
      'Jane Doe',
    ])
  })

  it('drops null, undefined, and whitespace-only entries', () => {
    expect(normalizeAuthors(['Real Author', null, undefined, '   ', ''])).toEqual(['Real Author'])
  })

  it('returns an empty array for an empty input', () => {
    expect(normalizeAuthors([])).toEqual([])
  })
})
