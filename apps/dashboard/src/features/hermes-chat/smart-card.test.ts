import { describe, expect, it } from 'bun:test'
import { parseCard } from './smart-card-schema'

// ── parseCard — audio card variants ──────────────────────────────────────────

describe('parseCard — audio', () => {
  it('parses a full audio card with title and script', () => {
    const result = parseCard(
      JSON.stringify({ type: 'audio', title: 'My Podcast', script: 'Hello world.' }),
    )
    expect(result).not.toBeNull()
    expect(result?.type).toBe('audio')
    if (result?.type === 'audio') {
      expect(result.title).toBe('My Podcast')
      expect(result.script).toBe('Hello world.')
    }
  })

  it('parses an audio card with src (no script)', () => {
    const result = parseCard(
      JSON.stringify({ type: 'audio', src: 'https://example.com/audio.mp3' }),
    )
    expect(result).not.toBeNull()
    expect(result?.type).toBe('audio')
    if (result?.type === 'audio') {
      expect(result.src).toBe('https://example.com/audio.mp3')
      expect(result.script).toBeUndefined()
    }
  })

  it('parses a script-only audio card (no title, no src)', () => {
    const result = parseCard(JSON.stringify({ type: 'audio', script: 'Intro text.' }))
    expect(result).not.toBeNull()
    expect(result?.type).toBe('audio')
    if (result?.type === 'audio') {
      expect(result.script).toBe('Intro text.')
      expect(result.title).toBeUndefined()
      expect(result.src).toBeUndefined()
    }
  })

  it('parses an audio card with durationMs', () => {
    const result = parseCard(JSON.stringify({ type: 'audio', title: 'Timed', durationMs: 120000 }))
    expect(result).not.toBeNull()
    if (result?.type === 'audio') {
      expect(result.durationMs).toBe(120000)
    }
  })
})

// ── parseCard — malformed / unknown inputs ────────────────────────────────────

describe('parseCard — malformed inputs', () => {
  it('returns null for invalid JSON', () => {
    expect(parseCard('{bad json')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseCard('')).toBeNull()
  })

  it('returns null for whitespace-only string', () => {
    expect(parseCard('   ')).toBeNull()
  })

  it('returns null for a valid object with unknown type', () => {
    expect(parseCard(JSON.stringify({ type: 'unknown', data: 'x' }))).toBeNull()
  })

  it('returns null for an audio card missing required shape (type field missing)', () => {
    expect(parseCard(JSON.stringify({ title: 'No type field' }))).toBeNull()
  })

  it('returns null for a non-object value', () => {
    expect(parseCard(JSON.stringify(42))).toBeNull()
    expect(parseCard(JSON.stringify(null))).toBeNull()
    expect(parseCard(JSON.stringify([]))).toBeNull()
  })
})

// ── parseCard — other card types still work ───────────────────────────────────

describe('parseCard — non-audio types', () => {
  it('parses a note card', () => {
    const result = parseCard(JSON.stringify({ type: 'note', body: 'A note.' }))
    expect(result?.type).toBe('note')
  })

  it('parses a todo card', () => {
    const result = parseCard(JSON.stringify({ type: 'todo', items: [{ text: 'Item 1' }] }))
    expect(result?.type).toBe('todo')
  })
})
