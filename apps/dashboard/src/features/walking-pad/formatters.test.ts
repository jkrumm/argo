import { describe, expect, it } from 'bun:test'
import { emptyWindowMessage } from './formatters'

describe('emptyWindowMessage', () => {
  it('says "No walks yet" only when none exist (null)', () => {
    expect(emptyWindowMessage(null)).toBe('No walks yet')
  })

  it('never claims "No walks yet" while the last walk is unknown (loading/error)', () => {
    expect(emptyWindowMessage(undefined)).toBe('No walks in this window')
  })

  it('names the last walk when older sessions exist', () => {
    expect(emptyWindowMessage('2026-03-05T12:00:00Z')).toBe(
      'No walks in this window — last walk Mar 5, 2026',
    )
  })

  it('falls back to the plain message on an unparseable timestamp', () => {
    expect(emptyWindowMessage('not-a-date')).toBe('No walks in this window')
  })
})
