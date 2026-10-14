import { describe, expect, it } from 'bun:test'
import { emptyWindowMessage } from './formatters'

describe('emptyWindowMessage', () => {
  it('says "No walks yet" only when no session exists at all', () => {
    expect(emptyWindowMessage(undefined)).toBe('No walks yet')
  })

  it('names the last walk when older sessions exist outside the window', () => {
    expect(emptyWindowMessage('2026-03-05T23:30:00Z')).toBe(
      'No walks in this window — last walk Mar 5, 2026',
    )
  })
})
